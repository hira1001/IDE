import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { DryRunner } from './orchestrator/dryRunner.js';
import { validateWorkflow } from './orchestrator/validator.js';
import { MetaAIService } from './services/metaAIService.js';
import { TemplateManager } from './services/templateManager.js';
import { FileContextProvider } from './services/fileContextProvider.js';
import { ApiKeys } from './llm/gateway.js';
import {
  WorkflowConfig,
  WebviewMessage,
  GenerateWorkflowPayload,
  ExecuteWorkflowPayload,
  RetryTaskPayload,
  ManualEditPayload,
  SaveTemplatePayload,
  SerializedExecutionState,
  OutputFormat,
} from './types/index.js';

const EXTENSION_ID = 'ai-agent-orchestrator';
let currentPanel: vscode.WebviewPanel | undefined;
let currentOrchestrator: Orchestrator | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const fileContextProvider = new FileContextProvider();
  const templateManager = new TemplateManager();

  // ─── Commands ────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('aiAgentOrchestrator.openPanel', () => {
      openOrFocusPanel(context, fileContextProvider, templateManager);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiAgentOrchestrator.createFromTemplate', async () => {
      openOrFocusPanel(context, fileContextProvider, templateManager);
      // Panel will handle template selection in the UI
      currentPanel?.webview.postMessage({
        type: 'template:open_selector',
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiAgentOrchestrator.configureApiKeys', async () => {
      await configureApiKeys(context);
    })
  );

  // ─── Status Bar ──────────────────────────────────────────────────────────

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(robot) AI Agent';
  statusBarItem.command = 'aiAgentOrchestrator.openPanel';
  statusBarItem.tooltip = 'Open AI Agent Orchestrator';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {
  currentOrchestrator?.abort();
  currentPanel?.dispose();
}

// ─── Panel Management ─────────────────────────────────────────────────────────

function openOrFocusPanel(
  context: vscode.ExtensionContext,
  fileContextProvider: FileContextProvider,
  templateManager: TemplateManager
): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Two);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    EXTENSION_ID,
    'AI Agent Orchestrator',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist'),
        vscode.Uri.joinPath(context.extensionUri, 'media'),
      ],
    }
  );

  currentPanel.webview.html = getWebviewHtml(context, currentPanel.webview);

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    currentOrchestrator?.abort();
    currentOrchestrator = undefined;
  });

  // Handle messages from Webview
  currentPanel.webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      await handleWebviewMessage(message, context, fileContextProvider, templateManager);
    },
    undefined,
    context.subscriptions
  );
}

// ─── Message Handler ─────────────────────────────────────────────────────────

async function handleWebviewMessage(
  message: WebviewMessage,
  context: vscode.ExtensionContext,
  fileContextProvider: FileContextProvider,
  templateManager: TemplateManager
): Promise<void> {
  switch (message.type) {
    case 'source:get': {
      const source = fileContextProvider.getActiveFileSnapshot();
      postMessage({ type: 'source:get', payload: { source } });
      break;
    }

    case 'workflow:generate': {
      const payload = message.payload as GenerateWorkflowPayload;
      await handleGenerateWorkflow(payload, context, fileContextProvider);
      break;
    }

    case 'workflow:execute': {
      const payload = message.payload as ExecuteWorkflowPayload;
      await handleExecuteWorkflow(payload, context, fileContextProvider);
      break;
    }

    case 'workflow:abort': {
      currentOrchestrator?.abort();
      break;
    }

    case 'workflow:retry': {
      const payload = message.payload as RetryTaskPayload & { config: WorkflowConfig };
      if (currentOrchestrator && payload.config) {
        await currentOrchestrator.retryTask(payload.task_id, payload.config);
      }
      break;
    }

    case 'workflow:pause_resume': {
      currentOrchestrator?.resumeFromPause();
      break;
    }

    case 'workflow:dryrun': {
      const payload = message.payload as ExecuteWorkflowPayload;
      const source = fileContextProvider.getActiveFileSnapshot();
      if (source) {
        const dryRunner = new DryRunner();
        const result = dryRunner.run(payload.config, source);
        postMessage({ type: 'workflow:dryrun', payload: { result } });
      }
      break;
    }

    case 'workflow:manual_edit': {
      const payload = message.payload as ManualEditPayload & { step: number };
      if (currentOrchestrator) {
        currentOrchestrator.manualEditOutput(payload.output_key, payload.content, payload.step ?? 0);
      }
      break;
    }

    case 'template:save': {
      const payload = message.payload as SaveTemplatePayload;
      const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
      const baseDir = payload.location === 'global' ? homeDir : (workspaceDir ?? homeDir);
      const template = await templateManager.save({
        ...payload,
        baseDir,
        scope: payload.location,
      });
      postMessage({ type: 'template:save', payload: { template } });
      vscode.window.showInformationMessage(`Template "${template.name}" saved.`);
      break;
    }

    case 'template:list': {
      const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
      const templates = await templateManager.list({
        workspace: workspaceDir,
        global: homeDir,
      });
      postMessage({ type: 'template:list', payload: { templates } });
      break;
    }

    case 'output:open_tab': {
      const payload = message.payload as { content: string; format: OutputFormat; filename: string };
      await openOutputTab(payload.content, payload.format, payload.filename);
      break;
    }

    default:
      console.warn('[Extension] Unknown message type:', message.type);
  }
}

