import {
  WorkflowConfig,
  WorkflowStep,
  Task,
  Agent,
  SourceInput,
  ProjectContext,
  SerializedExecutionState,
  HandoverNote,
  AgentLoopEvent,
  LLMGateway,
} from '../types/index.js';
import { StateManager } from './stateManager.js';
import { PromptBuilder } from './promptBuilder.js';
import { OutputValidator } from './outputValidator.js';
import { ConditionEvaluator } from './conditionEvaluator.js';
import { AbortManager } from './abortManager.js';
import { getGateway, ApiKeys } from '../llm/gateway.js';
import { getCostForTokens } from '../llm/pricing.js';
import { getAllowedTools } from '../tools/toolDefinitions.js';
import { FileChangeTracker } from '../tools/fileChangeTracker.js';
import { ToolExecutor, VscodeApiForTools } from '../tools/toolExecutor.js';
import { AgentLoopEngine } from './reactLoop.js';
import { VscodeLMApi } from '../llm/vscodeLMAdapter.js';

export type StatusCallback = (state: SerializedExecutionState) => void;
export type PauseCallback = (stepIndex: number, outputs: Record<string, string>) => Promise<void>;
export type StreamChunkCallback = (taskId: string, chunk: string) => void;

export interface OrchestratorOptions {
  apiKeys: ApiKeys;
  onStatusUpdate: StatusCallback;
  onPause?: PauseCallback;
  /** Called with each streaming text chunk as it arrives from the LLM. */
  onStreamChunk?: StreamChunkCallback;
  /** Timeout for each LLM call in ms (default: 60000) */
  timeout?: number;
  /** Workspace root for file tools used by agentic tasks (defaults to process.cwd()). */
  workspaceRoot?: string;
  /** VS Code API injection for IDE tools (diagnostics, definition, references). */
  vscode?: VscodeApiForTools;
  /** VS Code Language Model API for routing vscode: prefixed models. */
  vscodeLM?: VscodeLMApi;
  /** Called for each ReAct loop tool_call / tool_result event. */
  onAgentLoopEvent?: (event: AgentLoopEvent) => void;
  /** Called to confirm terminal commands when autonomy mode is 'confirm'. */
  onConfirmTerminal?: (command: string) => Promise<boolean>;
}

/**
 * Core Orchestrator — Executes a WorkflowConfig step by step.
 * Handles parallel, sequential, and conditional steps.
 * Integrates Output Validator, Condition Evaluator, and Abort Manager.
 */
export class Orchestrator {
  private readonly stateManager: StateManager;
  private readonly outputValidator: OutputValidator;
  private readonly conditionEvaluator: ConditionEvaluator;
  private readonly abortManager: AbortManager;
  private readonly timeout: number;
  /** Tracks all in-flight LLM gateways so abort() can cancel active fetch calls. */
  private readonly activeGateways: Map<string, ReturnType<typeof getGateway>> = new Map();
  /** Tracks AbortControllers for active ReAct loops so abort() can cancel them. */
  private readonly activeLoopAbortControllers: Map<string, AbortController> = new Map();

  constructor(private readonly options: OrchestratorOptions) {
    this.stateManager = new StateManager();
    this.outputValidator = new OutputValidator();
    this.conditionEvaluator = new ConditionEvaluator();
    this.abortManager = new AbortManager();
    this.timeout = options.timeout ?? 60_000;
  }

  getStateManager(): StateManager {
    return this.stateManager;
  }

  async execute(config: WorkflowConfig, source: SourceInput | ProjectContext): Promise<void> {
    this.stateManager.reset();
    if ('mode' in source) {
      // ProjectContext
      this.stateManager.setProjectContext(source);
    } else {
      this.stateManager.setSource(source);
    }
    this.stateManager.setStatus('running');

    // Initialize task states
    for (const step of config.workflow) {
      for (const task of step.tasks) {
        this.stateManager.initTaskState(task.task_id);
      }
    }

    this.emit();

    try {
      await this.runWorkflow(config);
      if (this.stateManager.getStatus() !== 'aborted') {
        this.stateManager.setStatus('completed');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.stateManager.setStatus('aborted');
      } else {
        this.stateManager.setStatus('error');
        console.error('[Orchestrator] Fatal error:', err);
      }
    } finally {
      this.abortManager.clear();
      this.emit();
    }
  }

