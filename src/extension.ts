import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
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
  AgentLoopEvent,
} from './types/index.js';
import { VscodeApiForTools } from './tools/toolExecutor.js';
import { VscodeLMApi, listVscodeLMModels } from './llm/vscodeLMAdapter.js';

const EXTENSION_ID = 'ai-agent-orchestrator';
let currentPanel: vscode.WebviewPanel | undefined;
let currentOrchestrator: Orchestrator | undefined;

// ─── Available Models Lists ────────────────────────────────────────────────────

const OPENAI_MODELS = [
  'o3', 'o3-mini', 'o1', 'o1-mini', 'o1-preview',
  'gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-11-20', 'gpt-4o-2024-08-06', 'gpt-4o-2024-05-13', 'gpt-4o-mini-2024-07-18',
  'gpt-4-turbo', 'gpt-4-turbo-preview', 'gpt-4-turbo-2024-04-09', 'gpt-4-0125-preview', 'gpt-4-1106-preview',
  'gpt-4', 'gpt-4-0613', 'gpt-4-32k', 'gpt-4-32k-0613',
  'gpt-3.5-turbo', 'gpt-3.5-turbo-0125', 'gpt-3.5-turbo-1106', 'gpt-3.5-turbo-16k',
];

const ANTHROPIC_MODELS = [
  'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5',
  'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-20240620', 'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307',
];

const GOOGLE_MODELS = [
  'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-thinking-exp', 'gemini-2.0-pro-exp', 'gemini-2.5-pro-exp-03-25',
  'gemini-1.5-pro', 'gemini-1.5-pro-002', 'gemini-1.5-flash', 'gemini-1.5-flash-002', 'gemini-1.5-flash-8b',
  'gemini-1.0-pro', 'gemini-ultra',
];

const SECRET_KEYS = [
  'aiAgentOrchestrator.openaiKey',
  'aiAgentOrchestrator.anthropicKey',
  'aiAgentOrchestrator.googleKey',
];

const SECRET_KEY_MAP: Record<string, string> = {
  openai: 'aiAgentOrchestrator.openaiKey',
  anthropic: 'aiAgentOrchestrator.anthropicKey',
  google: 'aiAgentOrchestrator.googleKey',
};

