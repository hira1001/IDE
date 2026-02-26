import { LLMModel } from '../types/index.js';

/**
 * Rough token estimation (without a tokenizer library).
 * ~4 chars ≈ 1 token for English; ~2 chars ≈ 1 token for CJK.
 * This is intentionally conservative for cost preview purposes.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Count CJK characters separately
  const cjk = (text.match(/[\u3000-\u9fff\uf900-\ufaff]/g) || []).length;
  const remaining = text.length - cjk;
  return Math.ceil(cjk / 1.5 + remaining / 4);
}

export function getProvider(model: LLMModel): 'openai' | 'anthropic' | 'google' {
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'google';
  throw new Error(`Unknown model provider for: ${model}`);
}
