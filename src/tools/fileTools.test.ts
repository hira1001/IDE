import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { readFile, writeFile, editFile, listFiles } from './fileTools.js';
import { FileChangeTracker } from './fileChangeTracker.js';

/** Create a temporary directory and return its path. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aao-test-'));
}

describe('fileTools', () => {
  let tmpDir: string;
  let tracker: FileChangeTracker;

  beforeEach(() => {
    tmpDir = makeTempDir();
    tracker = new FileChangeTracker();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── readFile ──────────────────────────────────────────────────────────────

  describe('readFile', () => {
    it('reads an existing file', () => {
      fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'export const x = 1;');
      expect(readFile('hello.ts', tmpDir)).toBe('export const x = 1;');
    });

    it('throws for a missing file', () => {
      expect(() => readFile('missing.ts', tmpDir)).toThrow('File not found');
    });
  });

  // ─── writeFile ─────────────────────────────────────────────────────────────

  describe('writeFile', () => {
    it('stages the content in the tracker', () => {
      const result = writeFile('src/a.ts', 'new code', tmpDir, tracker);
      expect(tracker.getStaged('src/a.ts')?.newContent).toBe('new code');
      expect(result).toContain('Staged write');
    });

    it('captures original content for existing files', () => {
      fs.writeFileSync(path.join(tmpDir, 'orig.ts'), 'original');
      writeFile('orig.ts', 'updated', tmpDir, tracker);
      expect(tracker.getStaged('orig.ts')?.originalContent).toBe('original');
    });

    it('sets empty originalContent for new files', () => {
      writeFile('brand-new.ts', 'content', tmpDir, tracker);
      expect(tracker.getStaged('brand-new.ts')?.originalContent).toBe('');
    });
  });

  // ─── editFile ──────────────────────────────────────────────────────────────

  describe('editFile', () => {
    it('stages a targeted replacement', () => {
      fs.writeFileSync(path.join(tmpDir, 'edit.ts'), 'const a = 1;\nconst b = 2;\n');
      editFile('edit.ts', 'const a = 1;', 'const a = 99;', tmpDir, tracker);
      expect(tracker.getStaged('edit.ts')?.newContent).toContain('const a = 99;');
    });

    it('throws if old_str is not found', () => {
      fs.writeFileSync(path.join(tmpDir, 'f.ts'), 'hello');
      expect(() => editFile('f.ts', 'NOT_THERE', 'x', tmpDir, tracker)).toThrow('not found');
    });

    it('throws if old_str appears more than once', () => {
      fs.writeFileSync(path.join(tmpDir, 'dup.ts'), 'foo\nfoo\n');
      expect(() => editFile('dup.ts', 'foo', 'bar', tmpDir, tracker)).toThrow('appears 2 times');
    });

    it('edits already-staged content (chained edits)', () => {
      fs.writeFileSync(path.join(tmpDir, 'chain.ts'), 'A\nB\nC\n');
      editFile('chain.ts', 'A', 'X', tmpDir, tracker);
      editFile('chain.ts', 'B', 'Y', tmpDir, tracker);
      expect(tracker.getStaged('chain.ts')?.newContent).toBe('X\nY\nC\n');
    });
  });

  // ─── listFiles ─────────────────────────────────────────────────────────────

  describe('listFiles', () => {
    it('returns matching files', () => {
      fs.writeFileSync(path.join(tmpDir, 'a.ts'), '');
      fs.writeFileSync(path.join(tmpDir, 'b.js'), '');
      const result = listFiles('*.ts', tmpDir);
      expect(result).toContain('a.ts');
      expect(result).not.toContain('b.js');
    });

    it('returns no-match message when nothing found', () => {
      const result = listFiles('*.xyz', tmpDir);
      expect(result).toContain('No files matched');
    });
  });
});
