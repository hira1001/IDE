import { LLMGateway, LLMRequest, LLMResponse } from '../types/index.js';
import { estimateTokens } from './tokenCounter.js';

export class GoogleAIAdapter implements LLMGateway {
  private abortController: AbortController = new AbortController();

  constructor(private readonly apiKey: string) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.abortController = new AbortController();
    const start = Date.now();

    // Map model name: "gemini-1.5-pro" → "gemini-1.5-pro-latest"
    const modelId = request.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${this.apiKey}`;

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

  abort(): void {
    this.abortController.abort();
  }

  estimateTokens(text: string): number {
    return estimateTokens(text);
  }
}
