import { ToolCall } from '../types/index.js';
import { FileChangeTracker } from './fileChangeTracker.js';
import { readFile, writeFile, editFile, listFiles } from './fileTools.js';
import { searchCode } from './searchTools.js';
import { getDiagnostics, getDefinition, findReferences } from './ideTools.js';
import { runTerminal } from './terminalTools.js';

/**
 * VS Code API surface needed by ToolExecutor for IDE tools.
 * Injected at construction time so the executor can be tested without a real IDE.
 */
export interface ToolExecutorOptions {
  workspaceRoot: string;
  tracker: FileChangeTracker;
  /** 'auto' = apply file changes and run terminal without confirmation;
   *  'confirm' = ask user before terminal commands and (optionally) file writes. */
  autonomyMode: 'auto' | 'confirm';
  /** Called when autonomyMode === 'confirm' and a terminal command is about to run. */
  confirmTerminal: (command: string) => Promise<boolean>;
  /** VS Code API objects — undefined when running in a test/non-IDE environment. */
  vscode?: VscodeApiForTools;
}

/** Minimal VS Code API surface needed for IDE tools. */
export interface VscodeApiForTools {
  languages: {
    getDiagnostics(uri?: unknown): unknown[];
    getDiagnostics(): Array<[unknown, unknown[]]>;
  };
  Uri: {
    file(path: string): unknown;
    parse(str: string): unknown;
  };
  workspace: {
    applyEdit(edit: unknown): Promise<boolean>;
    workspaceFolders?: Array<{ uri: { fsPath: string } }>;
  };
  WorkspaceEdit: new () => WorkspaceEditLike;
  Range: new (start: unknown, end: unknown) => unknown;
  Position: new (line: number, character: number) => unknown;
  DiagnosticSeverity: {
    Error: number;
    Warning: number;
    Information: number;
    Hint: number;
  };
  commands: {
    executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
  };
}

interface WorkspaceEditLike {
  createFile(uri: unknown, opts?: { overwrite?: boolean; ignoreIfExists?: boolean }): void;
  delete(uri: unknown, range: unknown): void;
  insert(uri: unknown, position: unknown, content: string): void;
  replace(uri: unknown, range: unknown, content: string): void;
}

/**
 * ToolExecutor — dispatches LLM tool calls to their implementations.
 *
 * File tools (read/write/edit/list/search) run without VS Code API.
 * IDE tools (diagnostics, definition, references) require vscode to be set.
 * Terminal tool runs via child_process.execSync.
 */
export class ToolExecutor {
  constructor(private readonly opts: ToolExecutorOptions) {}

  /**
   * Execute a single tool call and return the result as a string.
   * Never throws — errors are returned as descriptive strings so the LLM
   * can observe and react to them.
   */
  async execute(call: ToolCall): Promise<string> {
    try {
      return await this.dispatch(call);
    } catch (err) {
      return `Tool "${call.name}" error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async dispatch(call: ToolCall): Promise<string> {
    const { workspaceRoot, tracker, autonomyMode, vscode } = this.opts;
    const args = call.arguments;

    switch (call.name) {
      case 'read_file':
        return readFile(str(args.path), workspaceRoot);

      case 'write_file':
        return writeFile(str(args.path), str(args.content), workspaceRoot, tracker);

      case 'edit_file':
        return editFile(str(args.path), str(args.old_str), str(args.new_str), workspaceRoot, tracker);

      case 'list_files':
        return listFiles(str(args.pattern), workspaceRoot);

      case 'search_code':
        return searchCode(
          str(args.pattern),
          workspaceRoot,
          args.path ? str(args.path) : undefined
        );

      case 'get_diagnostics':
        if (!vscode) return 'IDE tools unavailable (no VS Code API).';
        return getDiagnostics(
          vscode,
          workspaceRoot,
          args.path ? str(args.path) : undefined
        );

      case 'get_definition':
        if (!vscode) return 'IDE tools unavailable (no VS Code API).';
        return getDefinition(vscode, workspaceRoot, str(args.path), num(args.line), num(args.character));

      case 'find_references':
        if (!vscode) return 'IDE tools unavailable (no VS Code API).';
        return findReferences(vscode, workspaceRoot, str(args.path), num(args.line), num(args.character));

      case 'run_terminal':
        return runTerminal(
          str(args.command),
          workspaceRoot,
          autonomyMode === 'auto',
          this.opts.confirmTerminal
        );

      default:
        return `Unknown tool: ${call.name}`;
    }
  }

  /**
   * Apply all staged file changes to disk via VS Code WorkspaceEdit.
   * Must be called after the ReAct loop completes (or at each iteration
   * if auto_apply_edits is true).
   */
  async commitChanges(): Promise<void> {
    const { vscode, tracker, workspaceRoot } = this.opts;
    if (!tracker.hasChanges()) return;

    if (!vscode) {
      // Fallback for non-IDE context: write directly via fs
      const fs = await import('fs');
      const path = await import('path');
      for (const change of tracker.getChanges()) {
        const abs = path.resolve(workspaceRoot, change.path);
        if (path.relative(workspaceRoot, abs).startsWith('..') || path.isAbsolute(path.relative(workspaceRoot, abs))) {
          throw new Error(`Path traversal not allowed in commitChanges: "${change.path}"`);
        }
        const absPath = abs;
        const dir = path.dirname(absPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(absPath, change.newContent, 'utf8');
      }
      tracker.clear();
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const path = await import('path');
    for (const change of tracker.getChanges()) {
      const absPath = path.join(workspaceRoot, change.path);
      const uri = vscode.Uri.file(absPath);
      // Replace entire file content
      const startPos = new vscode.Position(0, 0);
      const endPos = new vscode.Position(Number.MAX_SAFE_INTEGER, 0);
      const range = new vscode.Range(startPos, endPos);
      edit.replace(uri as Parameters<WorkspaceEditLike['replace']>[0], range, change.newContent);
    }
    await vscode.workspace.applyEdit(edit);
    tracker.clear();
  }
}

// ─── argument coercion helpers ─────────────────────────────────────────────────

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  throw new Error(`Expected string argument, got ${typeof v}: ${JSON.stringify(v)}`);
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Expected numeric argument, got ${JSON.stringify(v)}`);
  return n;
}
