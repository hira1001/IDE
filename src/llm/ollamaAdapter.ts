import { LLMGateway, LLMRequest, LLMResponse } from '../types/index.js';
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

    const body = {
      model: modelName,
      messages: [
        { role: 'system', content: request.system_prompt },
        { role: 'user', content: request.user_prompt },
      ],
      max_tokens: request.max_tokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      stream: false,
    };

    const url = `${this.endpointBase.replace(/\/$/, '')}/v1/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${err}`);
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

  abort(): void {
    this.abortController.abort();
  }

  estimateTokens(text: string): number {
    return estimateTokens(text);
  }
}
