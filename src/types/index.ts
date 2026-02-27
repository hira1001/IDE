// AI Agent Orchestrator — Core Type Definitions (Design v3.0)

// ─── LLM Models ───────────────────────────────────────────────────────────────

// Open string type — supports cloud models (gpt-*, claude-*, gemini-*)
// and local models via Ollama (ollama:llama3.2, ollama:mistral, etc.)
export type LLMModel = string;

export type OutputFormat = 'Markdown' | 'Mermaid' | 'JSON' | 'PlainText' | 'Code';

// ─── Agent ────────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  persona: string;
  model: LLMModel;
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export interface InputSource {
  /** 0 = initial source. In loops, always uses latest value via output_key. */
  from_step: number;
  /** "__source__" = active file */
  from_agent_id: string;
  label: string;
}

export interface Task {
  task_id: string;
  agent_id: string;
  task_name: string;
  instructions: string[];
  constraints: string[];
  output_format: OutputFormat;
  /** Key used to store/retrieve output from the shared memory (Blackboard). */
  output_key: string;
  input_mapping: InputSource[];
  enable_handover_note: boolean;
}

// ─── Workflow Step ─────────────────────────────────────────────────────────────

export interface ConditionalConfig {
  evaluator_agent_id: string;
  pass_keyword: string;
  fail_keyword: string;
  max_loops: number;
}

export interface WorkflowStep {
  step: number;
  type: 'parallel' | 'sequential' | 'conditional';
  /** Breakpoint: pause after this step completes for manual editing. */
  pause_after: boolean;
  tasks: Task[];
  condition?: ConditionalConfig;
  /** Jump destination on fail_keyword. */
  on_fail_goto?: number;
  /** Jump destination after fix step (loop back). */
  then_goto?: number;
}

// ─── Workflow Config ──────────────────────────────────────────────────────────

export interface WorkflowConfig {
  agents: Agent[];
  workflow: WorkflowStep[];
}

// ─── Source Input ─────────────────────────────────────────────────────────────

export interface SourceInput {
  content: string;
  filename: string;
  language_id: string;
  line_count: number;
  byte_size: number;
}

// ─── Project Context (whole-project understanding) ────────────────────────────

/** A single file included in the project context (not the active file). */
export interface ContextFile {
  /** Path relative to the workspace root. */
  relativePath: string;
  content: string;
  language_id: string;
  line_count: number;
  byte_size: number;
  /** Why this file was selected. */
  reason: 'imported' | 'config' | 'same_dir';
}

export interface ProjectMeta {
  /** package.json name or workspace folder name. */
  name: string;
  primaryLanguage: string;
  /** Detected from package.json dependencies (react, vue, next, etc.). */
  framework?: string;
  /** Total file count after gitignore filtering. */
  totalFiles: number;
}

/**
 * Rich context built from the entire workspace.
 * Passed from the extension host to the Orchestrator.
 */
export interface ProjectContext {
  mode: 'file' | 'project';
  /** Compact indented tree of all non-ignored files. */
  fileTree: string;
  /** Content of the currently active editor file (may be null if no editor open). */
  activeFile: SourceInput | null;
  /** Related files selected by import analysis + token budget. */
  relatedFiles: ContextFile[];
  meta: ProjectMeta;
  /** Estimated total token count for this context payload. */
  tokenEstimate: number;
}

export interface ProjectContextOptions {
  mode: 'file' | 'project';
  /** Max tokens to spend on relatedFiles (default: 32000). */
  tokenBudget: number;
}

/** Lightweight summary sent to the webview (no file content). */
export interface ProjectContextSummary {
  mode: 'file' | 'project';
  activeFilename: string | null;
  relatedFilePaths: string[];
  totalFiles: number;
  primaryLanguage: string;
  framework?: string;
  tokenEstimate: number;
}

// ─── Handover Note ────────────────────────────────────────────────────────────

export interface HandoverNote {
  from_agent_id: string;
  from_step: number;
  note: string;
}

// ─── Execution State ──────────────────────────────────────────────────────────

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'aborted';

export type TaskStatus =
  | 'idle'
  | 'running'
  | 'validating'
  | 'retrying'
  | 'paused'
  | 'completed'
  | 'error'
  | 'skipped'
  | 'aborted';

export type ValidationResult = 'pass' | 'retried_pass' | 'fail';

export interface TaskState {
  status: TaskStatus;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
  error_message?: string;
  validation_result?: ValidationResult;
  retry_count: number;
}

