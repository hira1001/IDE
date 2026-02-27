import * as fs from 'fs';
import * as path from 'path';
import { FileContextProvider } from './fileContextProvider.js';
import {
  ProjectContext,
  ProjectContextOptions,
  ProjectContextSummary,
  ContextFile,
  ProjectMeta,
  SourceInput,
} from '../types/index.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4; // conservative estimate
const MAX_FILE_BYTES = 80 * 1024; // 80KB per related file
const MAX_TREE_DEPTH = 6;

/** Directories always excluded from traversal. */
const HARD_EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.vscode', '.idea',
  '__pycache__', '.cache', '.next', '.nuxt', 'coverage', '.nyc_output',
  'vendor', 'bower_components', '.turbo', '.vercel', '.netlify',
]);

/** Binary / generated file extensions to skip. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.mp3', '.wav', '.ogg', '.webm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.lock', // package-lock.json etc. — very noisy
  '.map',  // sourcemaps
]);

/** Lock / generated files to skip by exact basename. */
const SKIP_BASENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock',
  'Gemfile.lock', 'composer.lock', 'poetry.lock',
  'CHANGELOG.md', 'CHANGELOG', 'CHANGES',
]);

/** Config files valuable as project context (included before other related files). */
const CONFIG_BASENAMES = new Set([
  'package.json', 'tsconfig.json', 'tsconfig.base.json',
  '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml',
  'vite.config.ts', 'vite.config.js',
  'webpack.config.js', 'webpack.config.ts',
  'jest.config.ts', 'jest.config.js',
  'pyproject.toml', 'setup.py', 'requirements.txt',
  'Cargo.toml', 'go.mod',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
]);

/** VS Code language ID mapping by extension. */
const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescriptreact',
  '.js': 'javascript', '.jsx': 'javascriptreact',
  '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.rb': 'ruby', '.go': 'go',
  '.rs': 'rust', '.java': 'java', '.cs': 'csharp',
  '.cpp': 'cpp', '.cc': 'cpp', '.c': 'c', '.h': 'c', '.hpp': 'cpp',
  '.md': 'markdown', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml', '.sh': 'shellscript', '.bash': 'shellscript',
  '.html': 'html', '.css': 'css', '.scss': 'scss', '.sass': 'sass',
  '.vue': 'vue', '.svelte': 'svelte',
  '.sql': 'sql', '.graphql': 'graphql',
};

// ─── ProjectContextProvider ────────────────────────────────────────────────────

/**
 * Builds a rich ProjectContext from the workspace.
 * This is the extension host–side service that powers whole-project understanding.
 *
 * Architecture:
 *   Layer 1: File tree     (~300-600 tokens)  — always included
 *   Layer 2: Active file   (~500-8000 tokens) — current editor
 *   Layer 3: Related files (~1000-20000 tok.) — import-resolved, budget-capped
 */
export class ProjectContextProvider {
  constructor(private readonly fileContextProvider: FileContextProvider) {}

  /**
   * Build the full ProjectContext for the active workspace.
   * Falls back to file-only mode when no workspace folder is open.
   */
  async buildProjectContext(
    workspaceRoot: string | undefined,
    options: ProjectContextOptions
  ): Promise<ProjectContext> {
    const activeFile = this.fileContextProvider.getActiveFileSnapshot();

    if (!workspaceRoot || options.mode === 'file') {
      // File-only mode — same as the original behavior
      const meta = this.buildMinimalMeta(workspaceRoot, activeFile);
      const tokenEstimate = activeFile
        ? Math.ceil(Buffer.byteLength(activeFile.content, 'utf-8') / CHARS_PER_TOKEN)
        : 0;
      return {
        mode: 'file',
        fileTree: '',
        activeFile,
        relatedFiles: [],
        meta,
        tokenEstimate,
      };
    }

    // Project mode — full workspace traversal
    const [ignorePatterns, meta] = await Promise.all([
      this.buildIgnorePatterns(workspaceRoot),
      this.buildProjectMeta(workspaceRoot),
    ]);

    const fileTree = this.buildFileTree(workspaceRoot, ignorePatterns);

    const activeFilePath = this.getActiveFilePath();
    const relatedFiles = activeFilePath
      ? await this.findRelatedFiles(activeFilePath, workspaceRoot, ignorePatterns, options.tokenBudget)
      : [];

    const tokenEstimate = this.estimateTokens(fileTree, activeFile, relatedFiles);

    return {
      mode: 'project',
      fileTree,
      activeFile,
      relatedFiles,
      meta,
      tokenEstimate,
    };
  }

