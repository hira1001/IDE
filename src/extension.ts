import * as vscode from 'vscode';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { DryRunner } from './orchestrator/dryRunner.js';
import { validateWorkflow } from './orchestrator/validator.js';
import { MetaAIService } from './services/metaAIService.js';
import { TemplateManager } from './services/templateManager.js';
import { FileContextProvider } from './services/fileContextProvider.js';
import { ProjectContextProvider } from './services/projectContextProvider.js';
import { ApiKeys } from './llm/gateway.js';
import { TextEncoder, TextDecoder } from 'util';
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
  ProjectContextOptions,
  ApplyOutputPayload,
} from './types/index.js';

const EXTENSION_ID = 'ai-agent-orchestrator';
let currentPanel: vscode.WebviewPanel | undefined;
let currentOrchestrator: Orchestrator | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const fileContextProvider = new FileContextProvider();
  const projectContextProvider = new ProjectContextProvider(fileContextProvider);
  const templateManager = new TemplateManager(context);

  // ─── Commands ────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('aiAgentOrchestrator.openPanel', () => {
      openOrFocusPanel(context, fileContextProvider, projectContextProvider, templateManager);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiAgentOrchestrator.createFromTemplate', async () => {
      openOrFocusPanel(context, fileContextProvider, projectContextProvider, templateManager);
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
  projectContextProvider: ProjectContextProvider,
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

  // Restore last execution state if available
  const savedState = context.globalState.get<SerializedExecutionState>('lastExecutionState');
  if (savedState && (savedState.status === 'completed' || savedState.status === 'error')) {
    // Delay slightly to ensure webview is ready
    setTimeout(() => {
      postMessage({ type: 'status:update', payload: { execution_state: savedState } });
    }, 500);
  }

  // Handle messages from Webview
  currentPanel.webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      await handleWebviewMessage(message, context, fileContextProvider, projectContextProvider, templateManager);
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
  projectContextProvider: ProjectContextProvider,
  templateManager: TemplateManager
): Promise<void> {
  switch (message.type) {
    case 'source:get': {
      // Legacy: return active file only
      const source = fileContextProvider.getActiveFileSnapshot();
      postMessage({ type: 'source:get', payload: { source } });
      break;
    }

    case 'context:get': {
      const opts = getContextOptions(context);
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const ctx = await projectContextProvider.buildProjectContext(workspaceRoot, opts);
      const summary = projectContextProvider.buildSummary(ctx);
      postMessage({ type: 'context:get', payload: { summary } });
      break;
    }

    case 'context:set_mode': {
      const payload = message.payload as { mode: 'file' | 'project' };
      await context.globalState.update('contextMode', payload.mode);
      // Immediately refresh context
      const opts = getContextOptions(context);
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const ctx = await projectContextProvider.buildProjectContext(workspaceRoot, opts);
      const summary = projectContextProvider.buildSummary(ctx);
      postMessage({ type: 'context:get', payload: { summary } });
      break;
    }

    case 'workflow:generate': {
      const payload = message.payload as GenerateWorkflowPayload;
      await handleGenerateWorkflow(payload, context, fileContextProvider, projectContextProvider);
      break;
    }

    case 'workflow:execute': {
      const payload = message.payload as ExecuteWorkflowPayload;
      await handleExecuteWorkflow(payload, context, fileContextProvider, projectContextProvider);
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
      const template = await templateManager.save({
        ...payload,
        scope: payload.location,
      });
      postMessage({ type: 'template:save', payload: { template } });
      vscode.window.showInformationMessage(`Template "${template.name}" saved.`);
      break;
    }

    case 'template:list': {
      const templates = await templateManager.list();
      postMessage({ type: 'template:list', payload: { templates } });
      break;
    }

    case 'output:open_tab': {
      const payload = message.payload as { content: string; format: OutputFormat; filename: string };
      await openOutputTab(payload.content, payload.format, payload.filename);
      break;
    }

    case 'output:save': {
      const payload = message.payload as { output_key: string; content: string; filename: string };
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(payload.filename),
        filters: { 'Text files': ['md', 'txt', 'json'], 'All files': ['*'] },
      });
      if (uri) {
        const contentBytes = new TextEncoder().encode(payload.content);
        await vscode.workspace.fs.writeFile(uri, contentBytes);
        vscode.window.showInformationMessage(`Output saved to ${uri.fsPath}`);
      }
      break;
    }

    case 'output:apply': {
      const payload = message.payload as ApplyOutputPayload;
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showErrorMessage('No active text editor found to apply changes.');
        return;
      }

      const doc = editor.document;

      // Create a temporary document with the new content for comparison
      const uriParts = doc.uri.path.split('/');
      const fileName = uriParts[uriParts.length - 1];
      const tmpUri = vscode.Uri.parse(`untitled:AI_Suggested_${fileName}`);

      // Open the untitled document with the suggested content
      const tmpDoc = await vscode.workspace.openTextDocument(tmpUri);
      const tmpEditor = await vscode.window.showTextDocument(tmpDoc, { preview: true, preserveFocus: true });

      await tmpEditor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(0, 0), payload.content);
      });

      // Open the VS Code native diff viewer
      await vscode.commands.executeCommand(
        'vscode.diff',
        doc.uri,
        tmpDoc.uri,
        `Apply Output: ${fileName}`,
        { preview: false }
      );
      break;
    }

    case 'clipboard:write': {
      const payload = message.payload as { text: string };
      await vscode.env.clipboard.writeText(payload.text);
      break;
    }

    case 'workflow:execute_from': {
      const payload = message.payload as { config: WorkflowConfig; fromStep: number };
      if (currentOrchestrator) {
        await currentOrchestrator.executeFrom(payload.config, payload.fromStep);
      }
      break;
    }

    case 'template:export': {
      const payload = message.payload as { template_id: string };
      const templates = await templateManager.list();
      const template = templates.find((t) => t.template_id === payload.template_id);
      if (template) {
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`${template.name.replace(/[^a-z0-9]/gi, '_')}.aao-template.json`),
          filters: { 'AAO Template': ['json'] },
        });
        if (uri) {
          const contentBytes = new TextEncoder().encode(JSON.stringify(template, null, 2));
          await vscode.workspace.fs.writeFile(uri, contentBytes);
          vscode.window.showInformationMessage(`Template exported to ${uri.fsPath}`);
        }
      }
      break;
    }

    case 'template:import': {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        filters: { 'AAO Template': ['json'] },
      });
      if (uris && uris[0]) {
        const raw = await vscode.workspace.fs.readFile(uris[0]);
        const content = new TextDecoder('utf-8').decode(raw);
        await templateManager.importFromJson(content);
        const templates = await templateManager.list();
        postMessage({ type: 'template:list', payload: { templates } });
        vscode.window.showInformationMessage('Template imported successfully.');
      }
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
  fileContextProvider: FileContextProvider,
  projectContextProvider: ProjectContextProvider
): Promise<void> {
  const apiKeys = await getApiKeys(context);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const opts = getContextOptions(context);
  const projectCtx = await projectContextProvider.buildProjectContext(workspaceRoot, opts);
  // For meta-AI generation, always pass the active file as source (the meta prompt is light)
  const source = projectCtx.activeFile;

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
  fileContextProvider: FileContextProvider,
  projectContextProvider: ProjectContextProvider
): Promise<void> {
  const apiKeys = await getApiKeys(context);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const opts = getContextOptions(context);
  const projectCtx = await projectContextProvider.buildProjectContext(workspaceRoot, opts);
  const source = projectCtx.activeFile;

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

      // Persist state to globalState for restoration after VS Code reload
      if (state.status === 'completed' || state.status === 'error') {
        context.globalState.update('lastExecutionState', state);
      }

      // Show VS Code notification on error (dual notification per design)
      if (state.status === 'error') {
        vscode.window.showErrorMessage('AI Agent: An error occurred during workflow execution.', 'Show Panel')
          .then((selection: string | undefined) => {
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
  await currentOrchestrator.execute(payload.config, projectCtx);
}

// ─── Context Options ─────────────────────────────────────────────────────────

function getContextOptions(context: vscode.ExtensionContext): ProjectContextOptions {
  const vsConfig = vscode.workspace.getConfiguration('aiAgentOrchestrator');
  const modeFromVsConfig = vsConfig.get<'file' | 'project'>('contextMode', 'project');
  const modeFromState = context.globalState.get<'file' | 'project'>('contextMode');
  const mode = modeFromState ?? modeFromVsConfig;
  const tokenBudget = vsConfig.get<number>('contextTokenBudget', 32000);
  return { mode, tokenBudget };
}

// ─── API Key Management (With Fallback) ────────────────────────────────────────

const FALLBACK_SECRET_PREFIX = 'aao.secret.fallback.';

async function safeSecretsGet(context: vscode.ExtensionContext, key: string): Promise<string | undefined> {
  try {
    const val = await context.secrets.get(key);
    if (val !== undefined) return val;
  } catch (err) {
    console.warn(`[Extension] SecretStorage get failed for ${key}, trying fallback`, err);
  }
  return context.globalState.get<string>(FALLBACK_SECRET_PREFIX + key);
}

async function safeSecretsStore(context: vscode.ExtensionContext, key: string, value: string): Promise<void> {
  try {
    await context.secrets.store(key, value);
    // Remove from fallback if successfully stored in SecretStorage
    await context.globalState.update(FALLBACK_SECRET_PREFIX + key, undefined);
  } catch (err) {
    console.warn(`[Extension] SecretStorage store failed for ${key}, using fallback`, err);
    await context.globalState.update(FALLBACK_SECRET_PREFIX + key, value);
  }
}

async function getApiKeys(context: vscode.ExtensionContext): Promise<ApiKeys> {
  const openai = await safeSecretsGet(context, 'aiAgentOrchestrator.openaiKey');
  const anthropic = await safeSecretsGet(context, 'aiAgentOrchestrator.anthropicKey');
  const google = await safeSecretsGet(context, 'aiAgentOrchestrator.googleKey');
  const ollamaEndpoint = vscode.workspace
    .getConfiguration('aiAgentOrchestrator')
    .get<string>('ollamaEndpoint', 'http://localhost:11434');
  return {
    openai: openai ?? undefined,
    anthropic: anthropic ?? undefined,
    google: google ?? undefined,
    ollama: ollamaEndpoint,
  };
}

async function configureApiKeys(context: vscode.ExtensionContext): Promise<void> {
  const providers = [
    { name: 'OpenAI', secretKey: 'aiAgentOrchestrator.openaiKey', placeholder: 'sk-...' },
    { name: 'Anthropic', secretKey: 'aiAgentOrchestrator.anthropicKey', placeholder: 'sk-ant-...' },
    { name: 'Google AI', secretKey: 'aiAgentOrchestrator.googleKey', placeholder: 'AIza...' },
  ];

  for (const provider of providers) {
    const current = await safeSecretsGet(context, provider.secretKey);
    const input = await vscode.window.showInputBox({
      title: `Configure ${provider.name} API Key`,
      prompt: `Enter your ${provider.name} API key (leave empty to skip)`,
      placeHolder: provider.placeholder,
      value: current ? '••••••••' : '',
      password: true,
    });

    if (input !== undefined && input !== '' && input !== '••••••••') {
      await safeSecretsStore(context, provider.secretKey, input);
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

  await editor.edit((editBuilder: vscode.TextEditorEdit) => {
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
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.css')
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
    connect-src https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com http://localhost:* http://127.0.0.1:*;
  " />
  <link rel="stylesheet" href="${styleUri}" />
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
