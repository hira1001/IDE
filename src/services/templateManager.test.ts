import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TemplateManager } from './templateManager.js';
import { WorkflowConfig } from '../types/index.js';

const MINIMAL_CONFIG: WorkflowConfig = {
  agents: [{ id: 'agent_1', name: 'Reviewer', persona: 'Reviews code', model: 'gpt-4o' }],
  workflow: [
    {
      step: 1,
      type: 'parallel',
      pause_after: false,
      tasks: [
        {
          task_id: 'task_1',
          agent_id: 'agent_1',
          task_name: 'Review',
          instructions: ['Check quality'],
          constraints: [],
          output_format: 'Markdown',
          output_key: 'review',
          input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source' }],
          enable_handover_note: false,
        },
      ],
    },
  ],
};

// Mock vscode
vi.mock('vscode', () => {
  return {
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    Uri: {
      file: (p: string) => ({ fsPath: p, path: p, scheme: 'file', with: vi.fn(), toString: () => p }),
      joinPath: (base: any, ...paths: string[]) => {
        return { fsPath: path.join(base.fsPath ?? base, ...paths), path: path.join(base.path ?? base, ...paths), scheme: 'file' };
      }
    },
    workspace: {
      workspaceFolders: undefined as any,
      fs: {
        createDirectory: vi.fn(),
        writeFile: vi.fn(),
        readFile: vi.fn(),
        readDirectory: vi.fn(),
        delete: vi.fn(),
        stat: vi.fn(),
      }
    },
  };
});

