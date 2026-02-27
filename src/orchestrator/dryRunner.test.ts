import { describe, it, expect, beforeEach } from 'vitest';
import { DryRunner } from './dryRunner.js';
import { WorkflowConfig, SourceInput } from '../types/index.js';
import { estimateTokens } from '../llm/tokenCounter.js';

// Minimal source fixture
const SOURCE: SourceInput = {
  content: 'const x = 1;',
  filename: 'test.ts',
  language_id: 'typescript',
  line_count: 1,
  byte_size: 13,
};

// Minimal config builder helpers
function makeConfig(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    agents: [
      { id: 'agent_1', name: 'Reviewer', persona: 'Code reviewer', model: 'gpt-4o' },
    ],
    workflow: [
      {
        step: 1,
        type: 'parallel',
        pause_after: false,
        tasks: [
          {
            task_id: 'task_1',
            agent_id: 'agent_1',
            task_name: 'Review code',
            instructions: ['Analyze the code', 'Find bugs'],
            constraints: ['Be concise'],
            output_format: 'Markdown',
            output_key: 'review_out',
            input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source' }],
            enable_handover_note: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('DryRunner', () => {
  let runner: DryRunner;

  beforeEach(() => {
    runner = new DryRunner();
  });

  describe('result structure', () => {
    it('returns a DryRunResult with all required fields', () => {
      const result = runner.run(makeConfig(), SOURCE);

      expect(result).toHaveProperty('steps');
      expect(result).toHaveProperty('total_min_tokens');
      expect(result).toHaveProperty('total_max_tokens');
      expect(result).toHaveProperty('estimated_min_cost_usd');
      expect(result).toHaveProperty('estimated_max_cost_usd');
      expect(result).toHaveProperty('providers');
    });

    it('maps each workflow step to a DryRunStepResult', () => {
      const result = runner.run(makeConfig(), SOURCE);

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].step).toBe(1);
      expect(result.steps[0].type).toBe('parallel');
      expect(result.steps[0].tasks).toHaveLength(1);
    });

    it('maps each task to a DryRunTaskResult with prompts', () => {
      const result = runner.run(makeConfig(), SOURCE);
      const task = result.steps[0].tasks[0];

      expect(task.task_id).toBe('task_1');
      expect(task.task_name).toBe('Review code');
      expect(task.agent_name).toBe('Reviewer');
      expect(task.model).toBe('gpt-4o');
      expect(typeof task.system_prompt).toBe('string');
      expect(typeof task.user_prompt).toBe('string');
      expect(task.system_prompt.length).toBeGreaterThan(0);
      expect(task.user_prompt.length).toBeGreaterThan(0);
    });
  });

  describe('token estimation', () => {
    it('estimated_input_tokens matches estimateTokens of built prompts', () => {
      const result = runner.run(makeConfig(), SOURCE);
      const taskResult = result.steps[0].tasks[0];

      const expected = estimateTokens(taskResult.system_prompt + taskResult.user_prompt);
      expect(taskResult.estimated_input_tokens).toBe(expected);
    });

    it('total_min_tokens includes 50% output estimate', () => {
      const result = runner.run(makeConfig(), SOURCE);
      const inputTokens = result.steps[0].tasks[0].estimated_input_tokens;
      const expectedOutputEstimate = Math.floor(inputTokens * 0.5);

      expect(result.total_min_tokens).toBe(inputTokens + expectedOutputEstimate);
    });

    it('total_min_tokens equals total_max_tokens for parallel steps', () => {
      // Non-conditional steps: min === max
      const result = runner.run(makeConfig(), SOURCE);
      expect(result.total_min_tokens).toBe(result.total_max_tokens);
    });
  });

  describe('conditional step token scaling', () => {
    it('total_max_tokens is 3x total_min_tokens for a single conditional step', () => {
      const config = makeConfig({
        workflow: [
          {
            step: 1,
            type: 'conditional',
            pause_after: false,
            tasks: [
              {
                task_id: 'task_1',
                agent_id: 'agent_1',
                task_name: 'Evaluate',
                instructions: ['Check quality'],
                constraints: [],
                output_format: 'PlainText',
                output_key: 'eval_out',
                input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source' }],
                enable_handover_note: false,
              },
            ],
            condition: {
              evaluator_agent_id: 'agent_1',
              pass_keyword: 'PASS',
              fail_keyword: 'FAIL',
              max_loops: 3,
            },
          },
        ],
      });

      const result = runner.run(config, SOURCE);
      const inputTokens = result.steps[0].tasks[0].estimated_input_tokens;

      // min: inputTokens + floor(inputTokens * 0.5)
      const expectedMin = inputTokens + Math.floor(inputTokens * 0.5);
      // max: inputTokens * 3 + floor(inputTokens * 3 * 0.5)
      const expectedMax = inputTokens * 3 + Math.floor(inputTokens * 3 * 0.5);

      expect(result.total_min_tokens).toBe(expectedMin);
      expect(result.total_max_tokens).toBe(expectedMax);
    });

    it('mixed steps: parallel has equal min/max, conditional scales max', () => {
      const config: WorkflowConfig = {
        agents: [
          { id: 'agent_1', name: 'Writer', persona: 'Writer', model: 'claude-sonnet-4-5' },
          { id: 'agent_2', name: 'Judge', persona: 'Judge', model: 'gpt-4o-mini' },
        ],
        workflow: [
          {
            step: 1,
            type: 'parallel',
            pause_after: false,
            tasks: [
              {
                task_id: 'task_1',
                agent_id: 'agent_1',
                task_name: 'Write',
                instructions: ['Write something'],
                constraints: [],
                output_format: 'Markdown',
                output_key: 'draft',
                input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source' }],
                enable_handover_note: false,
              },
            ],
          },
          {
            step: 2,
            type: 'conditional',
            pause_after: false,
            tasks: [
              {
                task_id: 'task_2',
                agent_id: 'agent_2',
                task_name: 'Judge',
                instructions: ['Evaluate quality'],
                constraints: [],
                output_format: 'PlainText',
                output_key: 'verdict',
                input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source' }],
                enable_handover_note: false,
              },
            ],
            condition: {
              evaluator_agent_id: 'agent_2',
              pass_keyword: 'PASS',
              fail_keyword: 'FAIL',
              max_loops: 3,
            },
          },
        ],
      };

      const result = runner.run(config, SOURCE);

      // For parallel step, min and max are equal for that step's tokens
      // For conditional step, max = min * 3
      // Overall: max > min
      expect(result.total_max_tokens).toBeGreaterThan(result.total_min_tokens);
    });
  });

  describe('provider detection', () => {
    it('detects OpenAI provider for gpt models', () => {
      const result = runner.run(makeConfig(), SOURCE);
      expect(result.providers).toContain('openai');
    });

    it('detects Anthropic provider for claude models', () => {
      const config = makeConfig({
        agents: [{ id: 'agent_1', name: 'A', persona: 'p', model: 'claude-haiku-4-5' }],
      });
      const result = runner.run(config, SOURCE);
      expect(result.providers).toContain('anthropic');
    });

    it('detects Google provider for gemini models', () => {
      const config = makeConfig({
        agents: [{ id: 'agent_1', name: 'A', persona: 'p', model: 'gemini-1.5-flash' }],
      });
      const result = runner.run(config, SOURCE);
      expect(result.providers).toContain('google');
    });

    it('deduplicates providers when multiple agents use same provider', () => {
      const config: WorkflowConfig = {
        agents: [
          { id: 'agent_1', name: 'A1', persona: 'p', model: 'gpt-4o' },
          { id: 'agent_2', name: 'A2', persona: 'p', model: 'gpt-4o-mini' },
        ],
        workflow: [
          {
            step: 1,
            type: 'parallel',
            pause_after: false,
            tasks: [
              {
                task_id: 'task_1',
                agent_id: 'agent_1',
                task_name: 'T1',
                instructions: ['do'],
                constraints: [],
                output_format: 'Markdown',
                output_key: 'k1',
                input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'S' }],
                enable_handover_note: false,
              },
              {
                task_id: 'task_2',
                agent_id: 'agent_2',
                task_name: 'T2',
                instructions: ['do'],
                constraints: [],
                output_format: 'Markdown',
                output_key: 'k2',
                input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'S' }],
                enable_handover_note: false,
              },
            ],
          },
        ],
      };

      const result = runner.run(config, SOURCE);
      const openaiCount = result.providers.filter((p) => p === 'openai').length;
      expect(openaiCount).toBe(1);
    });

    it('collects multiple distinct providers', () => {
      const config: WorkflowConfig = {
        agents: [
          { id: 'agent_1', name: 'A1', persona: 'p', model: 'gpt-4o' },
          { id: 'agent_2', name: 'A2', persona: 'p', model: 'claude-sonnet-4-5' },
        ],
        workflow: [
          {
            step: 1,
            type: 'parallel',
            pause_after: false,
            tasks: [
              {
                task_id: 'task_1',
                agent_id: 'agent_1',
                task_name: 'T1',
                instructions: ['do'],
                constraints: [],
                output_format: 'Markdown',
                output_key: 'k1',
                input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'S' }],
                enable_handover_note: false,
              },
              {
                task_id: 'task_2',
                agent_id: 'agent_2',
                task_name: 'T2',
                instructions: ['do'],
                constraints: [],
                output_format: 'Markdown',
                output_key: 'k2',
                input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'S' }],
                enable_handover_note: false,
              },
            ],
          },
        ],
      };

      const result = runner.run(config, SOURCE);
      expect(result.providers).toContain('openai');
      expect(result.providers).toContain('anthropic');
    });
  });

  describe('cost estimation', () => {
    it('min cost is less than or equal to max cost', () => {
      const result = runner.run(makeConfig(), SOURCE);
      expect(result.estimated_min_cost_usd).toBeLessThanOrEqual(result.estimated_max_cost_usd);
    });

    it('cost is greater than zero for a non-empty workflow', () => {
      const result = runner.run(makeConfig(), SOURCE);
      expect(result.estimated_min_cost_usd).toBeGreaterThan(0);
    });

    it('conditional step produces higher max cost than min cost', () => {
      const config = makeConfig({
        workflow: [
          {
            step: 1,
            type: 'conditional',
            pause_after: false,
            tasks: [
              {
                task_id: 'task_1',
                agent_id: 'agent_1',
                task_name: 'Evaluate',
                instructions: ['Check quality'],
                constraints: [],
                output_format: 'PlainText',
                output_key: 'eval_out',
                input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source' }],
                enable_handover_note: false,
              },
            ],
            condition: {
              evaluator_agent_id: 'agent_1',
              pass_keyword: 'PASS',
              fail_keyword: 'FAIL',
              max_loops: 3,
            },
          },
        ],
      });

      const result = runner.run(config, SOURCE);
      expect(result.estimated_max_cost_usd).toBeGreaterThan(result.estimated_min_cost_usd);
    });
  });

  describe('prompt content', () => {
    it('system prompt includes agent persona', () => {
      const result = runner.run(makeConfig(), SOURCE);
      expect(result.steps[0].tasks[0].system_prompt).toContain('Code reviewer');
    });

    it('user prompt includes source filename when using __source__ mapping', () => {
      const result = runner.run(makeConfig(), SOURCE);
      expect(result.steps[0].tasks[0].user_prompt).toContain('test.ts');
    });

    it('user prompt includes source content', () => {
      const result = runner.run(makeConfig(), SOURCE);
      expect(result.steps[0].tasks[0].user_prompt).toContain('const x = 1;');
    });

    it('system prompt includes task instructions', () => {
      const result = runner.run(makeConfig(), SOURCE);
      const sysPrompt = result.steps[0].tasks[0].system_prompt;
      expect(sysPrompt).toContain('Analyze the code');
      expect(sysPrompt).toContain('Find bugs');
    });
  });

  describe('edge cases', () => {
    it('skips tasks whose agent_id does not match any agent', () => {
      const config = makeConfig({
        workflow: [
          {
            step: 1,
            type: 'parallel',
            pause_after: false,
            tasks: [
              {
                task_id: 'orphan_task',
                agent_id: 'non_existent_agent',
                task_name: 'Ghost Task',
                instructions: [],
                constraints: [],
                output_format: 'Markdown',
                output_key: 'ghost_out',
                input_mapping: [],
                enable_handover_note: false,
              },
            ],
          },
        ],
      });

      const result = runner.run(config, SOURCE);
      expect(result.steps[0].tasks).toHaveLength(0);
      expect(result.total_min_tokens).toBe(0);
    });

    it('handles empty workflow gracefully', () => {
      const config = makeConfig({ workflow: [] });
      const result = runner.run(config, SOURCE);

      expect(result.steps).toHaveLength(0);
      expect(result.total_min_tokens).toBe(0);
      expect(result.total_max_tokens).toBe(0);
      expect(result.estimated_min_cost_usd).toBe(0);
      expect(result.estimated_max_cost_usd).toBe(0);
      expect(result.providers).toHaveLength(0);
    });

    it('handles multiple steps with cumulative token totals', () => {
      const config: WorkflowConfig = {
        agents: [{ id: 'agent_1', name: 'A', persona: 'Agent', model: 'gpt-4o' }],
        workflow: [
          {
            step: 1,
            type: 'sequential',
            pause_after: false,
            tasks: [
              {
                task_id: 'task_1',
                agent_id: 'agent_1',
                task_name: 'T1',
                instructions: ['Step one'],
                constraints: [],
                output_format: 'Markdown',
                output_key: 'out1',
                input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'S' }],
                enable_handover_note: false,
              },
            ],
          },
          {
            step: 2,
            type: 'sequential',
            pause_after: false,
            tasks: [
              {
                task_id: 'task_2',
                agent_id: 'agent_1',
                task_name: 'T2',
                instructions: ['Step two'],
                constraints: [],
                output_format: 'Markdown',
                output_key: 'out2',
                input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'S' }],
                enable_handover_note: false,
              },
            ],
          },
        ],
      };

      const result = runner.run(config, SOURCE);
      const task1Tokens = result.steps[0].tasks[0].estimated_input_tokens;
      const task2Tokens = result.steps[1].tasks[0].estimated_input_tokens;
      const expectedMin = task1Tokens + task2Tokens + Math.floor((task1Tokens + task2Tokens) * 0.5);

      expect(result.steps).toHaveLength(2);
      expect(result.total_min_tokens).toBe(expectedMin);
    });
  });
});
