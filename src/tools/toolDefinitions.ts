import { ToolDefinition } from '../types/index.js';

/**
 * All built-in tools available to agentic tasks.
 * Formatted as JSON Schema for LLM function-calling APIs.
 */
export const ALL_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read the full content of a file using a workspace-relative path. ' +
      'Returns the file content as a string.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the file (e.g. "src/index.ts").',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write (or overwrite) a file with the given content. ' +
      'The change is staged and applied via VS Code WorkspaceEdit (supports Undo). ' +
      'Creates parent directories automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the file.',
        },
        content: {
          type: 'string',
          description: 'Full new content of the file.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace a specific string within a file with new text. ' +
      'old_str must appear exactly once in the file. ' +
      'The change is staged via VS Code WorkspaceEdit (supports Undo).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the file.',
        },
        old_str: {
          type: 'string',
          description: 'Exact string to find and replace (must be unique in the file).',
        },
        new_str: {
          type: 'string',
          description: 'Replacement string.',
        },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'list_files',
    description:
      'List files matching a glob pattern relative to the workspace root. ' +
      'Returns a newline-separated list of matching paths.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g. "src/**/*.ts", "**/*.json").',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'search_code',
    description:
      'Search for a regex pattern across files in the workspace. ' +
      'Returns matching lines with file path and line number.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression to search for.',
        },
        path: {
          type: 'string',
          description:
            'Workspace-relative path or glob to restrict the search scope (optional). ' +
            'Examples: "src/", "**/*.ts".',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'get_diagnostics',
    description:
      'Get TypeScript/linter diagnostics (errors and warnings) from VS Code. ' +
      'Returns a JSON list of diagnostics including severity, message, file, and line number.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative path to restrict diagnostics to a specific file (optional). ' +
            'Omit to get all workspace diagnostics.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_definition',
    description:
      'Get the definition location of a symbol at a specific position in a file. ' +
      'Returns file path and line number of the definition.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the file.',
        },
        line: {
          type: 'number',
          description: 'Line number (0-based).',
        },
        character: {
          type: 'number',
          description: 'Character offset within the line (0-based).',
        },
      },
      required: ['path', 'line', 'character'],
    },
  },
  {
    name: 'find_references',
    description:
      'Find all references to a symbol at a specific position in a file. ' +
      'Returns a list of file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the file.',
        },
        line: {
          type: 'number',
          description: 'Line number (0-based).',
        },
        character: {
          type: 'number',
          description: 'Character offset within the line (0-based).',
        },
      },
      required: ['path', 'line', 'character'],
    },
  },
  {
    name: 'run_terminal',
    description:
      'Run a shell command in the workspace root directory. ' +
      'Returns stdout and stderr combined. ' +
      'Use for running tests, builds, or other development commands. ' +
      'In confirm mode the user must approve the command before it runs.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute (e.g. "npm test", "git status").',
        },
      },
      required: ['command'],
    },
  },
];

/** Look up a tool definition by name. */
export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

/**
 * Return the subset of ALL_TOOLS allowed for a task.
 * @param allowed - undefined means all tools are allowed.
 */
export function getAllowedTools(allowed?: string[]): ToolDefinition[] {
  if (!allowed) return ALL_TOOLS;
  return ALL_TOOLS.filter((t) => allowed.includes(t.name));
}
