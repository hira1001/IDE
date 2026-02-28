import { LLMGateway, LLMRequest, LLMResponse } from '../types/index.js';
import { estimateTokens } from './tokenCounter.js';

export class GoogleAIAdapter implements LLMGateway {
  private abortController: AbortController = new AbortController();

  constructor(private readonly apiKey: string) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.abortController = new AbortController();
    const start = Date.now();

    const modelId = request.model;
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
