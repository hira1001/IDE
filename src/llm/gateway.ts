import { LLMGateway, LLMModel } from '../types/index.js';
import { OpenAIAdapter } from './openaiAdapter.js';
import { AnthropicAdapter } from './anthropicAdapter.js';
import { GoogleAIAdapter } from './googleAdapter.js';

export type ApiKeys = {
  openai?: string;
  anthropic?: string;
  google?: string;
};

export function getGateway(model: LLMModel, apiKeys: ApiKeys): LLMGateway {
  if (model.startsWith('gpt-')) {
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

export function getProviderFromModel(model: LLMModel): 'openai' | 'anthropic' | 'google' {
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'google';
  throw new Error(`Unknown model provider for: ${model}`);
}

export function getRequiredProviders(models: LLMModel[]): Set<'openai' | 'anthropic' | 'google'> {
  const providers = new Set<'openai' | 'anthropic' | 'google'>();
  for (const model of models) {
    providers.add(getProviderFromModel(model));
  }
  return providers;
}
