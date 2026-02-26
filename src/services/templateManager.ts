import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowTemplate, WorkflowConfig } from '../types/index.js';

const SCHEMA_VERSION = '1.0';
const TEMPLATE_EXT = '.aao-template.json';

export interface SaveTemplateOptions {
  name: string;
  description: string;
  tags: string[];
  config: WorkflowConfig;
  /** Workspace directory or global home directory */
  baseDir: string;
}

/**
 * Template Manager — Saves and loads workflow templates as local JSON files.
 * Workspace templates: .vscode/aao-templates/
 * Global templates: ~/.aao-templates/
 */
export class TemplateManager {
  private getTemplateDir(baseDir: string, scope: 'workspace' | 'global'): string {
    if (scope === 'global') {
      return path.join(baseDir, '.aao-templates');
    }
    return path.join(baseDir, '.vscode', 'aao-templates');
  }

  async save(options: SaveTemplateOptions & { scope?: 'workspace' | 'global' }): Promise<WorkflowTemplate> {
    const scope = options.scope ?? 'workspace';
    const templateDir = this.getTemplateDir(options.baseDir, scope);
    await fs.mkdir(templateDir, { recursive: true });

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
    const filePath = path.join(templateDir, filename);

    await fs.writeFile(filePath, JSON.stringify(template, null, 2), 'utf-8');
    return template;
  }

  async list(baseDirs: { workspace?: string; global?: string }): Promise<WorkflowTemplate[]> {
    const templates: WorkflowTemplate[] = [];

    for (const [scope, baseDir] of Object.entries(baseDirs) as Array<['workspace' | 'global', string | undefined]>) {
      if (!baseDir) continue;
      const templateDir = this.getTemplateDir(baseDir, scope);
      try {
        const files = await fs.readdir(templateDir);
        for (const file of files) {
          if (!file.endsWith(TEMPLATE_EXT)) continue;
          try {
            const content = await fs.readFile(path.join(templateDir, file), 'utf-8');
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

  async load(filePath: string): Promise<WorkflowTemplate> {
    const content = await fs.readFile(filePath, 'utf-8');
    const template = JSON.parse(content) as WorkflowTemplate;
    if (!template.schema_version || !template.config) {
      throw new Error('Invalid template file: missing schema_version or config.');
    }
    return template;
  }

  async delete(filePath: string): Promise<void> {
    await fs.unlink(filePath);
  }
}