describe('TemplateManager', () => {
  let manager: TemplateManager;
  let tmpDir: string;
  let mockContext: vscode.ExtensionContext;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aao-test-'));

    // Setup vscode mocks
    const globalStorageUri = vscode.Uri.file(path.join(tmpDir, 'global-storage'));
    mockContext = {
      globalStorageUri,
    } as unknown as vscode.ExtensionContext;

    // Setup workspace root mock
    const workspaceRoot = vscode.Uri.file(path.join(tmpDir, 'workspace'));
    (vscode.workspace as any).workspaceFolders = [{ uri: workspaceRoot }];

    // Wire up fs mocks to real fs for these tests with a fake vs code fs API
    (vscode.workspace.fs.createDirectory as any).mockImplementation(async (uri: any) => {
      await fs.mkdir(uri.fsPath, { recursive: true });
    });
    (vscode.workspace.fs.writeFile as any).mockImplementation(async (uri: any, content: Uint8Array) => {
      await fs.writeFile(uri.fsPath, content);
    });
    (vscode.workspace.fs.readFile as any).mockImplementation(async (uri: any) => {
      return await fs.readFile(uri.fsPath);
    });
    (vscode.workspace.fs.readDirectory as any).mockImplementation(async (uri: any) => {
      const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
      return entries.map(e => [e.name, e.isDirectory() ? 2 : 1]); // FileType.Directory = 2, File = 1
    });
    (vscode.workspace.fs.delete as any).mockImplementation(async (uri: any) => {
      await fs.stat(uri.fsPath); // Throw if doesn't exist
      await fs.rm(uri.fsPath, { recursive: true });
    });

    manager = new TemplateManager(mockContext);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // ─── save() ───────────────────────────────────────────────────────────────

  describe('save()', () => {
    it('returns a WorkflowTemplate with correct fields', async () => {
      const template = await manager.save({
        name: 'My Template',
        description: 'A test template',
        tags: ['test', 'review'],
        config: MINIMAL_CONFIG,
      });

      expect(template.schema_version).toBe('1.0');
      expect(template.name).toBe('My Template');
      expect(template.description).toBe('A test template');
      expect(template.tags).toEqual(['test', 'review']);
      expect(template.config).toEqual(MINIMAL_CONFIG);
    });

    it('generates a unique template_id (UUID)', async () => {
      const t1 = await manager.save({ name: 'T1', description: '', tags: [], config: MINIMAL_CONFIG });
      const t2 = await manager.save({ name: 'T2', description: '', tags: [], config: MINIMAL_CONFIG });

      expect(t1.template_id).toBeTruthy();
      expect(t2.template_id).toBeTruthy();
      expect(t1.template_id).not.toBe(t2.template_id);
    });

    it('sets created_at and updated_at to the same ISO timestamp', async () => {
      const before = Date.now();
      const template = await manager.save({ name: 'T', description: '', tags: [], config: MINIMAL_CONFIG });
      const after = Date.now();

      expect(template.created_at).toBe(template.updated_at);
      const ts = new Date(template.created_at).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('writes file to workspace scope dir (.vscode/aao-templates/)', async () => {
      const template = await manager.save({
        name: 'WS', description: '', tags: [], config: MINIMAL_CONFIG,
        scope: 'workspace',
      });

      const expectedDir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      const files = await fs.readdir(expectedDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain(template.template_id.slice(0, 8));
    });

    it('writes file to global scope dir (.aao-templates/)', async () => {
      const template = await manager.save({
        name: 'GL', description: '', tags: [], config: MINIMAL_CONFIG,
        scope: 'global',
      });

      const expectedDir = path.join(tmpDir, 'global-storage', 'templates');
      const files = await fs.readdir(expectedDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain(template.template_id.slice(0, 8));
    });

    it('defaults to workspace scope when scope is omitted', async () => {
      await manager.save({ name: 'Default', description: '', tags: [], config: MINIMAL_CONFIG });

      const expectedDir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      const files = await fs.readdir(expectedDir);
      expect(files).toHaveLength(1);
    });

    it('sanitizes special characters in the filename', async () => {
      await manager.save({
        name: 'My/Special:Name!',
        description: '', tags: [], config: MINIMAL_CONFIG,
      });

      const dir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      const files = await fs.readdir(dir);
      expect(files[0]).not.toMatch(/[/:|!]/);
    });

    it('creates the template directory if it does not exist', async () => {
      await expect(
        manager.save({ name: 'T', description: '', tags: [], config: MINIMAL_CONFIG })
      ).resolves.not.toThrow();

      const dir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('persists content that can be parsed back as valid JSON', async () => {
      const template = await manager.save({
        name: 'Roundtrip', description: 'Test', tags: ['x'], config: MINIMAL_CONFIG,
      });

      const dir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      const files = await fs.readdir(dir);
      const raw = await fs.readFile(path.join(dir, files[0]), 'utf-8');
      const parsed = JSON.parse(raw);

      expect(parsed.template_id).toBe(template.template_id);
      expect(parsed.config).toEqual(MINIMAL_CONFIG);
    });
  });

  // ─── list() ───────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns empty array when template directory does not exist', async () => {
      const result = await manager.list();
      expect(result).toEqual([]);
    });

    it('lists templates saved in workspace scope', async () => {
      await manager.save({ name: 'T1', description: '', tags: [], config: MINIMAL_CONFIG });
      await manager.save({ name: 'T2', description: '', tags: [], config: MINIMAL_CONFIG });

      const result = await manager.list();
      expect(result).toHaveLength(2);
    });

    it('lists templates from both workspace and global scopes', async () => {
      await manager.save({ name: 'WS', description: '', tags: [], config: MINIMAL_CONFIG, scope: 'workspace' });
      await manager.save({ name: 'GL', description: '', tags: [], config: MINIMAL_CONFIG, scope: 'global' });

      const result = await manager.list();
      expect(result).toHaveLength(2);
      const names = result.map((t) => t.name);
      expect(names).toContain('WS');
      expect(names).toContain('GL');
    });

    it('sorts results by updated_at descending', async () => {
      // Save two templates with a small delay to ensure different timestamps
      const t1 = await manager.save({ name: 'First', description: '', tags: [], config: MINIMAL_CONFIG });
      // Manually write a template with a later date to simulate ordering
      const templateDir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      const laterTemplate = {
        ...t1,
        template_id: 'aaaabbbb',
        name: 'Later',
        updated_at: new Date(new Date(t1.updated_at).getTime() + 5000).toISOString(),
      };
      await fs.mkdir(templateDir, { recursive: true });
      await fs.writeFile(
        path.join(templateDir, `Later_aaaabbbb.aao-template.json`),
        JSON.stringify(laterTemplate, null, 2),
        'utf-8'
      );

      const result = await manager.list();
      expect(result[0].name).toBe('Later');
      expect(result[1].name).toBe('First');
    });

    it('skips files that do not end with .aao-template.json', async () => {
      const templateDir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      await fs.mkdir(templateDir, { recursive: true });
      await fs.writeFile(path.join(templateDir, 'random.json'), '{}', 'utf-8');
      await fs.writeFile(path.join(templateDir, 'notes.txt'), 'hello', 'utf-8');

      const result = await manager.list();
      expect(result).toHaveLength(0);
    });

    it('skips malformed JSON files without throwing', async () => {
      const templateDir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      await fs.mkdir(templateDir, { recursive: true });
      await fs.writeFile(path.join(templateDir, 'bad.aao-template.json'), 'NOT JSON', 'utf-8');

      await expect(manager.list()).resolves.toEqual([]);
    });
  });

  // ─── load() ───────────────────────────────────────────────────────────────

  describe('load()', () => {
    it('reads and returns a valid template file', async () => {
      const saved = await manager.save({ name: 'Load Me', description: 'desc', tags: ['a'], config: MINIMAL_CONFIG });
      const templateDir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      const files = await fs.readdir(templateDir);
      const filePath = path.join(templateDir, files[0]);

      const loaded = await manager.load(vscode.Uri.file(filePath));
      expect(loaded.template_id).toBe(saved.template_id);
      expect(loaded.name).toBe('Load Me');
      expect(loaded.config).toEqual(MINIMAL_CONFIG);
    });

    it('throws when schema_version is missing', async () => {
      const templateDir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      await fs.mkdir(templateDir, { recursive: true });
      const filePath = path.join(templateDir, 'bad.aao-template.json');
      await fs.writeFile(filePath, JSON.stringify({ config: MINIMAL_CONFIG }), 'utf-8');

      await expect(manager.load(vscode.Uri.file(filePath))).rejects.toThrow('Invalid template file');
    });

    it('throws when config is missing', async () => {
      const templateDir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      await fs.mkdir(templateDir, { recursive: true });
      const filePath = path.join(templateDir, 'bad.aao-template.json');
      await fs.writeFile(filePath, JSON.stringify({ schema_version: '1.0' }), 'utf-8');

      await expect(manager.load(vscode.Uri.file(filePath))).rejects.toThrow('Invalid template file');
    });

    it('throws when file does not exist', async () => {
      await expect(manager.load(vscode.Uri.file('/nonexistent/path/file.json'))).rejects.toThrow();
    });
  });

  // ─── importFromJson() ─────────────────────────────────────────────────────

  describe('importFromJson()', () => {
    const validJson = JSON.stringify({
      schema_version: '1.0',
      name: 'Test Template',
      description: '',
      tags: [],
      config: MINIMAL_CONFIG,
    });

    it('imports a valid template and assigns a new template_id', async () => {
      const result = await manager.importFromJson(validJson);
      expect(result.name).toBe('Test Template');
      expect(result.template_id).toBeTruthy();
      expect(Array.isArray(result.config.agents)).toBe(true);
    });

    it('throws when schema_version is missing', async () => {
      const bad = JSON.stringify({ config: MINIMAL_CONFIG });
      await expect(manager.importFromJson(bad)).rejects.toThrow(/missing schema_version or config/);
    });

    it('throws when config is missing', async () => {
      const bad = JSON.stringify({ schema_version: '1.0' });
      await expect(manager.importFromJson(bad)).rejects.toThrow(/missing schema_version or config/);
    });

    it('throws when config.agents is empty', async () => {
      const bad = JSON.stringify({
        schema_version: '1.0',
        config: { agents: [], workflow: [{ step: 1, type: 'parallel', pause_after: false, tasks: [] }] },
      });
      await expect(manager.importFromJson(bad)).rejects.toThrow(/agents must be a non-empty array/);
    });

    it('throws when config.workflow is empty', async () => {
      const bad = JSON.stringify({
        schema_version: '1.0',
        config: { agents: MINIMAL_CONFIG.agents, workflow: [] },
      });
      await expect(manager.importFromJson(bad)).rejects.toThrow(/workflow must be a non-empty array/);
    });

    it('throws when an agent is missing required fields', async () => {
      const bad = JSON.stringify({
        schema_version: '1.0',
        config: {
          agents: [{ id: 'a1', name: 'Agent' }], // missing model
          workflow: MINIMAL_CONFIG.workflow,
        },
      });
      await expect(manager.importFromJson(bad)).rejects.toThrow(/id, name, and model/);
    });

    it('throws when a workflow step is missing required fields', async () => {
      const bad = JSON.stringify({
        schema_version: '1.0',
        config: {
          agents: MINIMAL_CONFIG.agents,
          workflow: [{ step: 1 }], // missing type and tasks
        },
      });
      await expect(manager.importFromJson(bad)).rejects.toThrow(/step, type, and tasks/);
    });
  });

  // ─── delete() ─────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('removes the template file', async () => {
      await manager.save({ name: 'ToDelete', description: '', tags: [], config: MINIMAL_CONFIG });
      const templateDir = path.join(tmpDir, 'workspace', '.vscode', 'aao-templates');
      const files = await fs.readdir(templateDir);
      const filePath = path.join(templateDir, files[0]);

      await manager.delete(vscode.Uri.file(filePath));

      const remaining = await fs.readdir(templateDir);
      expect(remaining).toHaveLength(0);
    });

    it('throws when the file does not exist', async () => {
      await expect(manager.delete(vscode.Uri.file('/nonexistent/file.json'))).rejects.toThrow();
    });
  });
});
