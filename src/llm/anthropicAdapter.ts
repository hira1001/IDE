import { LLMGateway, LLMRequest, LLMResponse } from '../types/index.js';
import { estimateTokens } from './tokenCounter.js';

export class AnthropicAdapter implements LLMGateway {
  private abortController: AbortController = new AbortController();

  constructor(private readonly apiKey: string) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.abortController = new AbortController();
    const start = Date.now();

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
      while (true) {
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
