import { describe, it, expect } from 'vitest';
import { getCostForTokens, DEFAULT_PRICING } from './pricing.js';

describe('getCostForTokens', () => {
  it('returns 0 for unknown models (e.g., Ollama local)', () => {
    expect(getCostForTokens('ollama:llama3.2', 1000, 500)).toBe(0);
    expect(getCostForTokens('vscode:copilot-gpt-4', 1000, 500)).toBe(0);
  });

  it('calculates cost correctly for gpt-4o', () => {
    // gpt-4o: $0.0025/1K input, $0.01/1K output
    const cost = getCostForTokens('gpt-4o', 1000, 1000);
    expect(cost).toBeCloseTo(0.0125, 6);
  });

  it('calculates cost correctly for claude-opus-4-6', () => {
    // claude-opus-4-6: $0.015/1K input, $0.075/1K output
    const cost = getCostForTokens('claude-opus-4-6', 2000, 500);
    expect(cost).toBeCloseTo(0.015 * 2 + 0.075 * 0.5, 6);
  });

  it('calculates cost correctly for gemini-2.0-flash', () => {
    // gemini-2.0-flash: $0.0001/1K input, $0.0004/1K output
    const cost = getCostForTokens('gemini-2.0-flash', 10000, 5000);
    expect(cost).toBeCloseTo(0.001 + 0.002, 6);
  });

  it('calculates cost correctly for o1 reasoning model', () => {
    // o1: $0.015/1K input, $0.06/1K output
    const cost = getCostForTokens('o1', 1000, 1000);
    expect(cost).toBeCloseTo(0.075, 6);
  });

  it('returns 0 for zero tokens', () => {
    expect(getCostForTokens('gpt-4o', 0, 0)).toBe(0);
  });

  it('covers all major providers in DEFAULT_PRICING', () => {
    const models = DEFAULT_PRICING.map((p) => p.model);
    const hasOpenAI = models.some((m) => m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3'));
    const hasAnthropic = models.some((m) => m.startsWith('claude-'));
    const hasGoogle = models.some((m) => m.startsWith('gemini-'));
    expect(hasOpenAI).toBe(true);
    expect(hasAnthropic).toBe(true);
    expect(hasGoogle).toBe(true);
    expect(DEFAULT_PRICING.length).toBeGreaterThanOrEqual(30);
  });

  it('all pricing entries have positive costs', () => {
    for (const entry of DEFAULT_PRICING) {
      expect(entry.input_cost_per_1k).toBeGreaterThan(0);
      expect(entry.output_cost_per_1k).toBeGreaterThan(0);
    }
  });
});