  abort(): void {
    // Abort all in-flight LLM fetch calls via their gateway's internal AbortController
    for (const gateway of this.activeGateways.values()) {
      gateway.abort();
    }
    // Abort active ReAct loops
    for (const controller of this.activeLoopAbortControllers.values()) {
      controller.abort();
    }
    this.abortManager.abortAll();
    this.stateManager.setStatus('aborted');
    this.emit();
  }

  async retryTask(taskId: string, config: WorkflowConfig): Promise<void> {
    const task = config.workflow.flatMap((s) => s.tasks).find((t) => t.task_id === taskId);
    const step = config.workflow.find((s) => s.tasks.some((t) => t.task_id === taskId));
    const agent = task ? config.agents.find((a) => a.id === task.agent_id) : undefined;

    if (!task || !step || !agent) {
      throw new Error(`Task ${taskId} not found in config.`);
    }

    this.stateManager.initTaskState(taskId);
    this.emit();

    const source = this.stateManager.getSource();
    const promptBuilder = new PromptBuilder(this.stateManager, source ?? null);
    await this.runTask(task, agent, step.step, config, promptBuilder);
    this.emit();
  }

  /**
   * Re-execute workflow from a specific step index, preserving outputs from prior steps.
   * Does NOT reset stateManager — reuses existing output_store.
   */
  async executeFrom(config: WorkflowConfig, fromStepIndex: number): Promise<void> {
    if (fromStepIndex >= config.workflow.length) {
      throw new Error(
        `executeFrom: fromStepIndex ${fromStepIndex} is out of bounds (workflow has ${config.workflow.length} steps).`
      );
    }

    // Reinitialize task states and loop counters for all steps from fromStepIndex onwards
    for (let i = fromStepIndex; i < config.workflow.length; i++) {
      this.stateManager.resetLoopCount(config.workflow[i].step);
      for (const task of config.workflow[i].tasks) {
        this.stateManager.initTaskState(task.task_id);
      }
    }
    this.stateManager.setStatus('running');
    this.emit();

    try {
      await this.runWorkflowFrom(config, fromStepIndex);
      if (this.stateManager.getStatus() !== 'aborted') {
        this.stateManager.setStatus('completed');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.stateManager.setStatus('aborted');
      } else {
        this.stateManager.setStatus('error');
        console.error('[Orchestrator] Fatal error in executeFrom:', err);
      }
    } finally {
      this.abortManager.clear();
      this.emit();
    }
  }

  manualEditOutput(outputKey: string, content: string, step: number): void {
    this.stateManager.setOutput(outputKey, content);
    this.stateManager.log(step, '__manual__', 'manual_edit', `output_key: ${outputKey}`);
    this.emit();
  }

  resumeFromPause(): void {
    this.stateManager.setStatus('running');
    this.emit();
  }

  // ─── Internal Execution ───────────────────────────────────────────────────

  private async runWorkflowFrom(config: WorkflowConfig, fromStepIndex: number): Promise<void> {
    return this.runWorkflowInternal(config, fromStepIndex);
  }

  private async runWorkflow(config: WorkflowConfig): Promise<void> {
    return this.runWorkflowInternal(config, 0);
  }

  private async runWorkflowInternal(config: WorkflowConfig, startStepIndex: number): Promise<void> {
    const { workflow } = config;
    let stepIndex = startStepIndex;

    while (stepIndex < workflow.length) {
      const step = workflow[stepIndex];
      this.stateManager.setCurrentStep(step.step);
      this.emit();

      const source = this.stateManager.getSource();
      const promptBuilder = new PromptBuilder(this.stateManager, source ?? null);

      if (this.stateManager.getStatus() === 'aborted') break;

      if (step.type === 'parallel') {
        await this.runParallelStep(step, config, promptBuilder);
      } else if (step.type === 'sequential') {
        await this.runSequentialStep(step, config, promptBuilder);
      } else if (step.type === 'conditional') {
        const nextStep = await this.runConditionalStep(step, config, promptBuilder, stepIndex);
        if (nextStep !== null) {
          stepIndex = nextStep;
          continue;
        }
      }

      if (step.pause_after && this.stateManager.getStatus() !== 'aborted') {
        await this.handlePause(step, config);
        if (this.stateManager.getStatus() === 'aborted') break;
      }

      // Handle then_goto (loop back after fix step)
      if (step.then_goto !== undefined) {
        const gotoIdx = workflow.findIndex((s) => s.step === step.then_goto);
        if (gotoIdx !== -1) {
          stepIndex = gotoIdx;
          this.stateManager.log(step.step, '__orchestrator__', 'loop', `goto step ${step.then_goto}`);
          this.emit();
          continue;
        }
      }

      stepIndex++;
    }
  }

