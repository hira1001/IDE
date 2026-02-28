import { LLMModel, ModelPricing } from '../types/index.js';

export const DEFAULT_PRICING: ModelPricing[] = [
  // ── OpenAI GPT-4o ──────────────────────────────────────────────────────────
  { model: 'gpt-4o',                 input_cost_per_1k: 0.0025,  output_cost_per_1k: 0.01 },
  { model: 'gpt-4o-mini',            input_cost_per_1k: 0.00015, output_cost_per_1k: 0.0006 },
  { model: 'gpt-4o-2024-11-20',      input_cost_per_1k: 0.0025,  output_cost_per_1k: 0.01 },
  { model: 'gpt-4o-2024-08-06',      input_cost_per_1k: 0.0025,  output_cost_per_1k: 0.01 },
  { model: 'gpt-4o-2024-05-13',      input_cost_per_1k: 0.005,   output_cost_per_1k: 0.015 },
  { model: 'gpt-4o-mini-2024-07-18', input_cost_per_1k: 0.00015, output_cost_per_1k: 0.0006 },
  // ── OpenAI GPT-4 Turbo / GPT-4 ────────────────────────────────────────────
  { model: 'gpt-4-turbo',            input_cost_per_1k: 0.01,    output_cost_per_1k: 0.03 },
  { model: 'gpt-4-turbo-preview',    input_cost_per_1k: 0.01,    output_cost_per_1k: 0.03 },
  { model: 'gpt-4',                  input_cost_per_1k: 0.03,    output_cost_per_1k: 0.06 },
  { model: 'gpt-4-32k',              input_cost_per_1k: 0.06,    output_cost_per_1k: 0.12 },
  { model: 'gpt-3.5-turbo',          input_cost_per_1k: 0.0005,  output_cost_per_1k: 0.0015 },
  { model: 'gpt-3.5-turbo-16k',      input_cost_per_1k: 0.003,   output_cost_per_1k: 0.004 },
  // ── OpenAI o-series reasoning models ──────────────────────────────────────
  { model: 'o3',                     input_cost_per_1k: 0.01,    output_cost_per_1k: 0.04 },
  { model: 'o3-mini',                input_cost_per_1k: 0.0011,  output_cost_per_1k: 0.0044 },
  { model: 'o1',                     input_cost_per_1k: 0.015,   output_cost_per_1k: 0.06 },
  { model: 'o1-mini',                input_cost_per_1k: 0.0011,  output_cost_per_1k: 0.0044 },
  { model: 'o1-preview',             input_cost_per_1k: 0.015,   output_cost_per_1k: 0.06 },
  // ── Anthropic Claude 4 ────────────────────────────────────────────────────
  { model: 'claude-opus-4-6',        input_cost_per_1k: 0.015,   output_cost_per_1k: 0.075 },
  { model: 'claude-sonnet-4-6',      input_cost_per_1k: 0.003,   output_cost_per_1k: 0.015 },
  { model: 'claude-haiku-4-5',       input_cost_per_1k: 0.00025, output_cost_per_1k: 0.00125 },
  // ── Anthropic Claude 3.5 ──────────────────────────────────────────────────
  { model: 'claude-3-5-sonnet-20241022', input_cost_per_1k: 0.003,   output_cost_per_1k: 0.015 },
  { model: 'claude-3-5-sonnet-20240620', input_cost_per_1k: 0.003,   output_cost_per_1k: 0.015 },
  { model: 'claude-3-5-haiku-20241022',  input_cost_per_1k: 0.0008,  output_cost_per_1k: 0.004 },
  // ── Anthropic Claude 3 ────────────────────────────────────────────────────
  { model: 'claude-3-opus-20240229',  input_cost_per_1k: 0.015,  output_cost_per_1k: 0.075 },
  { model: 'claude-3-sonnet-20240229',input_cost_per_1k: 0.003,  output_cost_per_1k: 0.015 },
  { model: 'claude-3-haiku-20240307', input_cost_per_1k: 0.00025,output_cost_per_1k: 0.00125 },
  // ── Google Gemini 2.x ─────────────────────────────────────────────────────
  { model: 'gemini-2.0-flash',       input_cost_per_1k: 0.0001,  output_cost_per_1k: 0.0004 },
  { model: 'gemini-2.0-flash-lite',  input_cost_per_1k: 0.000075,output_cost_per_1k: 0.0003 },
  { model: 'gemini-2.5-pro-exp-03-25', input_cost_per_1k: 0.00125, output_cost_per_1k: 0.01 },
  // ── Google Gemini 1.5 ─────────────────────────────────────────────────────
  { model: 'gemini-1.5-pro',         input_cost_per_1k: 0.00125, output_cost_per_1k: 0.005 },
  { model: 'gemini-1.5-pro-002',     input_cost_per_1k: 0.00125, output_cost_per_1k: 0.005 },
  { model: 'gemini-1.5-flash',       input_cost_per_1k: 0.000075,output_cost_per_1k: 0.0003 },
  { model: 'gemini-1.5-flash-002',   input_cost_per_1k: 0.000075,output_cost_per_1k: 0.0003 },
  { model: 'gemini-1.5-flash-8b',    input_cost_per_1k: 0.0000375,output_cost_per_1k: 0.00015 },
  { model: 'gemini-1.0-pro',         input_cost_per_1k: 0.0005,  output_cost_per_1k: 0.0015 },
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
