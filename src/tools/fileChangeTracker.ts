/**
 * FileChangeTracker — accumulates staged file changes during a ReAct loop.
 *
 * Changes are NOT written to disk until commit() is called by the extension host.
 * This class is VS Code API-free so it can be unit-tested without a running IDE.
 * The extension host (ToolExecutor) is responsible for applying changes via
 * vscode.workspace.applyEdit().
 */

export interface StagedChange {
  /** Workspace-relative path (e.g. "src/index.ts"). */
  path: string;
  /** Full new file content. */
  newContent: string;
  /** Content before staging (used for diff display). Empty string for new files. */
  originalContent: string;
}

export class FileChangeTracker {
  private readonly changes = new Map<string, StagedChange>();

  /** Stage a full-file replacement. Overwrites any previous staged change for the same path. */
  stage(path: string, newContent: string, originalContent = ''): void {
    this.changes.set(path, { path, newContent, originalContent });
  }

  /** Return all staged changes as an array. */
  getChanges(): StagedChange[] {
    return Array.from(this.changes.values());
  }

  /** Return the staged content for a specific path, or undefined if not staged. */
  getStaged(path: string): StagedChange | undefined {
    return this.changes.get(path);
  }

  hasChanges(): boolean {
    return this.changes.size > 0;
  }

  clear(): void {
    this.changes.clear();
  }

  /** Human-readable summary of staged changes (for logging / LLM feedback). */
  getSummary(): string {
    const count = this.changes.size;
    if (count === 0) return 'no file changes staged';
    const paths = Array.from(this.changes.keys()).join(', ');
    return `${count} file${count === 1 ? '' : 's'} staged: ${paths}`;
  }
}