  private async runParallelStep(
    step: WorkflowStep,
    config: WorkflowConfig,
    promptBuilder: PromptBuilder
  ): Promise<void> {
    const agents = config.agents;
    const tasks = step.tasks.map((task) => {
      const agent = agents.find((a) => a.id === task.agent_id);
      if (!agent) throw new Error(`Agent ${task.agent_id} not found.`);
      return this.runTask(task, agent, step.step, config, promptBuilder);
    });

    await Promise.allSettled(tasks);

    // Check if abort was triggered while parallel tasks were running
    // (runTask handles individual errors internally; we check global abort here)
    if (this.stateManager.getStatus() === 'aborted') return;
  }

  private async runSequentialStep(
    step: WorkflowStep,
    config: WorkflowConfig,
    promptBuilder: PromptBuilder
  ): Promise<void> {
    for (const task of step.tasks) {
      if (this.stateManager.getStatus() === 'aborted') break;
      const agent = config.agents.find((a) => a.id === task.agent_id);
      if (!agent) throw new Error(`Agent ${task.agent_id} not found.`);
      await this.runTask(task, agent, step.step, config, promptBuilder);
    }
  }

  /** Returns the next stepIndex override, or null to continue normally. */
  private async runConditionalStep(
    step: WorkflowStep,
    config: WorkflowConfig,
    promptBuilder: PromptBuilder,
    _currentStepIndex: number
  ): Promise<number | null> {
    if (!step.condition) return null;

    for (const task of step.tasks) {
      if (this.stateManager.getStatus() === 'aborted') break;
      const agent = config.agents.find((a) => a.id === task.agent_id);
      if (!agent) throw new Error(`Agent ${task.agent_id} not found.`);
      await this.runTask(task, agent, step.step, config, promptBuilder);
    }

    if (this.stateManager.getStatus() === 'aborted') return null;

    // Evaluate condition using the evaluator agent's output
    const evalTask = step.tasks.find((t) => t.agent_id === step.condition!.evaluator_agent_id);
    if (!evalTask) return null;

    const output = this.stateManager.getOutput(evalTask.output_key) ?? '';
    const result = this.conditionEvaluator.evaluate(output, step.condition);

    const loopCount = this.stateManager.incrementLoopCount(step.step);
    const maxLoops = step.condition.max_loops;

    if (result === 'pass' || loopCount >= maxLoops) {
      // Pass or forced pass (max loops reached)
      if (loopCount >= maxLoops && result !== 'pass') {
        this.stateManager.log(step.step, '__orchestrator__', 'loop', `max_loops (${maxLoops}) reached, forcing pass`);
      }
      return null; // Proceed to next step
    }

    // Fail → jump to on_fail_goto
    if (step.on_fail_goto !== undefined) {
      const gotoIdx = config.workflow.findIndex((s) => s.step === step.on_fail_goto);
      this.stateManager.log(step.step, '__orchestrator__', 'loop', `REVISION_NEEDED → goto step ${step.on_fail_goto}`);
      this.emit();
      return gotoIdx !== -1 ? gotoIdx : null;
    }

    return null;
  }

