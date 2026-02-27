import { describe, it, expect } from 'vitest';
import { validateWorkflow } from './validator.js';
import { WorkflowConfig, SourceInput } from '../types/index.js';

const validConfig: WorkflowConfig = {
  agents: [
    { id: 'agent_001', name: 'Writer', persona: 'A writer.', model: 'gpt-4o' },
  ],
  workflow: [
    {
      step: 1,
      type: 'sequential',
      pause_after: false,
      tasks: [
        {
          task_id: 'task_001',
          agent_id: 'agent_001',
          task_name: 'Write draft',
          instructions: ['Write it'],
          constraints: [],
          output_format: 'Markdown',
          output_key: 'draft',
          input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source' }],
          enable_handover_note: false,
        },
      ],
    },
  ],
};

const validSource: SourceInput = {
  content: 'Hello',
  filename: 'test.md',
  language_id: 'markdown',
  line_count: 1,
  byte_size: 5,
};

describe('validateWorkflow', () => {
  it('returns no errors for valid config with API key', () => {
    const errors = validateWorkflow(validConfig, validSource, { openai: 'sk-test' });
    expect(errors.filter((e) => e.type === 'error')).toHaveLength(0);
  });

  it('returns error when source is null', () => {
    const errors = validateWorkflow(validConfig, null, { openai: 'sk-test' });
    expect(errors.some((e) => e.message.includes('No active editor'))).toBe(true);
  });

  it('returns error when API key is missing', () => {
    const errors = validateWorkflow(validConfig, validSource, {});
    expect(errors.some((e) => e.message.includes('openai'))).toBe(true);
  });

  it('returns error for unknown agent reference', () => {
    const badConfig: WorkflowConfig = {
      agents: [],
      workflow: [
        {
          step: 1,
          type: 'sequential',
          pause_after: false,
          tasks: [
            {
              task_id: 'task_001',
              agent_id: 'nonexistent',
              task_name: 'Test',
              instructions: [],
              constraints: [],
              output_format: 'Markdown',
              output_key: 'out',
              input_mapping: [],
              enable_handover_note: false,
            },
          ],
        },
      ],
    };
    const errors = validateWorkflow(badConfig, validSource, {});
    expect(errors.some((e) => e.message.includes('nonexistent'))).toBe(true);
  });

  it('returns error for duplicate output_key in parallel step', () => {
    const badConfig: WorkflowConfig = {
      agents: [
        { id: 'a1', name: 'A1', persona: '', model: 'gpt-4o' },
        { id: 'a2', name: 'A2', persona: '', model: 'gpt-4o' },
      ],
      workflow: [
        {
          step: 1,
          type: 'parallel',
          pause_after: false,
          tasks: [
            {
              task_id: 't1', agent_id: 'a1', task_name: 'T1',
              instructions: [], constraints: [],
              output_format: 'Markdown', output_key: 'same_key',
              input_mapping: [], enable_handover_note: false,
            },
            {
              task_id: 't2', agent_id: 'a2', task_name: 'T2',
              instructions: [], constraints: [],
              output_format: 'Markdown', output_key: 'same_key',
              input_mapping: [], enable_handover_note: false,
            },
          ],
        },
      ],
    };
    const errors = validateWorkflow(badConfig, validSource, { openai: 'sk-test' });
    expect(errors.some((e) => e.message.includes('Duplicate output_key'))).toBe(true);
  });

  it('returns warning for oversized source file', () => {
    const bigSource: SourceInput = { ...validSource, byte_size: 150 * 1024 };
    const errors = validateWorkflow(validConfig, bigSource, { openai: 'sk-test' });
    expect(errors.some((e) => e.type === 'warning' && e.message.includes('KB'))).toBe(true);
  });

  it('does not require API key for ollama: models', () => {
    const ollamaConfig: WorkflowConfig = {
      agents: [
        { id: 'agent_local', name: 'Local', persona: 'A local model.', model: 'ollama:llama3.2' },
      ],
      workflow: [
        {
          step: 1,
          type: 'sequential',
          pause_after: false,
          tasks: [
            {
              task_id: 'task_local',
              agent_id: 'agent_local',
              task_name: 'Local task',
              instructions: ['Do it locally'],
              constraints: [],
              output_format: 'PlainText',
              output_key: 'local_out',
              input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source' }],
              enable_handover_note: false,
            },
          ],
        },
      ],
    };
    // No API keys provided — should still pass for Ollama models
    const errors = validateWorkflow(ollamaConfig, validSource, {});
    expect(errors.filter((e) => e.type === 'error')).toHaveLength(0);
  });

  it('warns when a parallel step has more than 5 tasks', () => {
    const makeTask = (id: string): typeof validConfig.workflow[0]['tasks'][0] => ({
      task_id: id, agent_id: 'agent_001', task_name: id,
      instructions: [], constraints: [],
      output_format: 'PlainText', output_key: id,
      input_mapping: [], enable_handover_note: false,
    });
    const manyParallelConfig: WorkflowConfig = {
      agents: [{ id: 'agent_001', name: 'Writer', persona: 'P', model: 'gpt-4o' }],
      workflow: [{
        step: 1, type: 'parallel', pause_after: false,
        tasks: ['t1','t2','t3','t4','t5','t6'].map(makeTask),
      }],
    };
    const errors = validateWorkflow(manyParallelConfig, validSource, { openai: 'sk-test' });
    expect(errors.some((e) => e.message.includes('Maximum allowed parallel tasks is 5'))).toBe(true);
  });

  it('warns when control flow creates a cycle', () => {
    const cyclicConfig: WorkflowConfig = {
      agents: [{ id: 'agent_001', name: 'Writer', persona: 'P', model: 'gpt-4o' }],
      workflow: [
        {
          step: 1, type: 'sequential', pause_after: false,
          then_goto: 2,
          tasks: [{
            task_id: 't1', agent_id: 'agent_001', task_name: 'T1',
            instructions: [], constraints: [],
            output_format: 'PlainText', output_key: 'o1',
            input_mapping: [], enable_handover_note: false,
          }],
        },
        {
          step: 2, type: 'sequential', pause_after: false,
          then_goto: 1,  // loops back → cycle
          tasks: [{
            task_id: 't2', agent_id: 'agent_001', task_name: 'T2',
            instructions: [], constraints: [],
            output_format: 'PlainText', output_key: 'o2',
            input_mapping: [], enable_handover_note: false,
          }],
        },
      ],
    };
    const errors = validateWorkflow(cyclicConfig, validSource, { openai: 'sk-test' });
    expect(errors.some((e) => e.message.toLowerCase().includes('cycle') || e.message.toLowerCase().includes('loop'))).toBe(true);
  });

  it('does not flag __project__ or __tree__ input_mapping as unknown agents', () => {
    const config: WorkflowConfig = {
      agents: [{ id: 'agent_001', name: 'Writer', persona: 'P', model: 'gpt-4o' }],
      workflow: [{
        step: 1, type: 'sequential', pause_after: false,
        tasks: [{
          task_id: 't1', agent_id: 'agent_001', task_name: 'T1',
          instructions: [], constraints: [],
          output_format: 'PlainText', output_key: 'o1',
          enable_handover_note: false,
          input_mapping: [
            { from_step: 0, from_agent_id: '__project__', label: 'Project Context' },
            { from_step: 0, from_agent_id: '__tree__', label: 'File Tree' },
          ],
        }],
      }],
    };
    const errors = validateWorkflow(config, validSource, { openai: 'sk-test' });
    const agentErrors = errors.filter((e) => e.message.includes('unknown agent'));
    expect(agentErrors).toHaveLength(0);
  });
});
