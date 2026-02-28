import * as path from 'path';

/**
 * IDE-integrated tools that require VS Code API access.
 * These functions accept the vscode module/objects as parameters
 * to allow mocking in tests.
 */

export interface DiagnosticItem {
  file: string;
  line: number;
  character: number;
  severity: 'Error' | 'Warning' | 'Information' | 'Hint';
  message: string;
  source?: string;
}

export interface LocationItem {
  file: string;
  line: number;
  character: number;
}

/** VS Code API surface needed by ideTools. */
export interface VscodeDiagnosticsApi {
  languages: {
    getDiagnostics(uri?: unknown): unknown[];
    getDiagnostics(): Array<[unknown, unknown[]]>;
  };
  Uri: {
    file(path: string): unknown;
  };
  workspace: {
    workspaceFolders?: Array<{ uri: { fsPath: string } }>;
  };
  DiagnosticSeverity: {
    Error: number;
    Warning: number;
    Information: number;
    Hint: number;
  };
}

export interface VscodeCommandsApi {
  commands: {
    executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
  };
  Uri: {
    file(path: string): unknown;
  };
  Position: new (line: number, character: number) => unknown;
  Location?: new (uri: unknown, position: unknown) => unknown;
}

/**
 * Get TypeScript/linter diagnostics from VS Code.
 * Returns a JSON string with the diagnostic list.
 */
export function getDiagnostics(
  vscode: VscodeDiagnosticsApi,
  workspaceRoot: string,
  filePath?: string
): string {
  const allDiagnostics: DiagnosticItem[] = [];

  if (filePath) {
    const absPath = path.join(workspaceRoot, filePath);
    const uri = vscode.Uri.file(absPath);
    const diags = vscode.languages.getDiagnostics(uri) as DiagnosticEntry[];
    allDiagnostics.push(...diags.map((d) => formatDiagnostic(d, filePath, vscode)));
  } else {
    const all = vscode.languages.getDiagnostics() as Array<[UriLike, DiagnosticEntry[]]>;
    for (const [uri, diags] of all) {
      const rel = path.relative(workspaceRoot, (uri as UriLike).fsPath ?? '');
      allDiagnostics.push(...diags.map((d) => formatDiagnostic(d, rel, vscode)));
    }
  }

  if (allDiagnostics.length === 0) {
    return filePath
      ? `No diagnostics in ${filePath}.`
      : 'No diagnostics in workspace.';
  }

  const errorCount = allDiagnostics.filter((d) => d.severity === 'Error').length;
  const warnCount = allDiagnostics.filter((d) => d.severity === 'Warning').length;
  return (
    `${allDiagnostics.length} diagnostic(s): ${errorCount} error(s), ${warnCount} warning(s)\n` +
    JSON.stringify(allDiagnostics, null, 2)
  );
}

/**
 * Get the definition location of a symbol at a specific file position.
 */
export async function getDefinition(
  vscode: VscodeCommandsApi,
  workspaceRoot: string,
  filePath: string,
  line: number,
  character: number
): Promise<string> {
  const absPath = path.join(workspaceRoot, filePath);
  const uri = vscode.Uri.file(absPath);
  const position = new vscode.Position(line, character);

  const locations = (await vscode.commands.executeCommand(
    'vscode.executeDefinitionProvider',
    uri,
    position
  )) as LocationLike[] | null;

  if (!locations || locations.length === 0) {
    return `No definition found at ${filePath}:${line + 1}:${character + 1}`;
  }

  const items: LocationItem[] = locations.map((loc) => ({
    file: path.relative(workspaceRoot, loc.uri?.fsPath ?? ''),
    line: (loc.range?.start?.line ?? 0) + 1,
    character: (loc.range?.start?.character ?? 0) + 1,
  }));

  return `Definition(s) for ${filePath}:${line + 1}:\n` + JSON.stringify(items, null, 2);
}

/**
 * Find all references to a symbol at a specific file position.
 */
export async function findReferences(
  vscode: VscodeCommandsApi,
  workspaceRoot: string,
  filePath: string,
  line: number,
  character: number
): Promise<string> {
  const absPath = path.join(workspaceRoot, filePath);
  const uri = vscode.Uri.file(absPath);
  const position = new vscode.Position(line, character);

  const locations = (await vscode.commands.executeCommand(
    'vscode.executeReferenceProvider',
    uri,
    position,
    { includeDeclaration: true }
  )) as LocationLike[] | null;

  if (!locations || locations.length === 0) {
    return `No references found at ${filePath}:${line + 1}:${character + 1}`;
  }

  const items: LocationItem[] = locations.map((loc) => ({
    file: path.relative(workspaceRoot, loc.uri?.fsPath ?? ''),
    line: (loc.range?.start?.line ?? 0) + 1,
    character: (loc.range?.start?.character ?? 0) + 1,
  }));

  return `${items.length} reference(s) for ${filePath}:${line + 1}:\n` + JSON.stringify(items, null, 2);
}

// ─── internal type shims ──────────────────────────────────────────────────────

interface DiagnosticEntry {
  severity: number;
  message: string;
  range: { start: { line: number; character: number } };
  source?: string;
}

interface UriLike {
  fsPath?: string;
}

interface LocationLike {
  uri?: { fsPath?: string };
  range?: { start?: { line?: number; character?: number } };
}

function formatDiagnostic(
  d: DiagnosticEntry,
  filePath: string,
  vscode: VscodeDiagnosticsApi
): DiagnosticItem {
  const severityMap: Record<number, DiagnosticItem['severity']> = {
    [vscode.DiagnosticSeverity.Error]: 'Error',
    [vscode.DiagnosticSeverity.Warning]: 'Warning',
    [vscode.DiagnosticSeverity.Information]: 'Information',
    [vscode.DiagnosticSeverity.Hint]: 'Hint',
  };
  return {
    file: filePath,
    line: (d.range?.start?.line ?? 0) + 1,
    character: (d.range?.start?.character ?? 0) + 1,
    severity: severityMap[d.severity] ?? 'Information',
    message: d.message,
    source: d.source,
  };
}
