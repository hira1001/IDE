import { LLMGateway, LLMRequest, LLMResponse, ToolDefinition, ConversationMessage, ToolCall } from '../types/index.js';
import { estimateTokens } from './tokenCounter.js';

export class AnthropicAdapter implements LLMGateway {
  private abortController: AbortController = new AbortController();

  constructor(private readonly apiKey: string) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.abortController = new AbortController();
    const start = Date.now();

    // ── Function-calling (ReAct) mode ──────────────────────────────────────
    if (request.tools) {
      return this._chatWithTools(request, start);
    }

    const body = {
      model: request.model,
      max_tokens: request.max_tokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      system: request.system_prompt,
      messages: [{ role: 'user', content: request.user_prompt }],
      stream: !!request.onChunk,
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    if (request.onChunk && response.body) {
      return this._readStream(response, request.onChunk, start, request.model);
    }

    const data = await response.json() as {
      content: Array<{ text: string }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
    };

    return {
      content: data.content?.[0]?.text ?? '',
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      model: data.model ?? request.model,
      duration_ms: Date.now() - start,
    };
  }

  private async _chatWithTools(request: LLMRequest, start: number): Promise<LLMResponse> {
    const messages = request.conversation
      ? conversationToAnthropic(request.conversation)
      : [{ role: 'user', content: request.user_prompt }];

    const body = {
      model: request.model,
      max_tokens: request.max_tokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      system: request.system_prompt,
      messages,
      tools: request.tools!.map(toolToAnthropic),
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
      stop_reason: string;
    };

    // Collect tool calls from content blocks
    const toolCalls: ToolCall[] = [];
    let textContent = '';
    for (const block of data.content ?? []) {
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
      } else if (block.type === 'text') {
        textContent += block.text;
      }
    }

    return {
      content: textContent,
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      model: data.model ?? request.model,
      duration_ms: Date.now() - start,
      tool_calls: toolCalls.length ? toolCalls : undefined,
    };
  }

  private async _readStream(
    response: Response,
    onChunk: (chunk: string) => void,
    start: number,
    model: string
  ): Promise<LLMResponse> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const event = JSON.parse(data) as {
              type: string;
              delta?: { type: string; text?: string };
              message?: { usage?: { input_tokens: number; output_tokens: number } };
              usage?: { input_tokens: number; output_tokens: number };
            };

            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
              fullContent += event.delta.text;
              onChunk(event.delta.text);
            } else if (event.type === 'message_start' && event.message?.usage) {
              inputTokens = event.message.usage.input_tokens;
            } else if (event.type === 'message_delta' && event.usage) {
              outputTokens = event.usage.output_tokens;
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: fullContent,
      input_tokens: inputTokens || estimateTokens(fullContent),
      output_tokens: outputTokens || estimateTokens(fullContent),
      model,
      duration_ms: Date.now() - start,
    };
  }

  abort(): void {
    this.abortController.abort();
  }

  estimateTokens(text: string): number {
    return estimateTokens(text);
  }
}

// ─── format converters ────────────────────────────────────────────────────────

function toolToAnthropic(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

function conversationToAnthropic(messages: ConversationMessage[]) {
  const result: Array<{
    role: 'user' | 'assistant';
    content: string | unknown[];
  }> = [];

  for (const m of messages) {
    if (m.role === 'system') continue; // Anthropic handles system separately

    if (m.role === 'tool') {
      // Tool results must go into a user message as tool_result blocks
      const last = result[result.length - 1];
      const block = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: m.content,
      };
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (m.role === 'assistant' && m.tool_calls) {
      const blocks: unknown[] = m.tool_calls.map((tc) => ({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.arguments,
      }));
      if (m.content) blocks.unshift({ type: 'text', text: m.content });
      result.push({ role: 'assistant', content: blocks });
      continue;
    }

    result.push({ role: m.role as 'user' | 'assistant', content: m.content });
  }

  return result;
}
