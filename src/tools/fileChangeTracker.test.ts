import { describe, it, expect, beforeEach } from 'vitest';
import { FileChangeTracker } from './fileChangeTracker.js';

describe('FileChangeTracker', () => {
  let tracker: FileChangeTracker;

  beforeEach(() => {
    tracker = new FileChangeTracker();
  });

  it('starts empty', () => {
    expect(tracker.hasChanges()).toBe(false);
    expect(tracker.getChanges()).toHaveLength(0);
  });

  it('stage() adds a change', () => {
    tracker.stage('src/foo.ts', 'new content', 'old content');
    expect(tracker.hasChanges()).toBe(true);
    expect(tracker.getChanges()).toHaveLength(1);
  });

  it('stage() overwrites previous change for same path', () => {
    tracker.stage('src/foo.ts', 'first', 'original');
    tracker.stage('src/foo.ts', 'second', 'original');
    const changes = tracker.getChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].newContent).toBe('second');
  });

  it('getStaged() returns staged change for known path', () => {
    tracker.stage('a.ts', 'content', 'orig');
    expect(tracker.getStaged('a.ts')?.newContent).toBe('content');
  });

  it('getStaged() returns undefined for unknown path', () => {
    expect(tracker.getStaged('nope.ts')).toBeUndefined();
  });

  it('clear() removes all staged changes', () => {
    tracker.stage('a.ts', 'x', '');
    tracker.stage('b.ts', 'y', '');
    tracker.clear();
    expect(tracker.hasChanges()).toBe(false);
    expect(tracker.getChanges()).toHaveLength(0);
  });

  it('getSummary() describes staged changes', () => {
    tracker.stage('src/a.ts', 'x', '');
    tracker.stage('src/b.ts', 'y', '');
    expect(tracker.getSummary()).toContain('2 files staged');
    expect(tracker.getSummary()).toContain('src/a.ts');
  });

  it('getSummary() handles no changes', () => {
    expect(tracker.getSummary()).toBe('no file changes staged');
  });

  it('stage() accepts missing originalContent (defaults to empty string)', () => {
    tracker.stage('new.ts', 'hello');
    expect(tracker.getStaged('new.ts')?.originalContent).toBe('');
  });
});
