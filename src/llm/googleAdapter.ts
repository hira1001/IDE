import { LLMGateway, LLMRequest, LLMResponse, ToolDefinition, ConversationMessage, ToolCall } from '../types/index.js';
import { estimateTokens } from './tokenCounter.js';

export class GoogleAIAdapter implements LLMGateway {
  private abortController: AbortController = new AbortController();

  constructor(private readonly apiKey: string) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.abortController = new AbortController();
    const start = Date.now();

    const modelId = request.model;

    // ── Function-calling (ReAct) mode ──────────────────────────────────────
    if (request.tools) {
      return this._chatWithTools(request, modelId, start);
    }

    // Use streamGenerateContent endpoint when streaming is requested
    const endpoint = request.onChunk ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:${endpoint}key=${this.apiKey}`;

    const body = {
      systemInstruction: { parts: [{ text: request.system_prompt }] },
      contents: [{ role: 'user', parts: [{ text: request.user_prompt }] }],
      generationConfig: {
        maxOutputTokens: request.max_tokens ?? 4096,
        temperature: request.temperature ?? 0.7,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google AI API error ${response.status}: ${err}`);
    }

    if (request.onChunk && response.body) {
      return this._readStream(response, request.onChunk, start, request.model);
    }

    const data = await response.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    return {
      content,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model: request.model,
      duration_ms: Date.now() - start,
    };
  }

  private async _chatWithTools(
    request: LLMRequest,
    modelId: string,
    start: number
  ): Promise<LLMResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${this.apiKey}`;

    const contents = request.conversation
      ? conversationToGoogle(request.conversation)
      : [{ role: 'user', parts: [{ text: request.user_prompt }] }];

    const body = {
      systemInstruction: { parts: [{ text: request.system_prompt }] },
      contents,
      tools: [{ functionDeclarations: request.tools!.map(toolToGoogle) }],
      generationConfig: {
        maxOutputTokens: request.max_tokens ?? 4096,
        temperature: request.temperature ?? 0.7,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google AI API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      candidates: Array<{
        content: {
          parts: Array<
            | { text: string }
            | { functionCall: { name: string; args: Record<string, unknown> } }
          >;
        };
      }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const toolCalls: ToolCall[] = [];
    let textContent = '';

    for (const part of parts) {
      if ('functionCall' in part && part.functionCall) {
        toolCalls.push({
          id: `google-${Date.now()}-${toolCalls.length}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args,
        });
      } else if ('text' in part && part.text) {
        textContent += part.text;
      }
    }

    return {
      content: textContent,
      input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      model: request.model,
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
              candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
              usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
            };
            const chunk = event.candidates?.[0]?.content?.parts?.[0]?.text;
            if (chunk) {
              fullContent += chunk;
              onChunk(chunk);
            }
            if (event.usageMetadata) {
              inputTokens = event.usageMetadata.promptTokenCount;
              outputTokens = event.usageMetadata.candidatesTokenCount;
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

function toolToGoogle(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function conversationToGoogle(messages: ConversationMessage[]) {
  const contents: Array<{ role: 'user' | 'model'; parts: unknown[] }> = [];

  for (const m of messages) {
    if (m.role === 'system') continue; // handled via systemInstruction

    if (m.role === 'tool') {
      // Tool results become functionResponse parts in a user message.
      // Google API requires the function name (not the call ID).
      const part = {
        functionResponse: {
          name: m.tool_name ?? m.tool_call_id,
          response: { content: m.content },
        },
      };
      const last = contents[contents.length - 1];
      if (last && last.role === 'user') {
        last.parts.push(part);
      } else {
        contents.push({ role: 'user', parts: [part] });
      }
      continue;
    }

    if (m.role === 'assistant' && m.tool_calls) {
      const parts: unknown[] = m.tool_calls.map((tc) => ({
        functionCall: { name: tc.name, args: tc.arguments },
      }));
      if (m.content) parts.unshift({ text: m.content });
      contents.push({ role: 'model', parts });
      continue;
    }

    const role = m.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts: [{ text: m.content }] });
  }

  return contents;
}