  private async runTask(
    task: Task,
    agent: Agent,
    stepNumber: number,
    config: WorkflowConfig,
    promptBuilder: PromptBuilder
  ): Promise<void> {
    const taskId = task.task_id;

    this.stateManager.setTaskStatus(taskId, 'running');
    this.stateManager.log(stepNumber, taskId, 'start');
    this.emit();

    const loopCount = this.stateManager.getLoopCount(stepNumber);
    const systemPrompt = promptBuilder.buildSystemPrompt(agent, task, loopCount);
    const userPrompt = promptBuilder.buildUserPrompt(task, config);

    try {
      const gateway = getGateway(agent.model, this.options.apiKeys, this.options.vscodeLM);
      // Register so abort() can cancel this in-flight request
      this.activeGateways.set(taskId, gateway);
      const start = Date.now();

      // Agentic (ReAct loop) path
      if (task.use_tools) {
        await this.runAgenticTask(task, agent, stepNumber, systemPrompt, userPrompt, gateway, start);
        return;
      }

      const onChunk = this.options.onStreamChunk
        ? (chunk: string) => this.options.onStreamChunk!(taskId, chunk)
        : undefined;

      let response = await this.callWithRetry(
        () => gateway.chat({ model: agent.model, system_prompt: systemPrompt, user_prompt: userPrompt, onChunk }),
        this.timeout
      );

      // Validate output
      this.stateManager.setTaskStatus(taskId, 'validating');
      this.emit();

      let validation = this.outputValidator.validate(response.content, task.output_format);

      if (!validation.pass) {
        this.stateManager.log(stepNumber, taskId, 'validation_fail', validation.reason);
        this.stateManager.setTaskStatus(taskId, 'retrying');
        this.stateManager.incrementRetry(taskId);
        this.emit();

        // Auto-retry once — append correction instruction to the original context
        // so the model retains all input data (source file, previous agent outputs)
        const retryInstruction = promptBuilder.buildRetryPrompt(response.content, task.output_format);
        const retryUserPrompt = userPrompt + '\n\n' + retryInstruction;
        response = await this.callWithRetry(
          () => gateway.chat({ model: agent.model, system_prompt: systemPrompt, user_prompt: retryUserPrompt, onChunk }),
          this.timeout
        );

        validation = this.outputValidator.validate(response.content, task.output_format);
        if (validation.pass) {
          this.stateManager.setValidationResult(taskId, 'retried_pass');
          this.stateManager.log(stepNumber, taskId, 'validation_pass', 'passed after retry');
        } else {
          this.stateManager.setValidationResult(taskId, 'fail');
          this.stateManager.log(stepNumber, taskId, 'validation_fail', 'retry also failed');
        }
      } else {
        this.stateManager.setValidationResult(taskId, 'pass');
        this.stateManager.log(stepNumber, taskId, 'validation_pass');
      }

      // Extract handover note if enabled
      const { mainContent, note } = this.outputValidator.extractHandoverNote(response.content);

      if (task.enable_handover_note && note) {
        const handoverNote: HandoverNote = {
          from_agent_id: agent.id,
          from_step: stepNumber,
          note,
        };
        this.stateManager.addHandoverNote(handoverNote);
      }

      // Store output (always latest wins — overwrites previous for same key in loops)
      this.stateManager.setOutput(task.output_key, mainContent);

      // Record token usage and cost
      const cost = getCostForTokens(agent.model, response.input_tokens, response.output_tokens);
      this.stateManager.addTokenUsage(response.input_tokens, response.output_tokens, cost);

      const duration = Date.now() - start;
      this.stateManager.updateTaskState(taskId, {
        status: 'completed',
        input_tokens: response.input_tokens,
        output_tokens: response.output_tokens,
        duration_ms: duration,
      });
      this.stateManager.log(stepNumber, taskId, 'complete', `${response.input_tokens}in+${response.output_tokens}out tokens`);
    } catch (err) {
      const message = (err as Error).message ?? 'Unknown error';
      if ((err as Error).name === 'AbortError') {
        this.stateManager.setTaskStatus(taskId, 'aborted');
        this.stateManager.log(stepNumber, taskId, 'abort');
      } else {
        this.stateManager.setTaskError(taskId, message);
        this.stateManager.log(stepNumber, taskId, 'error', message);
      }
    } finally {
      this.activeGateways.delete(taskId);
    }

    this.emit();
  }