interface AvailableModels {
  openai: string[];
  anthropic: string[];
  google: string[];
  ollama: string[];
  vscodeLM: string[];
}

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

  context.subscriptions.push(
    vscode.commands.registerCommand('aiAgentOrchestrator.resetState', async () => {
      const ok = await vscode.window.showWarningMessage(
        'Reset all extension data? API keys and saved state will be cleared.',
        { modal: true },
        'Reset',
        'Cancel'
      );
      if (ok !== 'Reset') return;
      for (const key of SECRET_KEYS) {
        try { await context.secrets.delete(key); } catch { /* ignore */ }
      }
      await context.globalState.update('lastExecutionState', undefined);
      vscode.window.showInformationMessage('AI Agent: Extension state has been reset.');
      const settingsCurrent = await buildSettingsCurrent(context);
      postMessage({ type: 'settings:current', payload: settingsCurrent });
    })
  );

  // ─── External agent integration commands ─────────────────────────────────
  // These commands allow Cursor Composer, Google Antigravity, and other AI
  // agents to invoke the orchestrator programmatically.

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'aiAgentOrchestrator.runPrompt',
      async (args?: { prompt: string; model?: string; systemPrompt?: string }) => {
        if (!args?.prompt) {
          vscode.window.showErrorMessage('aiAgentOrchestrator.runPrompt: "prompt" argument is required.');
          return undefined;
        }
        if (args.prompt.length > 50_000) {
          vscode.window.showErrorMessage('aiAgentOrchestrator.runPrompt: prompt exceeds 50,000 character limit.');
          return undefined;
        }
        const VALID_PREFIXES = ['gpt-', 'o1', 'o3', 'claude-', 'gemini-', 'ollama:', 'vscode:'];
        const model = args.model ?? 'gpt-4o';
        if (!VALID_PREFIXES.some((p) => model.startsWith(p))) {
          vscode.window.showErrorMessage(`aiAgentOrchestrator.runPrompt: unknown model prefix for "${model}".`);
          return undefined;
        }
        const apiKeys = await getApiKeys(context);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const vscodeLM = vscode as unknown as VscodeLMApi;

        const singleTaskConfig: WorkflowConfig = {
          agents: [{
            id: 'external_agent',
            name: 'External Agent',
            persona: args.systemPrompt ?? 'You are a helpful AI assistant.',
            model,
          }],
          workflow: [{
            step: 1,
            type: 'sequential',
            tasks: [{
              task_id: 'external_task',
              task_name: 'External Prompt',
              agent_id: 'external_agent',
              instructions: [args.prompt],
              constraints: [],
              input_mapping: [],
              output_key: 'external_output',
              output_format: 'PlainText' as OutputFormat,
              enable_handover_note: false,
            }],
            pause_after: false,
          }],
        };

        const orch = new Orchestrator({
          apiKeys,
          workspaceRoot,
          vscodeLM,
          onStatusUpdate: () => undefined,
        });
        await orch.execute(singleTaskConfig, {
          content: '', filename: '', language_id: '', line_count: 0, byte_size: 0,
        });
        return orch.getStateManager().serialize().output_store['external_output'];
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aiAgentOrchestrator.getLastOutput', () => {
      if (!currentOrchestrator) return undefined;
      return currentOrchestrator.getStateManager().serialize().output_store;
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

  // Saved state is sent once the webview signals it's ready (see 'webview:ready' handler below).
  // This avoids the race condition of postMessage() arriving before React has mounted.

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
    case 'webview:ready': {
      // Webview is mounted and listening — now safe to restore saved execution state.
      const savedState = context.globalState.get<SerializedExecutionState>('lastExecutionState');
      if (savedState && (savedState.status === 'completed' || savedState.status === 'error')) {
        postMessage({ type: 'status:update', payload: { execution_state: savedState } });
      }

      // Send current settings (available models + key status) on startup
      const settingsCurrent = await buildSettingsCurrent(context);
      postMessage({ type: 'settings:current', payload: settingsCurrent });

      // First-time onboarding: notify webview when no API keys are configured
      const hasAnyKey = settingsCurrent.openai === 'set' || settingsCurrent.anthropic === 'set' || settingsCurrent.google === 'set';
      const hasVscodeLM = settingsCurrent.vscodeLMCount > 0;
      if (!hasAnyKey && !hasVscodeLM) {
        postMessage({ type: 'onboarding:no_api_keys' });
      }
      break;
    }

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

    case 'command:configureApiKeys': {
      await configureApiKeys(context);
      break;
    }

    case 'command:resetState': {
      await vscode.commands.executeCommand('aiAgentOrchestrator.resetState');
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
      if (!source) {
        vscode.window.showWarningMessage('AI Agent: Open a file in the editor before running Dry Run.');
        break;
      }
      const dryRunner = new DryRunner();
      const result = dryRunner.run(payload.config, source);
      postMessage({ type: 'workflow:dryrun', payload: { result } });
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
      const tmpUri = vscode.Uri.parse(`untitled:AI_Suggested_${fileName}_${Date.now()}`);

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

    case 'agent:draft_instruction': {
      const payload = message.payload as {
        task_id: string;
        brief: string;
        agent_name: string;
        persona: string;
        task_name: string;
      };
      try {
        const apiKeys = await getApiKeys(context);
        const cfg = vscode.workspace.getConfiguration('aiAgentOrchestrator');
        const defaultModel = cfg.get<string>('defaultModel', 'gpt-4o') as import('./types/index.js').LLMModel;
        const metaAI = new MetaAIService(apiKeys, defaultModel);
        const activeFile = fileContextProvider.getActiveFileSnapshot();
        const instruction = await metaAI.draftAgentInstruction(payload.brief, {
          agentName: payload.agent_name,
          persona: payload.persona,
          taskName: payload.task_name,
          fileName: activeFile?.filename,
        });
        postMessage({ type: 'agent:instruction_drafted', payload: { task_id: payload.task_id, instruction } });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        postMessage({ type: 'agent:instruction_drafted', payload: { task_id: payload.task_id, error: errMsg } });
      }
      break;
    }

    case 'workflow:execute_from': {
      const payload = message.payload as { config: WorkflowConfig; fromStep: number };
      if (currentOrchestrator) {
        try {
          await currentOrchestrator.executeFrom(payload.config, payload.fromStep);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Re-run failed: ${errMsg}`);
        }
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

    case 'template:delete': {
      const payload = message.payload as { template_id: string; name: string };
      const answer = await vscode.window.showWarningMessage(
        `Delete template "${payload.name}"? This cannot be undone.`,
        { modal: true },
        'Delete'
      );
      if (answer === 'Delete') {
        const deleted = await templateManager.deleteById(payload.template_id);
        if (deleted) {
          const templates = await templateManager.list();
          postMessage({ type: 'template:list', payload: { templates } });
        }
      }
      break;
    }

    case 'lm:models_list': {
      const models = await listVscodeLMModels(vscode as unknown as VscodeLMApi);
      postMessage({ type: 'lm:models_list', payload: { models } });
      break;
    }

    case 'settings:get': {
      const settingsCurrent = await buildSettingsCurrent(context);
      postMessage({ type: 'settings:current', payload: settingsCurrent });
      break;
    }

    case 'settings:save': {
      const p = message.payload as { provider: 'openai' | 'anthropic' | 'google'; key: string };
      const secretKey = SECRET_KEY_MAP[p.provider];
      if (secretKey && p.key) {
        try {
          await safeSecretsStore(context, secretKey, p.key);
          // Auto-set defaultModel if current default is from an unconfigured provider
          await autoUpdateDefaultModel(context, p.provider);
          postMessage({ type: 'settings:saved', payload: { provider: p.provider, success: true } });
          const updated = await buildSettingsCurrent(context);
          postMessage({ type: 'settings:current', payload: updated });
        } catch {
          postMessage({ type: 'settings:saved', payload: { provider: p.provider, success: false } });
        }
      }
      break;
    }

    case 'settings:clear': {
      const p = message.payload as { provider: 'openai' | 'anthropic' | 'google' };
      const secretKey = SECRET_KEY_MAP[p.provider];
      if (secretKey) {
        try { await context.secrets.delete(secretKey); } catch { /* ignore */ }
        // Also clear fallback
        await context.globalState.update(FALLBACK_SECRET_PREFIX + secretKey, undefined);
        const updated = await buildSettingsCurrent(context);
        postMessage({ type: 'settings:current', payload: updated });
      }
      break;
    }

    case 'settings:save_ollama': {
      const p = message.payload as { endpoint: string };
      await vscode.workspace
        .getConfiguration('aiAgentOrchestrator')
        .update('ollamaEndpoint', p.endpoint, vscode.ConfigurationTarget.Global);
      const updated = await buildSettingsCurrent(context);
      postMessage({ type: 'settings:current', payload: updated });
      break;
    }

    case 'settings:test_ollama': {
      const p = message.payload as { endpoint: string };
      const endpoint = p.endpoint.replace(/\/+$/, '');
      const start = Date.now();
      try {
        const res = await fetch(`${endpoint}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json() as { models?: { name: string }[] };
          const models = (data.models ?? []).map((m) => m.name);
          postMessage({ type: 'settings:ollama_result', payload: { ok: true, latency: Date.now() - start, models } });
        } else {
          postMessage({ type: 'settings:ollama_result', payload: { ok: false, error: `HTTP ${res.status}` } });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        postMessage({ type: 'settings:ollama_result', payload: { ok: false, error: msg } });
      }
      break;
    }

    case 'settings:save_default_model': {
      const p = message.payload as { model: string };
      await vscode.workspace
        .getConfiguration('aiAgentOrchestrator')
        .update('defaultModel', p.model, vscode.ConfigurationTarget.Global);
      const updated = await buildSettingsCurrent(context);
      postMessage({ type: 'settings:current', payload: updated });
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
    const msg = err instanceof Error ? err.message : String(err);
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
    workspaceRoot,
    vscode: vscode as unknown as VscodeApiForTools,
    vscodeLM: vscode as unknown as VscodeLMApi,
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
    onStreamChunk: (taskId: string, chunk: string) => {
      postMessage({ type: 'task:stream_chunk', payload: { task_id: taskId, chunk } });
    },
    onAgentLoopEvent: (event: AgentLoopEvent) => {
      postMessage({
        type: 'task:tool_event',
        payload: {
          task_id: event.taskId,
          event_type: event.type,
          tool_name: event.toolName,
          content: event.content,
          iteration: event.iteration,
        },
      });
    },
    onConfirmTerminal: async (command: string) => {
      const answer = await vscode.window.showWarningMessage(
        `AI Agent: Allow terminal command?\n\`${command}\``,
        { modal: true },
        'Allow',
        'Deny'
      );
      return answer === 'Allow';
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
    // Clean up any old plaintext fallback entry
    await context.globalState.update(FALLBACK_SECRET_PREFIX + key, undefined);
  } catch (err) {
    console.error(`[Extension] SecretStorage store failed for ${key}`, err);
    vscode.window.showWarningMessage(
      'AI Agent Orchestrator: Failed to store API key securely. Please re-enter your key in the settings.'
    );
    throw err;
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
    { id: 'openai',    name: 'OpenAI',    secretKey: 'aiAgentOrchestrator.openaiKey',    placeholder: 'sk-...' },
    { id: 'anthropic', name: 'Anthropic', secretKey: 'aiAgentOrchestrator.anthropicKey', placeholder: 'sk-ant-...' },
    { id: 'google',    name: 'Google AI', secretKey: 'aiAgentOrchestrator.googleKey',    placeholder: 'AIza...' },
  ];

  const items = await Promise.all(providers.map(async (p) => {
    const current = await safeSecretsGet(context, p.secretKey);
    return {
      label: p.name,
      description: current ? '✅ Configured' : '⚪ Not set',
      secretKey: p.secretKey,
      placeholder: p.placeholder,
      id: p.id,
    };
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Configure API Keys — Select providers to configure',
    placeHolder: 'Select one or more providers',
  });

  if (!selected || selected.length === 0) return;

  for (const provider of selected) {
    const input = await vscode.window.showInputBox({
      title: `Configure ${provider.label} API Key`,
      prompt: `Enter your ${provider.label} API key`,
      placeHolder: provider.placeholder,
      password: true,
    });
    if (input !== undefined && input !== '') {
      await safeSecretsStore(context, provider.secretKey, input);
      await autoUpdateDefaultModel(context, provider.id as 'openai' | 'anthropic' | 'google');
      vscode.window.showInformationMessage(`${provider.label} API key saved.`);
      const updated = await buildSettingsCurrent(context);
      postMessage({ type: 'settings:current', payload: updated });
    }
  }
}

// ─── Settings Helpers ─────────────────────────────────────────────────────────

async function getAvailableModels(
  openaiKey: string | undefined,
  anthropicKey: string | undefined,
  googleKey: string | undefined,
  ollamaEndpoint: string
): Promise<AvailableModels> {
  let ollamaModels: string[] = [];
  try {
    const res = await fetch(`${ollamaEndpoint.replace(/\/+$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = await res.json() as { models?: { name: string }[] };
      ollamaModels = (data.models ?? []).map((m) => `ollama:${m.name}`);
    }
  } catch { /* Ollama not running */ }

  const vscodeLMModels = await listVscodeLMModels(vscode as unknown as VscodeLMApi);

  return {
    openai:    openaiKey    ? OPENAI_MODELS    : [],
    anthropic: anthropicKey ? ANTHROPIC_MODELS : [],
    google:    googleKey    ? GOOGLE_MODELS    : [],
    ollama:    ollamaModels,
    vscodeLM:  vscodeLMModels,
  };
}

async function buildSettingsCurrent(context: vscode.ExtensionContext): Promise<{
  openai: 'set' | 'unset';
  anthropic: 'set' | 'unset';
  google: 'set' | 'unset';
  ollamaEndpoint: string;
  vscodeLMCount: number;
  defaultModel: string;
  availableModels: AvailableModels;
}> {
  const [openaiKey, anthropicKey, googleKey] = await Promise.all([
    safeSecretsGet(context, 'aiAgentOrchestrator.openaiKey'),
    safeSecretsGet(context, 'aiAgentOrchestrator.anthropicKey'),
    safeSecretsGet(context, 'aiAgentOrchestrator.googleKey'),
  ]);
  const cfg = vscode.workspace.getConfiguration('aiAgentOrchestrator');
  const ollamaEndpoint = cfg.get<string>('ollamaEndpoint', 'http://localhost:11434');
  const defaultModel = cfg.get<string>('defaultModel', 'gpt-4o');
  const availableModels = await getAvailableModels(openaiKey, anthropicKey, googleKey, ollamaEndpoint);
  const vscodeLMCount = availableModels.vscodeLM.length;
  return {
    openai:    openaiKey    ? 'set' : 'unset',
    anthropic: anthropicKey ? 'set' : 'unset',
    google:    googleKey    ? 'set' : 'unset',
    ollamaEndpoint,
    vscodeLMCount,
    defaultModel,
    availableModels,
  };
}

/** APIキー保存時に defaultModel のプロバイダーが利用不可なら、新プロバイダーの最初のモデルに自動更新 */
async function autoUpdateDefaultModel(
  context: vscode.ExtensionContext,
  savedProvider: 'openai' | 'anthropic' | 'google'
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('aiAgentOrchestrator');
  const currentDefault = cfg.get<string>('defaultModel', 'gpt-4o');

  const isOpenAI    = OPENAI_MODELS.includes(currentDefault) || currentDefault.startsWith('gpt-') || currentDefault.startsWith('o1') || currentDefault.startsWith('o3');
  const isAnthropic = ANTHROPIC_MODELS.includes(currentDefault) || currentDefault.startsWith('claude-');
  const isGoogle    = GOOGLE_MODELS.includes(currentDefault) || currentDefault.startsWith('gemini-');

  const [openaiKey, anthropicKey, googleKey] = await Promise.all([
    safeSecretsGet(context, 'aiAgentOrchestrator.openaiKey'),
    safeSecretsGet(context, 'aiAgentOrchestrator.anthropicKey'),
    safeSecretsGet(context, 'aiAgentOrchestrator.googleKey'),
  ]);

  // If current default is already from a working provider, don't change it
  if (isOpenAI && openaiKey) return;
  if (isAnthropic && anthropicKey) return;
  if (isGoogle && googleKey) return;

  // Auto-set to the flagship model of the newly saved provider
  const firstModelMap: Record<string, string> = {
    openai:    'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    google:    'gemini-2.0-flash',
  };
  const newDefault = firstModelMap[savedProvider];
  if (newDefault) {
    await cfg.update('defaultModel', newDefault, vscode.ConfigurationTarget.Global);
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
  return randomBytes(16).toString('base64');
}