// ─── Workflow Actions ─────────────────────────────────────────────────────────

async function handleGenerateWorkflow(
  payload: GenerateWorkflowPayload,
  context: vscode.ExtensionContext,
  fileContextProvider: FileContextProvider
): Promise<void> {
  const apiKeys = await getApiKeys(context);
  const source = fileContextProvider.getActiveFileSnapshot();

  postMessage({ type: 'workflow:generate', payload: { status: 'generating' } });

  try {
    const config = vscode.workspace.getConfiguration('aiAgentOrchestrator');
    const defaultModel = config.get<string>('defaultModel', 'gpt-4o') as import('./types/index.js').LLMModel;
    const metaAI = new MetaAIService(apiKeys, defaultModel);
    const workflowConfig = await metaAI.generateWorkflow(payload.instruction, source);

    postMessage({ type: 'workflow:generate', payload: { status: 'done', config: workflowConfig } });
  } catch (err) {
    const msg = (err as Error).message;
    vscode.window.showErrorMessage(`AI Agent: Failed to generate workflow — ${msg}`);
    postMessage({ type: 'workflow:generate', payload: { status: 'error', error: msg } });
  }
}

async function handleExecuteWorkflow(
  payload: ExecuteWorkflowPayload,
  context: vscode.ExtensionContext,
  fileContextProvider: FileContextProvider
): Promise<void> {
  const apiKeys = await getApiKeys(context);
  const source = fileContextProvider.getActiveFileSnapshot();

  if (!source) {
    vscode.window.showWarningMessage('AI Agent: Please open a file in the editor before running.');
    postMessage({ type: 'workflow:execute', payload: { status: 'error', error: 'No active editor.' } });
    return;
  }

  // Validate before execution
  const errors = validateWorkflow(payload.config, source, apiKeys);
  const hasErrors = errors.some((e) => e.type === 'error');

  if (hasErrors) {
    postMessage({ type: 'workflow:execute', payload: { status: 'validation_error', errors } });
    vscode.window.showErrorMessage('AI Agent: Workflow validation failed. Check the panel for details.');
    return;
  }

  // Warn about warnings
  const warnings = errors.filter((e) => e.type === 'warning');
  if (warnings.length > 0) {
    const proceed = await vscode.window.showWarningMessage(
      `AI Agent: ${warnings[0].message}`,
      'Proceed',
      'Cancel'
    );
    if (proceed !== 'Proceed') return;
  }

  // Create orchestrator
  currentOrchestrator = new Orchestrator({
    apiKeys,
    onStatusUpdate: (state: SerializedExecutionState) => {
      postMessage({ type: 'status:update', payload: { execution_state: state } });

      // Show VS Code notification on error (dual notification per design)
      if (state.status === 'error') {
        vscode.window.showErrorMessage('AI Agent: An error occurred during workflow execution.', 'Show Panel')
          .then((selection) => {
            if (selection === 'Show Panel') {
              currentPanel?.reveal();
            }
          });
      }

      // Auto-open tabs for completed outputs
      if (state.status === 'completed') {
        for (const [key, content] of Object.entries(state.output_store)) {
          const taskInConfig = payload.config.workflow
            .flatMap((s) => s.tasks)
            .find((t) => t.output_key === key);
          if (taskInConfig) {
            openOutputTab(content, taskInConfig.output_format, `${key}.output`).catch(console.error);
          }
        }
      }
    },
    onPause: async (stepIndex, outputs) => {
      postMessage({ type: 'workflow:pause_resume', payload: { paused: true, stepIndex, outputs } });
    },
  });

  postMessage({ type: 'workflow:execute', payload: { status: 'started' } });
  await currentOrchestrator.execute(payload.config, source);
}

