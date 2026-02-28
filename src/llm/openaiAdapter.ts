import { LLMGateway, LLMRequest, LLMResponse, ToolDefinition, ConversationMessage, ToolCall } from '../types/index.js';
import { estimateTokens } from './tokenCounter.js';

export class OpenAIAdapter implements LLMGateway {
  private abortController: AbortController = new AbortController();

  constructor(private readonly apiKey: string) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.abortController = new AbortController();
    const start = Date.now();

    // ── Function-calling (ReAct) mode ──────────────────────────────────────
    if (request.tools) {
      return this._chatWithTools(request, start);
    }

    // o1/o3 reasoning models: no temperature, use max_completion_tokens, developer role
    const isReasoning = isReasoningModel(request.model);
    const body = {
      model: request.model,
      messages: [
        { role: isReasoning ? 'developer' : 'system', content: request.system_prompt },
        { role: 'user', content: request.user_prompt },
      ],
      ...(isReasoning
        ? { max_completion_tokens: request.max_tokens ?? 16384 }
        : { max_tokens: request.max_tokens ?? 4096, temperature: request.temperature ?? 0.7 }),
      stream: !!request.onChunk && !isReasoning,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }

    if (request.onChunk && response.body) {
      return this._readStream(response, request.onChunk, start, request.model);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message?.content ?? '',
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      model: data.model ?? request.model,
      duration_ms: Date.now() - start,
    };
  }

  private async _chatWithTools(request: LLMRequest, start: number): Promise<LLMResponse> {
    const isReasoning = isReasoningModel(request.model);
    const messages = request.conversation
      ? conversationToOpenAI(request.conversation, isReasoning)
      : [
          { role: isReasoning ? 'developer' : 'system', content: request.system_prompt },
          { role: 'user', content: request.user_prompt },
        ];

    const body = {
      model: request.model,
      messages,
      tools: request.tools!.map(toolToOpenAI),
      tool_choice: 'auto',
      ...(isReasoning
        ? { max_completion_tokens: request.max_tokens ?? 16384 }
        : { max_tokens: request.max_tokens ?? 4096, temperature: request.temperature ?? 0.7 }),
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content?: string;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    const msg = data.choices[0]?.message;
    const toolCalls: ToolCall[] | undefined = msg?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: parseJsonSafe(tc.function.arguments),
    }));

    return {
      content: msg?.content ?? '',
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      model: data.model ?? request.model,
      duration_ms: Date.now() - start,
      tool_calls: toolCalls?.length ? toolCalls : undefined,
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
          if (data === '[DONE]' || !data) continue;

          try {
            const event = JSON.parse(data) as {
              choices: Array<{ delta?: { content?: string } }>;
            };
            const chunk = event.choices?.[0]?.delta?.content;
            if (chunk) {
              fullContent += chunk;
              onChunk(chunk);
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
      input_tokens: estimateTokens(fullContent),
      output_tokens: estimateTokens(fullContent),
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

/** o1/o3 reasoning models: no temperature, max_completion_tokens, developer role */
function isReasoningModel(model: string): boolean {
  return model.startsWith('o1') || model.startsWith('o3');
}

function toolToOpenAI(tool: ToolDefinition) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function conversationToOpenAI(messages: ConversationMessage[], isReasoning = false) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool' as const, tool_call_id: m.tool_call_id, content: m.content };
    }
    if (m.role === 'assistant' && m.tool_calls) {
      return {
        role: 'assistant' as const,
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    // o1/o3: system prompt uses 'developer' role
    const role = (m.role === 'system' && isReasoning) ? 'developer' : m.role;
    return { role: role as 'system' | 'developer' | 'user' | 'assistant', content: m.content };
  });
}

function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
