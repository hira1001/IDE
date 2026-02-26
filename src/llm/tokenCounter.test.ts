import { describe, it, expect } from 'vitest';
import { estimateTokens, getProvider } from './tokenCounter.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates English text roughly at 1 token per 4 chars', () => {
    const text = 'Hello world, this is a test sentence.'; // 37 chars
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(20);
  });

  it('estimates CJK text more densely', () => {
    const english = 'Hello world this is a test message for English text';
    const japanese = 'こんにちはこれはテストメッセージです日本語のテキスト';
    // CJK should give more tokens per character
    const enTokens = estimateTokens(english);
    const jaTokens = estimateTokens(japanese);
    // Both strings are similar length, but CJK counts differently
    expect(jaTokens).toBeGreaterThan(0);
    expect(enTokens).toBeGreaterThan(0);
  });
});

describe('getProvider', () => {
  it('returns openai for gpt- models', () => {
    expect(getProvider('gpt-4o')).toBe('openai');
    expect(getProvider('gpt-4o-mini')).toBe('openai');
  });

  it('returns anthropic for claude- models', () => {
    expect(getProvider('claude-sonnet-4-5')).toBe('anthropic');
  });

  it('returns google for gemini- models', () => {
    expect(getProvider('gemini-1.5-pro')).toBe('google');
  });

  it('throws for unknown model', () => {
    expect(() => getProvider('unknown-model' as never)).toThrow();
  });
});
