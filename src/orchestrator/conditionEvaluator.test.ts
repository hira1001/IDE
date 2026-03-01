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

  it('returns fail for empty output', () => {
    expect(evaluator.evaluate('', config)).toBe('fail');
  });

  it('pass keyword takes precedence when both appear on first line', () => {
    // pass_keyword is checked first on the first line → returns 'pass'
    const output = 'APPROVED REVISION_NEEDED something';
    expect(evaluator.evaluate(output, config)).toBe('pass');
  });

  it('is case-sensitive for keywords', () => {
    const output = 'approved — looks good to me.';
    expect(evaluator.evaluate(output, config)).toBe('fail');
  });

  it('returns pass when keyword is embedded mid-line', () => {
    const output = 'Result: APPROVED after careful review.';
    expect(evaluator.evaluate(output, config)).toBe('pass');
  });

  it('returns fail when fail keyword is embedded mid-line', () => {
    const output = 'Result: REVISION_NEEDED — see issues.';
    expect(evaluator.evaluate(output, config)).toBe('fail');
  });

  it('matches pass keyword with surrounding whitespace on first line', () => {
    const output = '  APPROVED  \nsome extra text';
    expect(evaluator.evaluate(output, config)).toBe('pass');
  });

  it('pass keyword wins when both appear in body (not first line)', () => {
    // pass_keyword is checked before fail_keyword in full-scan fallback
    const output = 'Summary:\nAPPROVED with minor notes, but REVISION_NEEDED for one section.';
    expect(evaluator.evaluate(output, config)).toBe('pass');
  });

  it('returns pass for single-line output containing only the pass keyword', () => {
    expect(evaluator.evaluate('APPROVED', config)).toBe('pass');
  });

  it('returns fail for single-line output containing only the fail keyword', () => {
    expect(evaluator.evaluate('REVISION_NEEDED', config)).toBe('fail');
  });

  it('works with custom short keywords', () => {
    const shortConfig = { ...config, pass_keyword: 'YES', fail_keyword: 'NO' };
    expect(evaluator.evaluate('YES', shortConfig)).toBe('pass');
    expect(evaluator.evaluate('NO', shortConfig)).toBe('fail');
  });
});