  /**
   * Runs a task using the ReAct (Reason → Act → Observe) loop with tool calling.
   * Called by runTask() when task.use_tools is true.
   */
  private async runAgenticTask(
    task: Task,
    agent: Agent,
    stepNumber: number,
    systemPrompt: string,
    userPrompt: string,
    gateway: LLMGateway,
    start: number
  ): Promise<void> {
    const taskId = task.task_id;
    const tools = getAllowedTools(task.allowed_tools);
    const tracker = new FileChangeTracker();

    const abortController = new AbortController();
    this.activeLoopAbortControllers.set(taskId, abortController);

    const executor = new ToolExecutor({
      workspaceRoot: this.options.workspaceRoot ?? process.cwd(),
      tracker,
      autonomyMode: 'auto',
      confirmTerminal: this.options.onConfirmTerminal ?? (() => Promise.resolve(false)),
      vscode: this.options.vscode,
    });

    const loop = new AgentLoopEngine(gateway, executor, tracker, taskId, {
      maxIterations: task.max_tool_iterations ?? 10,
      autoApplyEdits: task.auto_apply_edits ?? true,
      abortSignal: abortController.signal,
      onEvent: (event) => {
        this.options.onAgentLoopEvent?.(event);
        if (event.type === 'tool_call' || event.type === 'tool_result') {
          this.stateManager.log(stepNumber, taskId, event.type, event.toolName ?? '');
          this.emit();
        }
      },
    });

    this.stateManager.setTaskStatus(taskId, 'tool_calling');
    this.emit();

    try {
      const result = await loop.run(systemPrompt, userPrompt, agent.model, tools);

      this.stateManager.setOutput(task.output_key, result.finalText);

      const cost = getCostForTokens(agent.model, result.totalInputTokens, result.totalOutputTokens);
      this.stateManager.addTokenUsage(result.totalInputTokens, result.totalOutputTokens, cost);

      const duration = Date.now() - start;
      this.stateManager.updateTaskState(taskId, {
        status: 'completed',
        input_tokens: result.totalInputTokens,
        output_tokens: result.totalOutputTokens,
        duration_ms: duration,
      });
      this.stateManager.log(
        stepNumber,
        taskId,
        'complete',
        `${result.totalInputTokens}in+${result.totalOutputTokens}out tokens, ${result.iterations} iterations, ${result.filesChanged.length} files changed`
      );
      this.emit();
    } finally {
      this.activeLoopAbortControllers.delete(taskId);
    }
  }

  private async handlePause(step: WorkflowStep, _config: WorkflowConfig): Promise<void> {
    this.stateManager.setStatus('paused');
    this.stateManager.log(step.step, '__orchestrator__', 'pause');
    this.emit();

    if (this.options.onPause) {
      const outputs: Record<string, string> = {};
      for (const task of step.tasks) {
        const output = this.stateManager.getOutput(task.output_key);
        if (output !== undefined) {
          outputs[task.output_key] = output;
        }
      }
      await this.options.onPause(step.step, outputs);
    }

    // Wait until status is changed back to 'running' (via resumeFromPause)
    await this.waitForResume();
    this.stateManager.log(step.step, '__orchestrator__', 'resume');
  }

  private waitForResume(): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = () => {
        const status = this.stateManager.getStatus();
        if (status === 'running' || status === 'aborted') {
          resolve();
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
  }

  private async callWithRetry<T>(
    apiCall: () => Promise<T>,
    timeoutMs: number,
    maxRetries = 3,
    baseDelayMs = 2000
  ): Promise<T> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.callWithTimeout(apiCall(), timeoutMs);
      } catch (err) {
        attempt++;
        const errMessage = err instanceof Error ? err.message : String(err);
        const isAbort = err instanceof Error && err.name === 'AbortError';

        // Do not retry on AbortError or terminal client errors (e.g., 400 Bad Request, 401 Unauthorized)
        // Retry on 429 Too Many Requests, 500, 502, 503, 504 and network timeouts.
        if (
          isAbort ||
          attempt > maxRetries ||
          ((errMessage.includes('400') || errMessage.includes('401') || errMessage.includes('403')) && !errMessage.includes('429'))
        ) {
          throw err;
        }

        // Exponential backoff with jitter
        const jitter = Math.random() * 500;
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;

        console.warn(`[Orchestrator] API call failed, retrying in ${Math.round(delay)}ms (Attempt ${attempt}/${maxRetries}). Error: ${errMessage}`);

        await new Promise((resolve) => setTimeout(resolve, delay));

        // Ensure abort wasn't called during the sleep
        if (this.stateManager.getStatus() === 'aborted') {
          const abortErr = new Error('Workflow aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
      }
    }
  }

  private callWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`LLM API call timed out after ${ms}ms`));
      }, ms);

      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  private emit(): void {
    this.options.onStatusUpdate(this.stateManager.serialize());
  }
}
