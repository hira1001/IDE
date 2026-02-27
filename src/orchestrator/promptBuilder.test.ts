import { describe, it, expect } from 'vitest';
import { PromptBuilder } from './promptBuilder.js';
import { StateManager } from './stateManager.js';
import { Agent, Task, WorkflowConfig, SourceInput } from '../types/index.js';

const SOURCE: SourceInput = {
  content: 'function hello() { return "world"; }',
  filename: 'hello.ts',
  language_id: 'typescript',
  line_count: 1,
  byte_size: 36,
};

const AGENT: Agent = {
  id: 'agent_1',
  name: 'Reviewer',
  persona: 'You are an expert code reviewer.',
  model: 'gpt-4o',
};

const TASK: Task = {
  task_id: 'task_1',
  agent_id: 'agent_1',
  task_name: 'Code Review',
  instructions: ['Check for bugs', 'Verify naming conventions', 'Assess readability'],
  constraints: ['Be concise', 'Use bullet points'],
  output_format: 'Markdown',
  output_key: 'review_out',
  input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source file' }],
  enable_handover_note: false,
};

const CONFIG: WorkflowConfig = {
  agents: [AGENT],
  workflow: [
    { step: 1, type: 'parallel', pause_after: false, tasks: [TASK] },
  ],
};

function makeBuilder(source: SourceInput | null = SOURCE): { builder: PromptBuilder; stateManager: StateManager } {
  const stateManager = new StateManager();
  if (source) stateManager.setSource(source);
  const builder = new PromptBuilder(stateManager, source);
  return { builder, stateManager };
}