export type ExecutionLogEvent =
  | 'start'
  | 'complete'
  | 'error'
  | 'retry'
  | 'validation_fail'
  | 'validation_pass'
  | 'loop'
  | 'skip'
  | 'pause'
  | 'resume'
  | 'abort'
  | 'manual_edit';

export interface ExecutionLogEntry {
  timestamp: string;
  step: number;
  task_id: string;
  event: ExecutionLogEvent;
  details?: string;
}

export interface ExecutionState {
  workflow_id: string;
  status: WorkflowStatus;
  current_step: number;
  loop_counts: Map<number, number>;
  task_states: Map<string, TaskState>;
  /** key: output_key, value: latest output text */
  output_store: Map<string, string>;
  handover_notes: HandoverNote[];
  execution_log: ExecutionLogEntry[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

// ─── Template ─────────────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  schema_version: string;
  template_id: string;
  name: string;
  description: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  config: WorkflowConfig;
}

// ─── LLM Gateway ──────────────────────────────────────────────────────────────

export interface LLMRequest {
  model: LLMModel;
  system_prompt: string;
  user_prompt: string;
  max_tokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
  duration_ms: number;
}

export interface LLMGateway {
  chat(request: LLMRequest): Promise<LLMResponse>;
  abort(): void;
  estimateTokens(text: string): number;
}

// ─── Cost Table ───────────────────────────────────────────────────────────────

export interface ModelPricing {
  model: LLMModel;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
}

// ─── Dry Run ──────────────────────────────────────────────────────────────────

export interface DryRunTaskResult {
  task_id: string;
  task_name: string;
  agent_name: string;
  model: LLMModel;
  system_prompt: string;
  user_prompt: string;
  estimated_input_tokens: number;
}

export interface DryRunStepResult {
  step: number;
  type: WorkflowStep['type'];
  tasks: DryRunTaskResult[];
}

export interface DryRunResult {
  steps: DryRunStepResult[];
  total_min_tokens: number;
  total_max_tokens: number;
  estimated_min_cost_usd: number;
  estimated_max_cost_usd: number;
  providers: string[];
}

// ─── Webview <-> Extension Host Messages ─────────────────────────────────────

export type WebviewMessageType =
  | 'workflow:generate'
  | 'workflow:execute'
  | 'workflow:execute_from'
  | 'workflow:abort'
  | 'workflow:retry'
  | 'workflow:pause_resume'
  | 'workflow:dryrun'
  | 'workflow:manual_edit'
  | 'status:update'
  | 'template:save'
  | 'template:load'
  | 'template:list'
  | 'template:export'
  | 'template:import'
  | 'config:update'
  | 'source:get'
  | 'context:get'
  | 'context:set_mode'
  | 'output:open_tab'
  | 'output:save'
  | 'clipboard:write';

export interface WebviewMessage {
  type: WebviewMessageType;
  payload?: unknown;
}

// workflow:generate payload
export interface GenerateWorkflowPayload {
  instruction: string;
  source?: SourceInput;
}

// workflow:execute payload
export interface ExecuteWorkflowPayload {
  config: WorkflowConfig;
}

// workflow:retry payload
export interface RetryTaskPayload {
  task_id: string;
}

// workflow:manual_edit payload
export interface ManualEditPayload {
  output_key: string;
  content: string;
}

// status:update payload (sent from Extension Host to Webview)
export interface StatusUpdatePayload {
  execution_state: SerializedExecutionState;
}

// Serialized version of ExecutionState (Maps → plain objects for postMessage)
export interface SerializedExecutionState {
  workflow_id: string;
  status: WorkflowStatus;
  current_step: number;
  loop_counts: Record<string, number>;
  task_states: Record<string, TaskState>;
  output_store: Record<string, string>;
  handover_notes: HandoverNote[];
  execution_log: ExecutionLogEntry[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

// template:save payload
export interface SaveTemplatePayload {
  name: string;
  description: string;
  tags: string[];
  config: WorkflowConfig;
  location: 'workspace' | 'global';
}

// template:list response
export interface TemplateListPayload {
  templates: WorkflowTemplate[];
}

// config:update payload
export interface ConfigUpdatePayload {
  key: string;
  value: unknown;
}

// source:get response (legacy — kept for backward compat)
export interface SourceGetPayload {
  source: SourceInput | null;
}

// context:get response
export interface ContextGetPayload {
  summary: ProjectContextSummary;
}

// context:set_mode payload
export interface ContextSetModePayload {
  mode: 'file' | 'project';
}

// output:open_tab payload
export interface OpenTabPayload {
  output_key: string;
  content: string;
  format: OutputFormat;
  filename: string;
}
