import * as fs from 'fs';
import * as path from 'path';

/**
 * Search for a regex pattern in files within the workspace.
 * Returns matching lines with file path and line number.
 *
 * @param pattern     - Regular expression string
 * @param scopePath   - Workspace-relative path or glob to restrict search scope (optional)
 * @param workspaceRoot - Absolute path to the workspace root
 * @param maxResults  - Maximum number of matching lines to return (default: 100)
 */
export function searchCode(
  pattern: string,
  workspaceRoot: string,
  scopePath?: string,
  maxResults = 100
): string {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'g');
  } catch {
    throw new Error(`Invalid regular expression: ${pattern}`);
  }

  const searchRoot = scopePath
    ? path.join(workspaceRoot, scopePath.replace(/\*.*$/, '')) // strip glob part
    : workspaceRoot;

  const files = collectFiles(
    fs.existsSync(searchRoot) && fs.statSync(searchRoot).isDirectory()
      ? searchRoot
      : workspaceRoot
  );

  // Apply scope filter
  const filtered = scopePath
    ? files.filter((f) => {
        const rel = path.relative(workspaceRoot, f);
        return matchesScope(rel, scopePath);
      })
    : files;

  const results: string[] = [];
  for (const file of filtered) {
    if (results.length >= maxResults) break;
    try {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          const rel = path.relative(workspaceRoot, file);
          results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
          if (results.length >= maxResults) break;
        }
      }
    } catch {
      // Skip unreadable files (binary, permission issues)
    }
  }

  if (results.length === 0) return `No matches found for: ${pattern}`;
  const header =
    results.length >= maxResults
      ? `First ${maxResults} matches for "${pattern}":`
      : `${results.length} match${results.length === 1 ? '' : 'es'} for "${pattern}":`;
  return header + '\n' + results.join('\n');
}

/**
 * Resolve a glob pattern to a list of workspace-relative file paths.
 * Used by list_files and internally by searchCode.
 */
export function glob(pattern: string, workspaceRoot: string): string[] {
  const allFiles = collectFiles(workspaceRoot);
  return allFiles
    .map((f) => path.relative(workspaceRoot, f))
    .filter((rel) => matchesGlob(rel, pattern));
}

// ─── private helpers ──────────────────────────────────────────────────────────

/** Recursively collect all files under a directory, skipping common ignore patterns. */
function collectFiles(dir: string): string[] {
  const IGNORED = new Set([
    'node_modules', '.git', 'dist', 'out', '.vscode-test', 'coverage',
  ]);
  const results: string[] = [];

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

/** Minimal glob matching supporting *, **, and ? wildcards. */
function matchesGlob(filePath: string, pattern: string): boolean {
  // Convert glob to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex chars (not * or ?)
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/__DOUBLE_STAR__\//g, '(?:.+/)?')
    .replace(/__DOUBLE_STAR__/g, '.*');

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(filePath);
}

/** Check if a relative path is within a scope filter (path or glob). */
function matchesScope(relPath: string, scope: string): boolean {
  if (scope.includes('*')) return matchesGlob(relPath, scope);
  return relPath.startsWith(scope);
}
