import * as fs from 'fs';
import * as path from 'path';
import { glob } from './searchTools.js';
import { FileChangeTracker } from './fileChangeTracker.js';

/**
 * Resolve a workspace-relative path to an absolute path and verify it stays
 * within the workspace root. Throws if the resolved path would escape the root
 * (path traversal attack prevention).
 */
function resolveWithinWorkspace(filePath: string, workspaceRoot: string): string {
  const abs = path.resolve(workspaceRoot, filePath);
  const rel = path.relative(workspaceRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path traversal not allowed: "${filePath}"`);
  }
  return abs;
}

/**
 * Read a file at the given workspace-relative path.
 * Returns the file content as a UTF-8 string.
 * Throws with a descriptive message if the file does not exist.
 */
export function readFile(filePath: string, workspaceRoot: string): string {
  const absPath = resolveWithinWorkspace(filePath, workspaceRoot);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return fs.readFileSync(absPath, 'utf8');
}

/**
 * Stage a full-file write via the FileChangeTracker.
 * The actual disk write happens when the ToolExecutor commits changes.
 * Returns a confirmation message for the LLM.
 */
export function writeFile(
  filePath: string,
  content: string,
  workspaceRoot: string,
  tracker: FileChangeTracker
): string {
  const absPath = resolveWithinWorkspace(filePath, workspaceRoot);
  const originalContent = fs.existsSync(absPath)
    ? fs.readFileSync(absPath, 'utf8')
    : '';
  tracker.stage(filePath, content, originalContent);
  return `Staged write to ${filePath} (${content.split('\n').length} lines).`;
}

/**
 * Stage a targeted string replacement within a file.
 * Reads the current file content (or uses any already-staged version),
 * replaces the first occurrence of old_str with new_str, and stages the result.
 *
 * Throws if old_str is not found exactly once.
 */
export function editFile(
  filePath: string,
  oldStr: string,
  newStr: string,
  workspaceRoot: string,
  tracker: FileChangeTracker
): string {
  // Use staged content if already modified in this session
  const staged = tracker.getStaged(filePath);
  const currentContent = staged
    ? staged.newContent
    : readFile(filePath, workspaceRoot);

  const occurrences = countOccurrences(currentContent, oldStr);
  if (occurrences === 0) {
    throw new Error(
      `edit_file: old_str not found in ${filePath}.\n` +
      `Searched for:\n${oldStr.slice(0, 200)}`
    );
  }
  if (occurrences > 1) {
    throw new Error(
      `edit_file: old_str appears ${occurrences} times in ${filePath} (must be unique).\n` +
      `Searched for:\n${oldStr.slice(0, 200)}`
    );
  }

  const newContent = currentContent.replace(oldStr, newStr);
  const absPath = resolveWithinWorkspace(filePath, workspaceRoot);
  const originalContent = staged?.originalContent ?? (
    fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : ''
  );
  tracker.stage(filePath, newContent, originalContent);

  const linesChanged = Math.abs(
    newStr.split('\n').length - oldStr.split('\n').length
  );
  return (
    `Staged edit to ${filePath}: replaced ${oldStr.split('\n').length}-line block` +
    (linesChanged ? ` (net ${linesChanged > 0 ? '+' : ''}${linesChanged} lines)` : '') +
    '.'
  );
}

/**
 * List files matching a glob pattern.
 * Returns a newline-separated list of workspace-relative paths.
 */
export function listFiles(pattern: string, workspaceRoot: string): string {
  const matches = glob(pattern, workspaceRoot);
  if (matches.length === 0) return `No files matched pattern: ${pattern}`;
  return matches.join('\n');
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let idx = text.indexOf(search);
  while (idx !== -1) {
    count++;
    idx = text.indexOf(search, idx + 1);
  }
  return count;
}
