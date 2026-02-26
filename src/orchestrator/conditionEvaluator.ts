import { ConditionalConfig } from '../types/index.js';

export type ConditionResult = 'pass' | 'fail';

/**
 * Condition Evaluator — Determines pass/fail for conditional steps.
 * Scans the full output for keywords. Defaults to 'fail' if neither found (safe side).
 */
export class ConditionEvaluator {
  evaluate(output: string, config: ConditionalConfig): ConditionResult {
    const lines = output.split('\n');

    // First check: first line contains the keyword
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      if (firstLine.includes(config.pass_keyword)) return 'pass';
      if (firstLine.includes(config.fail_keyword)) return 'fail';
    }

    // Fallback: scan entire output
    if (output.includes(config.pass_keyword)) return 'pass';
    if (output.includes(config.fail_keyword)) return 'fail';

    // Neither keyword found → treat as fail (safe side)
    return 'fail';
  }
}