describe('PromptBuilder', () => {
  describe('buildSystemPrompt()', () => {
    it('includes agent persona', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, TASK);
      expect(prompt).toContain('You are an expert code reviewer.');
    });

    it('includes all instructions as numbered list', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, TASK);
      expect(prompt).toContain('1. Check for bugs');
      expect(prompt).toContain('2. Verify naming conventions');
      expect(prompt).toContain('3. Assess readability');
    });

    it('includes all constraints', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, TASK);
      expect(prompt).toContain('- Be concise');
      expect(prompt).toContain('- Use bullet points');
    });

    it('includes output format directive', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, TASK);
      expect(prompt).toContain('Markdown');
    });

    it('wraps content in system_instructions tags', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, TASK);
      expect(prompt).toMatch(/^<system_instructions>/);
      expect(prompt).toMatch(/<\/system_instructions>$/);
    });

    it('includes prompt injection warning', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, TASK);
      expect(prompt).toContain('<user_data>');
    });

    it('does NOT include handover note section when disabled', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, { ...TASK, enable_handover_note: false });
      expect(prompt).not.toContain('引き継ぎメモ');
    });

    it('includes handover note section when enabled', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, { ...TASK, enable_handover_note: true });
      expect(prompt).toContain('引き継ぎメモ');
    });

    it('does NOT include loop note when loopCount is 0', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, TASK, 0);
      expect(prompt).not.toContain('レビューサイクル');
    });

    it('includes loop note when loopCount > 0', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, TASK, 2);
      expect(prompt).toContain('2');
      expect(prompt).toContain('レビューサイクル');
    });

    it('handles empty instructions list', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, { ...TASK, instructions: [] });
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('handles empty constraints list', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildSystemPrompt(AGENT, { ...TASK, constraints: [] });
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('buildUserPrompt()', () => {
    it('includes source content via __source__ mapping', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildUserPrompt(TASK, CONFIG);
      expect(prompt).toContain('function hello() { return "world"; }');
    });

    it('includes source filename in prompt', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildUserPrompt(TASK, CONFIG);
      expect(prompt).toContain('hello.ts');
    });

    it('includes source language_id and line_count', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildUserPrompt(TASK, CONFIG);
      expect(prompt).toContain('typescript');
      expect(prompt).toContain('1行');
    });

    it('uses mapping label as section header', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildUserPrompt(TASK, CONFIG);
      expect(prompt).toContain('Source file');
    });

    it('wraps content in user_data tags', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildUserPrompt(TASK, CONFIG);
      expect(prompt).toMatch(/<user_data>/);
      expect(prompt).toMatch(/<\/user_data>/);
    });

    it('uses StateManager source when constructor source is null', () => {
      const stateManager = new StateManager();
      stateManager.setSource(SOURCE);
      const builder = new PromptBuilder(stateManager, null);
      const prompt = builder.buildUserPrompt(TASK, CONFIG);
      expect(prompt).toContain('function hello()');
    });

    it('produces empty content section when no source is available', () => {
      const stateManager = new StateManager();
      const builder = new PromptBuilder(stateManager, null);
      const prompt = builder.buildUserPrompt(TASK, CONFIG);
      // No source → sections are empty, but tags are still there
      expect(prompt).toContain('<user_data>');
    });

    it('includes output from another agent when input_mapping references it', () => {
      const agent2: Agent = { id: 'agent_2', name: 'Writer', persona: 'Writer', model: 'gpt-4o-mini' };
      const task1: Task = { ...TASK };
      const task2: Task = {
        task_id: 'task_2',
        agent_id: 'agent_2',
        task_name: 'Process Review',
        instructions: ['Use the review output'],
        constraints: [],
        output_format: 'Markdown',
        output_key: 'processed_out',
        input_mapping: [{ from_step: 1, from_agent_id: 'agent_1', label: 'Review result' }],
        enable_handover_note: false,
      };
      const config2: WorkflowConfig = {
        agents: [AGENT, agent2],
        workflow: [
          { step: 1, type: 'parallel', pause_after: false, tasks: [task1] },
          { step: 2, type: 'sequential', pause_after: false, tasks: [task2] },
        ],
      };

      const stateManager = new StateManager();
      stateManager.setOutput('review_out', 'The code looks great!');
      const builder = new PromptBuilder(stateManager, SOURCE);
      const prompt = builder.buildUserPrompt(task2, config2);
      expect(prompt).toContain('The code looks great!');
      expect(prompt).toContain('Review result');
    });

    it('skips input_mapping entry when referenced agent output is not yet set', () => {
      const task2: Task = {
        task_id: 'task_2',
        agent_id: 'agent_1',
        task_name: 'Second step',
        instructions: ['Use previous output'],
        constraints: [],
        output_format: 'Markdown',
        output_key: 'second_out',
        input_mapping: [{ from_step: 1, from_agent_id: 'agent_1', label: 'Previous' }],
        enable_handover_note: false,
      };
      const config2: WorkflowConfig = {
        agents: [AGENT],
        workflow: [
          { step: 1, type: 'sequential', pause_after: false, tasks: [TASK] },
          { step: 2, type: 'sequential', pause_after: false, tasks: [task2] },
        ],
      };

      const { builder } = makeBuilder(); // output_store is empty
      const prompt = builder.buildUserPrompt(task2, config2);
      // Should not contain the label since output is missing
      expect(prompt).not.toContain('Previous');
    });

    it('includes handover note from previous agent when available', () => {
      const agent2: Agent = { id: 'agent_2', name: 'Writer', persona: 'Writer', model: 'gpt-4o-mini' };
      const task2: Task = {
        task_id: 'task_2',
        agent_id: 'agent_2',
        task_name: 'Process',
        instructions: [],
        constraints: [],
        output_format: 'Markdown',
        output_key: 'out2',
        input_mapping: [{ from_step: 1, from_agent_id: 'agent_1', label: 'From reviewer' }],
        enable_handover_note: false,
      };
      const config2: WorkflowConfig = {
        agents: [AGENT, agent2],
        workflow: [
          { step: 1, type: 'sequential', pause_after: false, tasks: [TASK] },
          { step: 2, type: 'sequential', pause_after: false, tasks: [task2] },
        ],
      };

      const stateManager = new StateManager();
      stateManager.setOutput('review_out', 'Great code!');
      stateManager.addHandoverNote({ from_agent_id: 'agent_1', from_step: 1, note: 'Check edge cases.' });
      const builder = new PromptBuilder(stateManager, SOURCE);
      const prompt = builder.buildUserPrompt(task2, config2);
      expect(prompt).toContain('Check edge cases.');
    });
  });

  describe('buildRetryPrompt()', () => {
    it('references the output format name', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildRetryPrompt('some output', 'JSON');
      expect(prompt).toContain('JSON');
    });

    it('includes the first 200 chars of the previous output', () => {
      const { builder } = makeBuilder();
      const previousOutput = 'A'.repeat(300);
      const prompt = builder.buildRetryPrompt(previousOutput, 'Markdown');
      expect(prompt).toContain('A'.repeat(200));
      expect(prompt).not.toContain('A'.repeat(201));
    });

    it('includes format-specific instructions for Markdown', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildRetryPrompt('bad output', 'Markdown');
      expect(prompt).toContain('Markdown');
    });

    it('includes format-specific instructions for Mermaid', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildRetryPrompt('bad output', 'Mermaid');
      expect(prompt).toContain('graph TD');
    });

    it('includes format-specific instructions for JSON', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildRetryPrompt('bad output', 'JSON');
      expect(prompt).toContain('{}');
    });

    it('includes format-specific instructions for Code', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildRetryPrompt('bad output', 'Code');
      expect(prompt).toContain('Code');
    });

    it('handles unknown output format gracefully', () => {
      const { builder } = makeBuilder();
      const prompt = builder.buildRetryPrompt('bad output', 'CustomFormat');
      expect(prompt).toContain('CustomFormat');
    });
  });
});
