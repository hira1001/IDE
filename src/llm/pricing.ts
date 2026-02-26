import { LLMModel, ModelPricing } from '../types/index.js';

export const DEFAULT_PRICING: ModelPricing[] = [
  { model: 'gpt-4o', input_cost_per_1k: 0.0025, output_cost_per_1k: 0.01 },
  { model: 'gpt-4o-mini', input_cost_per_1k: 0.00015, output_cost_per_1k: 0.0006 },
  { model: 'gpt-4-turbo', input_cost_per_1k: 0.01, output_cost_per_1k: 0.03 },
  { model: 'claude-sonnet-4-5', input_cost_per_1k: 0.003, output_cost_per_1k: 0.015 },
  { model: 'claude-haiku-4-5', input_cost_per_1k: 0.00025, output_cost_per_1k: 0.00125 },
  { model: 'claude-opus-4-5', input_cost_per_1k: 0.015, output_cost_per_1k: 0.075 },
  { model: 'gemini-1.5-pro', input_cost_per_1k: 0.00125, output_cost_per_1k: 0.005 },
  { model: 'gemini-1.5-flash', input_cost_per_1k: 0.000075, output_cost_per_1k: 0.0003 },
  { model: 'gemini-2.0-flash', input_cost_per_1k: 0.0001, output_cost_per_1k: 0.0004 },
];

let _pricing: ModelPricing[] = [...DEFAULT_PRICING];

export function getPricing(): ModelPricing[] {
  return _pricing;
}

export function updatePricing(pricing: ModelPricing[]): void {
  _pricing = pricing;
}

export function getCostForTokens(
  model: LLMModel,
  inputTokens: number,
  outputTokens: number
): number {
  const entry = _pricing.find((p) => p.model === model);
  if (!entry) return 0;
  return (inputTokens / 1000) * entry.input_cost_per_1k +
    (outputTokens / 1000) * entry.output_cost_per_1k;
}