// ─── API Key Management ───────────────────────────────────────────────────────

async function getApiKeys(context: vscode.ExtensionContext): Promise<ApiKeys> {
  const openai = await context.secrets.get('aiAgentOrchestrator.openaiKey');
  const anthropic = await context.secrets.get('aiAgentOrchestrator.anthropicKey');
  const google = await context.secrets.get('aiAgentOrchestrator.googleKey');
  return {
    openai: openai ?? undefined,
    anthropic: anthropic ?? undefined,
    google: google ?? undefined,
  };
}

async function configureApiKeys(context: vscode.ExtensionContext): Promise<void> {
  const providers = [
    { name: 'OpenAI', secretKey: 'aiAgentOrchestrator.openaiKey', placeholder: 'sk-...' },
    { name: 'Anthropic', secretKey: 'aiAgentOrchestrator.anthropicKey', placeholder: 'sk-ant-...' },
    { name: 'Google AI', secretKey: 'aiAgentOrchestrator.googleKey', placeholder: 'AIza...' },
  ];

  for (const provider of providers) {
    const current = await context.secrets.get(provider.secretKey);
    const input = await vscode.window.showInputBox({
      title: `Configure ${provider.name} API Key`,
      prompt: `Enter your ${provider.name} API key (leave empty to skip)`,
      placeHolder: provider.placeholder,
      value: current ? '••••••••' : '',
      password: true,
    });

    if (input !== undefined && input !== '' && input !== '••••••••') {
      await context.secrets.store(provider.secretKey, input);
      vscode.window.showInformationMessage(`${provider.name} API key saved.`);
    }
  }
}

// ─── Output Tab ───────────────────────────────────────────────────────────────

async function openOutputTab(content: string, format: OutputFormat, filename: string): Promise<void> {
  const langMap: Record<OutputFormat, string> = {
    Markdown: 'markdown',
    Mermaid: 'markdown',
    JSON: 'json',
    Code: 'typescript',
    PlainText: 'plaintext',
  };

  const uri = vscode.Uri.parse(`untitled:${filename}.${getExtension(format)}`);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

  await editor.edit((editBuilder) => {
    editBuilder.insert(new vscode.Position(0, 0), content);
  });

  await vscode.languages.setTextDocumentLanguage(doc, langMap[format] ?? 'plaintext');
}

function getExtension(format: OutputFormat): string {
  switch (format) {
    case 'Markdown': return 'md';
    case 'Mermaid': return 'mmd';
    case 'JSON': return 'json';
    case 'Code': return 'ts';
    default: return 'txt';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function postMessage(message: WebviewMessage): void {
  currentPanel?.webview.postMessage(message);
}

function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js')
  );

  const nonce = generateNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'nonce-${nonce}' ${webview.cspSource};
    style-src ${webview.cspSource} 'unsafe-inline';
    font-src ${webview.cspSource};
    img-src ${webview.cspSource} data:;
  " />
  <title>AI Agent Orchestrator</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function generateNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
