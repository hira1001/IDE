import { SourceInput } from '../types/index.js';

const MAX_BYTES = 100 * 1024; // 100KB

/**
 * File Context Provider — Retrieves active editor content.
 * This module is called from the Extension Host (has access to VS Code API).
 * The vscode module is imported lazily to allow testing outside VS Code.
 */
export class FileContextProvider {
  /**
   * Snapshot the currently active VS Code editor.
   * Returns null if no editor is open.
   * Truncates content if > 100KB.
   */
  getActiveFileSnapshot(): SourceInput | null {
    // Dynamic import of vscode to avoid breaking tests outside VS Code context
    let vscode: typeof import('vscode');
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      vscode = require('vscode');
    } catch {
      return null;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const document = editor.document;
    let content = document.getText();
    const byteSize = Buffer.byteLength(content, 'utf-8');
    let truncated = false;

    if (byteSize > MAX_BYTES) {
      // Truncate to roughly MAX_BYTES by character count
      const ratio = MAX_BYTES / byteSize;
      const charLimit = Math.floor(content.length * ratio);
      content = content.slice(0, charLimit);
      truncated = true;
    }

    return {
      content,
      filename: document.fileName.split('/').pop() ?? document.fileName,
      language_id: document.languageId,
      line_count: document.lineCount,
      byte_size: byteSize,
      ...(truncated ? { truncated: true } as unknown as Record<string, unknown> : {}),
    } as SourceInput;
  }
}
