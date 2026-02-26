import { describe, it, expect } from 'vitest';
import { ConditionEvaluator } from './conditionEvaluator.js';

const config = {
  evaluator_agent_id: 'agent_reviewer',
  pass_keyword: 'APPROVED',
  fail_keyword: 'REVISION_NEEDED',
  max_loops: 3,
};

describe('ConditionEvaluator', () => {
  const evaluator = new ConditionEvaluator();

  it('returns pass when first line contains pass keyword', () => {
    const output = 'APPROVED\n\nEverything looks good.';
    expect(evaluator.evaluate(output, config)).toBe('pass');
  });

  it('returns fail when first line contains fail keyword', () => {
    const output = 'REVISION_NEEDED\n\nPlease fix the following issues.';
    expect(evaluator.evaluate(output, config)).toBe('fail');
  });

  it('scans entire output as fallback for pass', () => {
    const output = 'After careful review:\nAPPROVED\nThe document is complete.';
    expect(evaluator.evaluate(output, config)).toBe('pass');
  });

  it('scans entire output as fallback for fail', () => {
    const output = 'After careful review:\nREVISION_NEEDED\nSee comments below.';
    expect(evaluator.evaluate(output, config)).toBe('fail');
  });

  it('returns fail (safe side) when neither keyword found', () => {
    const output = 'The review is complete. Everything is fine.';
    expect(evaluator.evaluate(output, config)).toBe('fail');
  });
});
