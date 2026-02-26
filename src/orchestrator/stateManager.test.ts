import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from './stateManager.js';

describe('StateManager', () => {
  let manager: StateManager;

  beforeEach(() => {
    manager = new StateManager();
  });

  it('initializes with idle status', () => {
    expect(manager.getStatus()).toBe('idle');
  });

  it('sets and gets output', () => {
    manager.setOutput('draft_text', 'Hello world');
    expect(manager.getOutput('draft_text')).toBe('Hello world');
  });

  it('overwrites output (loop behavior)', () => {
    manager.setOutput('draft_text', 'First version');
    manager.setOutput('draft_text', 'Second version');
    expect(manager.getOutput('draft_text')).toBe('Second version');
  });

  it('manages task states', () => {
    manager.initTaskState('task_001');
    expect(manager.getTaskState('task_001')?.status).toBe('idle');

    manager.setTaskStatus('task_001', 'running');
    expect(manager.getTaskState('task_001')?.status).toBe('running');
  });

  it('tracks token usage', () => {
    manager.addTokenUsage(1000, 500, 0.05);
    manager.addTokenUsage(800, 400, 0.03);
    expect(manager.getTotalTokens().input).toBe(1800);
    expect(manager.getTotalTokens().output).toBe(900);
    expect(manager.getTotalCost()).toBeCloseTo(0.08);
  });

  it('tracks loop counts', () => {
    expect(manager.getLoopCount(2)).toBe(0);
    expect(manager.incrementLoopCount(2)).toBe(1);
    expect(manager.incrementLoopCount(2)).toBe(2);
    expect(manager.getLoopCount(2)).toBe(2);
  });

  it('serializes Maps to plain objects', () => {
    manager.setStatus('running');
    manager.setOutput('key1', 'value1');
    manager.initTaskState('task_1');
    manager.setTaskStatus('task_1', 'completed');

    const serialized = manager.serialize();
    expect(typeof serialized.output_store).toBe('object');
    expect(serialized.output_store['key1']).toBe('value1');
    expect(serialized.task_states['task_1'].status).toBe('completed');
  });

  it('resets cleanly', () => {
    manager.setOutput('key', 'value');
    manager.addTokenUsage(100, 50, 0.01);
    manager.reset();
    expect(manager.getOutput('key')).toBeUndefined();
    expect(manager.getTotalCost()).toBe(0);
  });
});
