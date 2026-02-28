import { LLMGateway, LLMRequest, LLMResponse, ToolDefinition, ConversationMessage, ToolCall } from '../types/index.js';
import { estimateTokens } from './tokenCounter.js';

/**
 * OllamaAdapter — Connects to a local Ollama server using its OpenAI-compatible API.
 * Model names use the "ollama:" prefix in this extension (e.g. "ollama:llama3.2").
 * The prefix is stripped before sending to the API.
 */
export class OllamaAdapter implements LLMGateway {
  private abortController: AbortController = new AbortController();

  constructor(private readonly endpointBase: string) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.abortController = new AbortController();
    const start = Date.now();

    // Strip "ollama:" prefix to get the actual model name Ollama expects
    const modelName = request.model.startsWith('ollama:')
      ? request.model.slice('ollama:'.length)
      : request.model;

    // ── Function-calling (ReAct) mode ──────────────────────────────────────
    if (request.tools) {
      return this._chatWithTools(request, modelName, start);
    }

    const body = {
      model: modelName,
      messages: [
        { role: 'system', content: request.system_prompt },
        { role: 'user', content: request.user_prompt },
      ],
      max_tokens: request.max_tokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      stream: !!request.onChunk,
    };

    const url = `${this.endpointBase.replace(/\/$/, '')}/v1/chat/completions`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new Error(
        `Cannot connect to Ollama at ${this.endpointBase}. ` +
        `Make sure Ollama is running (\`ollama serve\`). ` +
        `(${err instanceof Error ? err.message : String(err)})`
      );
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${err}`);
    }

    if (request.onChunk && response.body) {
      return this._readStream(response, request.onChunk, start, modelName);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message?.content ?? '',
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      model: `ollama:${data.model ?? modelName}`,
      duration_ms: Date.now() - start,
    };
  }

  private async _chatWithTools(
    request: LLMRequest,
    modelName: string,
    start: number
  ): Promise<LLMResponse> {
    const url = `${this.endpointBase.replace(/\/$/, '')}/v1/chat/completions`;

    const messages = request.conversation
      ? conversationToMessages(request.conversation)
      : [
          { role: 'system', content: request.system_prompt },
          { role: 'user', content: request.user_prompt },
        ];

    const body = {
      model: modelName,
      messages,
      tools: request.tools!.map(toolToOpenAIFormat),
      tool_choice: 'auto',
      max_tokens: request.max_tokens ?? 4096,
      temperature: request.temperature ?? 0.7,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new Error(
        `Cannot connect to Ollama at ${this.endpointBase}. ` +
        `Make sure Ollama is running (\`ollama serve\`). ` +
        `(${err instanceof Error ? err.message : String(err)})`
      );
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${err}`);
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
      usage?: { prompt_tokens: number; completion_tokens: number };
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
      model: `ollama:${data.model ?? modelName}`,
      duration_ms: Date.now() - start,
      tool_calls: toolCalls?.length ? toolCalls : undefined,
    };
  }

  private async _readStream(
    response: Response,
    onChunk: (chunk: string) => void,
    start: number,
    modelName: string
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
      model: `ollama:${modelName}`,
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

function toolToOpenAIFormat(tool: ToolDefinition) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function conversationToMessages(messages: ConversationMessage[]) {
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
    return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
  });
}

function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
