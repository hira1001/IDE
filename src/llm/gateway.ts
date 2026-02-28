import { LLMGateway, LLMModel } from '../types/index.js';
import { OpenAIAdapter } from './openaiAdapter.js';
import { AnthropicAdapter } from './anthropicAdapter.js';
import { GoogleAIAdapter } from './googleAdapter.js';
import { OllamaAdapter } from './ollamaAdapter.js';
import { VscodeLMAdapter, VscodeLMApi } from './vscodeLMAdapter.js';

export type ApiKeys = {
  openai?: string;
  anthropic?: string;
  google?: string;
  /** Ollama server endpoint URL (e.g. "http://localhost:11434"). No API key needed. */
  ollama?: string;
};

/**
 * Return the appropriate LLM gateway for the given model.
 *
 * Model prefixes:
 *   gpt-*      → OpenAI
 *   claude-*   → Anthropic
 *   gemini-*   → Google AI
 *   ollama:*   → Ollama (local)
 *   vscode:*   → VS Code Language Model API (Cursor, Copilot, etc.)
 */
export function getGateway(
  model: LLMModel,
  apiKeys: ApiKeys,
  vscodeLM?: VscodeLMApi
): LLMGateway {
  if (model.startsWith('vscode:')) {
    if (!vscodeLM) throw new Error('VS Code LM API is not available in this context.');
    const modelId = model.slice('vscode:'.length);
    return new VscodeLMAdapter(modelId, vscodeLM);
  }
  if (model.startsWith('ollama:')) {
    return new OllamaAdapter(apiKeys.ollama ?? 'http://localhost:11434');
  }
  if (isOpenAIModel(model)) {
    if (!apiKeys.openai) throw new Error('OpenAI API key is not configured.');
    return new OpenAIAdapter(apiKeys.openai);
  }
  if (model.startsWith('claude-')) {
    if (!apiKeys.anthropic) throw new Error('Anthropic API key is not configured.');
    return new AnthropicAdapter(apiKeys.anthropic);
  }
  if (model.startsWith('gemini-')) {
    if (!apiKeys.google) throw new Error('Google AI API key is not configured.');
    return new GoogleAIAdapter(apiKeys.google);
  }
  throw new Error(`Unknown model: ${model}`);
}

/** Returns true for any OpenAI model (gpt-*, o1*, o3*). */
function isOpenAIModel(model: string): boolean {
  return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3');
}

export function getProviderFromModel(model: LLMModel): 'openai' | 'anthropic' | 'google' | 'ollama' | 'vscode' {
  if (model.startsWith('vscode:')) return 'vscode';
  if (model.startsWith('ollama:')) return 'ollama';
  if (isOpenAIModel(model)) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'google';
  throw new Error(`Unknown model provider for: ${model}`);
}

export function getRequiredProviders(models: LLMModel[]): Set<'openai' | 'anthropic' | 'google' | 'ollama' | 'vscode'> {
  const providers = new Set<'openai' | 'anthropic' | 'google' | 'ollama' | 'vscode'>();
  for (const model of models) {
    providers.add(getProviderFromModel(model));
  }
  return providers;
}
