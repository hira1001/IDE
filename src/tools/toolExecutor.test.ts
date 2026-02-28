import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ToolExecutor } from './toolExecutor.js';
import { FileChangeTracker } from './fileChangeTracker.js';
import { ToolCall } from '../types/index.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aao-exec-test-'));
}

function makeExecutor(
  tmpDir: string,
  tracker: FileChangeTracker,
  autonomyMode: 'auto' | 'confirm' = 'auto',
  confirmFn = async () => true
): ToolExecutor {
  return new ToolExecutor({
    workspaceRoot: tmpDir,
    tracker,
    autonomyMode,
    confirmTerminal: confirmFn,
  });
}

describe('ToolExecutor', () => {
  let tmpDir: string;
  let tracker: FileChangeTracker;

  beforeEach(() => {
    tmpDir = makeTempDir();
    tracker = new FileChangeTracker();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function call(name: string, args: Record<string, unknown>): ToolCall {
    return { id: 'test-id', name, arguments: args };
  }

  it('read_file returns file content', async () => {
    fs.writeFileSync(path.join(tmpDir, 'x.ts'), 'hello world');
    const exec = makeExecutor(tmpDir, tracker);
    const result = await exec.execute(call('read_file', { path: 'x.ts' }));
    expect(result).toBe('hello world');
  });

  it('read_file returns error string for missing file (no throw)', async () => {
    const exec = makeExecutor(tmpDir, tracker);
    const result = await exec.execute(call('read_file', { path: 'missing.ts' }));
    expect(result).toContain('error');
  });

  it('write_file stages the change', async () => {
    const exec = makeExecutor(tmpDir, tracker);
    await exec.execute(call('write_file', { path: 'new.ts', content: 'export {}' }));
    expect(tracker.getStaged('new.ts')?.newContent).toBe('export {}');
  });

  it('edit_file stages a targeted replacement', async () => {
    fs.writeFileSync(path.join(tmpDir, 'e.ts'), 'const x = 1;');
    const exec = makeExecutor(tmpDir, tracker);
    await exec.execute(call('edit_file', {
      path: 'e.ts', old_str: 'const x = 1;', new_str: 'const x = 2;',
    }));
    expect(tracker.getStaged('e.ts')?.newContent).toBe('const x = 2;');
  });

  it('list_files returns matching paths', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), '');
    const exec = makeExecutor(tmpDir, tracker);
    const result = await exec.execute(call('list_files', { pattern: '*.ts' }));
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
  });

  it('search_code returns matching lines', async () => {
    fs.writeFileSync(path.join(tmpDir, 'code.ts'), 'const hello = 1;\nconst world = 2;\n');
    const exec = makeExecutor(tmpDir, tracker);
    const result = await exec.execute(call('search_code', { pattern: 'hello' }));
    expect(result).toContain('code.ts');
    expect(result).toContain('hello');
  });

  it('run_terminal returns command output in auto mode', async () => {
    const exec = makeExecutor(tmpDir, tracker, 'auto');
    const result = await exec.execute(call('run_terminal', { command: 'echo hello' }));
    expect(result.trim()).toBe('hello');
  });

  it('run_terminal cancels when confirmFn returns false', async () => {
    const exec = makeExecutor(tmpDir, tracker, 'confirm', async () => false);
    const result = await exec.execute(call('run_terminal', { command: 'echo secret' }));
    expect(result).toContain('cancelled');
  });

  it('returns error string for unknown tool (no throw)', async () => {
    const exec = makeExecutor(tmpDir, tracker);
    const result = await exec.execute(call('nonexistent_tool', {}));
    expect(result).toContain('Unknown tool');
  });

  it('get_diagnostics returns unavailable message when no vscode', async () => {
    const exec = makeExecutor(tmpDir, tracker);
    const result = await exec.execute(call('get_diagnostics', {}));
    expect(result).toContain('unavailable');
  });

  it('commitChanges writes files to disk (no-vscode fallback)', async () => {
    const exec = makeExecutor(tmpDir, tracker);
    tracker.stage('out.ts', 'committed content', '');
    await exec.commitChanges();
    const written = fs.readFileSync(path.join(tmpDir, 'out.ts'), 'utf8');
    expect(written).toBe('committed content');
    expect(tracker.hasChanges()).toBe(false);
  });
});