  /** Build a lightweight summary for the webview (no file content). */
  buildSummary(ctx: ProjectContext): ProjectContextSummary {
    return {
      mode: ctx.mode,
      activeFilename: ctx.activeFile?.filename ?? null,
      relatedFilePaths: ctx.relatedFiles.map((f) => f.relativePath),
      totalFiles: ctx.meta.totalFiles,
      primaryLanguage: ctx.meta.primaryLanguage,
      framework: ctx.meta.framework,
      tokenEstimate: ctx.tokenEstimate,
    };
  }

  // ─── Private: File Tree ──────────────────────────────────────────────────────

  /**
   * Build a compact indented tree string.
   * Format (like `tree` command output):
   *   src/
   *     extension.ts
   *     types/
   *       index.ts
   */
  buildFileTree(root: string, ignorePatterns: string[]): string {
    const lines: string[] = [];
    this.walkTree(root, root, ignorePatterns, 0, lines);
    return lines.join('\n');
  }

  private walkTree(
    root: string,
    dir: string,
    ignorePatterns: string[],
    depth: number,
    lines: string[]
  ): void {
    if (depth > MAX_TREE_DEPTH) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // permission denied or similar
    }

    // Dirs first, then files — sorted alphabetically within each group
    const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));

    const indent = '  '.repeat(depth);

    for (const d of dirs) {
      if (this.isExcludedDir(d.name)) continue;
      const relPath = path.relative(root, path.join(dir, d.name));
      if (this.isIgnored(relPath, ignorePatterns)) continue;
      lines.push(`${indent}${d.name}/`);
      this.walkTree(root, path.join(dir, d.name), ignorePatterns, depth + 1, lines);
    }

    for (const f of files) {
      if (!this.isIncludableFile(f.name)) continue;
      const relPath = path.relative(root, path.join(dir, f.name));
      if (this.isIgnored(relPath, ignorePatterns)) continue;
      lines.push(`${indent}${f.name}`);
    }
  }

  // ─── Private: Related File Discovery ─────────────────────────────────────────

  /**
   * Find related files in order of priority:
   * 1. Config files (package.json, tsconfig.json, etc.)
   * 2. Directly imported files from the active file
   * 3. Files in the same directory as the active file
   *
   * Stops when the token budget is exhausted.
   */
  private async findRelatedFiles(
    activeFilePath: string,
    workspaceRoot: string,
    ignorePatterns: string[],
    tokenBudget: number
  ): Promise<ContextFile[]> {
    const seen = new Set<string>([activeFilePath]);
    const candidates: Array<{ absPath: string; reason: ContextFile['reason'] }> = [];

    // Priority 1: Config files in workspace root
    for (const name of CONFIG_BASENAMES) {
      const absPath = path.join(workspaceRoot, name);
      if (!seen.has(absPath) && fs.existsSync(absPath)) {
        candidates.push({ absPath, reason: 'config' });
        seen.add(absPath);
      }
    }

    // Priority 2: Import-resolved files from the active file
    try {
      const activeContent = fs.readFileSync(activeFilePath, 'utf-8');
      const importedPaths = this.parseImports(activeContent, activeFilePath, workspaceRoot);
      for (const absPath of importedPaths) {
        if (!seen.has(absPath) && fs.existsSync(absPath) && !this.isIgnored(path.relative(workspaceRoot, absPath), ignorePatterns)) {
          candidates.push({ absPath, reason: 'imported' });
          seen.add(absPath);
        }
      }
    } catch {
      // skip if active file can't be read
    }

    // Priority 3: Same-directory sibling files
    const activeDir = path.dirname(activeFilePath);
    try {
      const siblings = fs.readdirSync(activeDir, { withFileTypes: true });
      for (const s of siblings) {
        if (!s.isFile()) continue;
        const absPath = path.join(activeDir, s.name);
        if (!seen.has(absPath) && this.isIncludableFile(s.name) && !this.isIgnored(path.relative(workspaceRoot, absPath), ignorePatterns)) {
          candidates.push({ absPath, reason: 'same_dir' });
          seen.add(absPath);
        }
      }
    } catch {
      // skip
    }

    // Read files within budget
    const result: ContextFile[] = [];
    let budgetLeft = tokenBudget;

    for (const { absPath, reason } of candidates) {
      if (budgetLeft <= 0) break;
      const file = this.readContextFile(absPath, workspaceRoot, reason);
      if (!file) continue;
      const fileTokens = Math.ceil(file.content.length / CHARS_PER_TOKEN);
      if (fileTokens > budgetLeft) continue; // skip if too large for remaining budget
      result.push(file);
      budgetLeft -= fileTokens;
    }

    return result;
  }

  /**
   * Parse import/require statements and resolve to absolute paths.
   * Handles: ES imports, CommonJS require, TypeScript path aliases (basic).
   */
  private parseImports(content: string, fromFile: string, workspaceRoot: string): string[] {
    const importRegex = /(?:import|from|require)\s*(?:\(?\s*)?['"]([^'"]+)['"]/g;
    const fromDir = path.dirname(fromFile);
    const resolved: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) continue; // skip node_modules

      const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.vue', '.svelte'];

      // Try direct match, then with extensions
      const candidates: string[] = [
        path.resolve(fromDir, importPath),
        ...extensions.map((ext) => path.resolve(fromDir, importPath + ext)),
        ...extensions.map((ext) => path.resolve(fromDir, importPath, 'index' + ext)),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && this.isIncludableFile(path.basename(candidate))) {
          // Ensure it's within workspace root
          const rel = path.relative(workspaceRoot, candidate);
          if (!rel.startsWith('..')) {
            resolved.push(candidate);
            break;
          }
        }
      }
    }

    return resolved;
  }

  // ─── Private: Context File Reading ───────────────────────────────────────────

  private readContextFile(
    absPath: string,
    workspaceRoot: string,
    reason: ContextFile['reason']
  ): ContextFile | null {
    try {
      const stat = fs.statSync(absPath);
      if (stat.size > MAX_FILE_BYTES) {
        // Include only first N chars to stay within limit
        const fd = fs.openSync(absPath, 'r');
        const buf = Buffer.alloc(MAX_FILE_BYTES);
        const bytesRead = fs.readSync(fd, buf, 0, MAX_FILE_BYTES, 0);
        fs.closeSync(fd);
        const content = buf.slice(0, bytesRead).toString('utf-8');
        const ext = path.extname(absPath).toLowerCase();
        return {
          relativePath: path.relative(workspaceRoot, absPath),
          content: content + '\n... [truncated]',
          language_id: LANG_MAP[ext] ?? 'plaintext',
          line_count: content.split('\n').length,
          byte_size: stat.size,
          reason,
        };
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      const ext = path.extname(absPath).toLowerCase();
      return {
        relativePath: path.relative(workspaceRoot, absPath),
        content,
        language_id: LANG_MAP[ext] ?? 'plaintext',
        line_count: content.split('\n').length,
        byte_size: stat.size,
        reason,
      };
    } catch {
      return null;
    }
  }

  // ─── Private: Project Metadata ────────────────────────────────────────────────

  private async buildProjectMeta(workspaceRoot: string): Promise<ProjectMeta> {
    let name = path.basename(workspaceRoot);
    let framework: string | undefined;
    let primaryLanguage = 'plaintext';

    // Read package.json for name and framework detection
    const pkgPath = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        if (typeof pkg.name === 'string' && pkg.name) name = pkg.name;

        const deps = { ...pkg.dependencies as Record<string, unknown>, ...pkg.devDependencies as Record<string, unknown> };
        if ('react' in deps) framework = 'react';
        else if ('vue' in deps) framework = 'vue';
        else if ('@angular/core' in deps) framework = 'angular';
        else if ('svelte' in deps) framework = 'svelte';
        else if ('next' in deps) framework = 'next';
        else if ('nuxt' in deps) framework = 'nuxt';
        primaryLanguage = 'typescript' in deps || 'typescript' in (pkg.devDependencies as Record<string, unknown> ?? {}) ? 'typescript' : 'javascript';
      } catch {
        // ignore parse errors
      }
    } else if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml')) || fs.existsSync(path.join(workspaceRoot, 'setup.py'))) {
      primaryLanguage = 'python';
    } else if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
      primaryLanguage = 'rust';
    } else if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
      primaryLanguage = 'go';
    }

    // Count total files
    const totalFiles = this.countFiles(workspaceRoot, await this.buildIgnorePatterns(workspaceRoot));

    return { name, primaryLanguage, framework, totalFiles };
  }

  private buildMinimalMeta(workspaceRoot: string | undefined, activeFile: SourceInput | null): ProjectMeta {
    return {
      name: workspaceRoot ? path.basename(workspaceRoot) : 'untitled',
      primaryLanguage: activeFile?.language_id ?? 'plaintext',
      totalFiles: 0,
    };
  }

  // ─── Private: .gitignore Parsing ─────────────────────────────────────────────

  /** Read .gitignore and return glob patterns. */
  async buildIgnorePatterns(workspaceRoot: string): Promise<string[]> {
    const patterns: string[] = [];
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    if (!fs.existsSync(gitignorePath)) return patterns;

    try {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          patterns.push(trimmed);
        }
      }
    } catch {
      // ignore
    }

    return patterns;
  }

  /**
   * Simple gitignore-style matching.
   * Handles: exact path, wildcards (*), directory indicators (/).
   */
  private isIgnored(relPath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      const p = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
      // Exact match or starts-with match for directory patterns
      if (relPath === p || relPath.startsWith(p + '/')) return true;
      // Simple wildcard: *.ext
      if (p.startsWith('*') && relPath.endsWith(p.slice(1))) return true;
      // Name-only match (pattern without slashes matches any path segment)
      if (!p.includes('/') && path.basename(relPath) === p) return true;
    }
    return false;
  }

  // ─── Private: Filters ────────────────────────────────────────────────────────

  private isExcludedDir(name: string): boolean {
    return HARD_EXCLUDED_DIRS.has(name) || name.startsWith('.');
  }

  private isIncludableFile(name: string): boolean {
    if (SKIP_BASENAMES.has(name)) return false;
    const ext = path.extname(name).toLowerCase();
    return !BINARY_EXTENSIONS.has(ext);
  }

  private countFiles(root: string, ignorePatterns: string[]): number {
    let count = 0;
    const walk = (dir: string, depth: number) => {
      if (depth > MAX_TREE_DEPTH) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const e of entries) {
        const rel = path.relative(root, path.join(dir, e.name));
        if (e.isDirectory()) {
          if (!this.isExcludedDir(e.name) && !this.isIgnored(rel, ignorePatterns)) {
            walk(path.join(dir, e.name), depth + 1);
          }
        } else if (e.isFile() && this.isIncludableFile(e.name) && !this.isIgnored(rel, ignorePatterns)) {
          count++;
        }
      }
    };
    walk(root, 0);
    return count;
  }

  // ─── Private: Token Estimation ───────────────────────────────────────────────

  private estimateTokens(
    fileTree: string,
    activeFile: SourceInput | null,
    relatedFiles: ContextFile[]
  ): number {
    let total = Math.ceil(fileTree.length / CHARS_PER_TOKEN);
    if (activeFile) total += Math.ceil(activeFile.content.length / CHARS_PER_TOKEN);
    for (const f of relatedFiles) total += Math.ceil(f.content.length / CHARS_PER_TOKEN);
    return total;
  }

  // ─── Private: Active File Path ───────────────────────────────────────────────

  private getActiveFilePath(): string | null {
    let vscode: typeof import('vscode');
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      vscode = require('vscode');
    } catch {
      return null;
    }
    return vscode.window.activeTextEditor?.document.fileName ?? null;
  }
}
