import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder, TextDecoder } from 'util';
import { WorkflowTemplate, WorkflowConfig } from '../types/index.js';

const SCHEMA_VERSION = '1.0';
const TEMPLATE_EXT = '.aao-template.json';

export interface SaveTemplateOptions {
  name: string;
  description: string;
  tags: string[];
  config: WorkflowConfig;
}

/**
 * Template Manager — Saves and loads workflow templates as local JSON files.
 * Workspace templates: .vscode/aao-templates/
 * Global templates: ~/.aao-templates/
 */
export class TemplateManager {
  constructor(private readonly context: vscode.ExtensionContext) { }

  private getTemplateDir(scope: 'workspace' | 'global'): vscode.Uri | undefined {
    if (scope === 'global') {
      return vscode.Uri.joinPath(this.context.globalStorageUri, 'templates');
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) return undefined;
    return vscode.Uri.joinPath(workspaceRoot, '.vscode', 'aao-templates');
  }

  async save(options: SaveTemplateOptions & { scope?: 'workspace' | 'global' }): Promise<WorkflowTemplate> {
    const scope = options.scope ?? 'workspace';
    const templateDir = this.getTemplateDir(scope);
    if (!templateDir) throw new Error('Cannot determine template directory (no workspace open?)');

    try {
      await vscode.workspace.fs.createDirectory(templateDir);
    } catch {
      // Ignore if it already exists
    }

    const now = new Date().toISOString();
    const template: WorkflowTemplate = {
      schema_version: SCHEMA_VERSION,
      template_id: uuidv4(),
      name: options.name,
      description: options.description,
      tags: options.tags,
      created_at: now,
      updated_at: now,
      config: options.config,
    };

    const sanitizedName = options.name.replace(/[^a-zA-Z0-9_\-\u3040-\u30ff\u4e00-\u9fff]/g, '_');
    const filename = `${sanitizedName}_${template.template_id.slice(0, 8)}${TEMPLATE_EXT}`;
    const fileUri = vscode.Uri.joinPath(templateDir, filename);

    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(template, null, 2), 'utf-8'));
    return template;
  }

  async list(): Promise<WorkflowTemplate[]> {
    const templates: WorkflowTemplate[] = [];
    const scopes: Array<'workspace' | 'global'> = ['workspace', 'global'];

    for (const scope of scopes) {
      const templateDir = this.getTemplateDir(scope);
      if (!templateDir) continue;
      try {
        const files = await vscode.workspace.fs.readDirectory(templateDir);
        for (const [file, type] of files) {
          if (type !== vscode.FileType.File || !file.endsWith(TEMPLATE_EXT)) continue;
          try {
            const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(templateDir, file));
            const content = new TextDecoder('utf-8').decode(raw);
            const template = JSON.parse(content) as WorkflowTemplate;
            templates.push(template);
          } catch {
            // Skip malformed files
          }
        }
      } catch {
        // Directory doesn't exist yet — that's fine
      }
    }

    // Sort by updated_at descending
    return templates.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  async load(fileUri: vscode.Uri): Promise<WorkflowTemplate> {
    const raw = await vscode.workspace.fs.readFile(fileUri);
    const content = new TextDecoder('utf-8').decode(raw);
    const template = JSON.parse(content) as WorkflowTemplate;
    if (!template.schema_version || !template.config) {
      throw new Error('Invalid template file: missing schema_version or config.');
    }
    return template;
  }

  async delete(fileUri: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.delete(fileUri);
  }

  /**
   * Import a template from a JSON string and save it to the workspace template directory.
   */
  async importFromJson(json: string): Promise<WorkflowTemplate> {
    const raw = JSON.parse(json) as Partial<WorkflowTemplate>;
    if (!raw.config || !raw.schema_version) {
      throw new Error('Invalid template JSON: missing schema_version or config.');
    }
    // Assign a new template_id and timestamps on import to avoid conflicts
    const now = new Date().toISOString();
    const template: WorkflowTemplate = {
      schema_version: SCHEMA_VERSION,
      template_id: uuidv4(),
      name: raw.name ?? 'Imported Template',
      description: raw.description ?? '',
      tags: raw.tags ?? [],
      created_at: now,
      updated_at: now,
      config: raw.config,
    };

    const templateDir = this.getTemplateDir('workspace');
    if (!templateDir) throw new Error('Cannot import template without an open workspace.');

    try {
      await vscode.workspace.fs.createDirectory(templateDir);
    } catch {
      // Ignore
    }

    const sanitizedName = template.name.replace(/[^a-zA-Z0-9_\-\u3040-\u30ff\u4e00-\u9fff]/g, '_');
    const filename = `${sanitizedName}_${template.template_id.slice(0, 8)}${TEMPLATE_EXT}`;
    const fileUri = vscode.Uri.joinPath(templateDir, filename);

    const contentBytes = new TextEncoder().encode(JSON.stringify(template, null, 2));
    await vscode.workspace.fs.writeFile(fileUri, contentBytes);
    return template;
  }
}
