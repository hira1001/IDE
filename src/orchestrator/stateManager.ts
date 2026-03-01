import { v4 as uuidv4 } from 'uuid';
import {
  ExecutionState,
  WorkflowStatus,
  TaskStatus,
  TaskState,
  HandoverNote,
  ExecutionLogEntry,
  ExecutionLogEvent,
  ValidationResult,
  SerializedExecutionState,
  SourceInput,
  ProjectContext,
} from '../types/index.js';

/**
 * Blackboard-pattern State Manager.
 * Holds all shared state during a workflow execution.
 */
export class StateManager {
  private state: ExecutionState;
  private source: SourceInput | null = null;
  private projectContext: ProjectContext | null = null;

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): ExecutionState {
    return {
      workflow_id: uuidv4(),
      status: 'idle',
      current_step: 0,
      loop_counts: new Map(),
      task_states: new Map(),
      output_store: new Map(),
      handover_notes: [],
      execution_log: [],
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
    };
  }

  reset(): void {
    this.state = this.createInitialState();
    this.source = null;
    this.projectContext = null;
  }

  // ─── Source / Project Context ─────────────────────────────────────────────

  setSource(source: SourceInput): void {
    this.source = source;
  }

  getSource(): SourceInput | null {
    // Prefer active file from project context if available
    return this.projectContext?.activeFile ?? this.source;
  }

  setProjectContext(ctx: ProjectContext): void {
    this.projectContext = ctx;
    this.source = ctx.activeFile; // backward compat
  }

  getProjectContext(): ProjectContext | null {
    return this.projectContext;
  }

  // ─── Workflow Status ───────────────────────────────────────────────────────

  getStatus(): WorkflowStatus {
    return this.state.status;
  }

  setStatus(status: WorkflowStatus): void {
    this.state.status = status;
  }

  setCurrentStep(step: number): void {
    this.state.current_step = step;
  }

  getCurrentStep(): number {
    return this.state.current_step;
  }

  // ─── Task States ──────────────────────────────────────────────────────────

  initTaskState(taskId: string): void {
    this.state.task_states.set(taskId, { status: 'idle', retry_count: 0 });
  }

  setTaskStatus(taskId: string, status: TaskStatus): void {
    const ts = this.state.task_states.get(taskId) ?? { status: 'idle', retry_count: 0 };
    ts.status = status;
    this.state.task_states.set(taskId, ts);
  }

  updateTaskState(taskId: string, update: Partial<TaskState>): void {
    const ts = this.state.task_states.get(taskId) ?? { status: 'idle', retry_count: 0 };
    Object.assign(ts, update);
    this.state.task_states.set(taskId, ts);
  }

  getTaskState(taskId: string): TaskState | undefined {
    return this.state.task_states.get(taskId);
  }

  getAllTaskStates(): Map<string, TaskState> {
    return this.state.task_states;
  }

  setValidationResult(taskId: string, result: ValidationResult): void {
    const ts = this.state.task_states.get(taskId) ?? { status: 'idle', retry_count: 0 };
    ts.validation_result = result;
    this.state.task_states.set(taskId, ts);
  }

  incrementRetry(taskId: string): void {
    const ts = this.state.task_states.get(taskId) ?? { status: 'idle', retry_count: 0 };
    ts.retry_count = (ts.retry_count ?? 0) + 1;
    this.state.task_states.set(taskId, ts);
  }

  setTaskError(taskId: string, message: string): void {
    this.updateTaskState(taskId, { status: 'error', error_message: message });
  }

  // ─── Output Store ─────────────────────────────────────────────────────────

  setOutput(outputKey: string, content: string): void {
    this.state.output_store.set(outputKey, content);
  }

  getOutput(outputKey: string): string | undefined {
    return this.state.output_store.get(outputKey);
  }

  getAllOutputs(): Map<string, string> {
    return this.state.output_store;
  }

  // ─── Handover Notes ───────────────────────────────────────────────────────

  addHandoverNote(note: HandoverNote): void {
    this.state.handover_notes.push(note);
  }

  getHandoverNotes(): HandoverNote[] {
    return this.state.handover_notes;
  }

  getLatestHandoverNoteFor(agentId: string): HandoverNote | undefined {
    return [...this.state.handover_notes]
      .reverse()
      .find((n) => n.from_agent_id === agentId);
  }

  // ─── Loop Controller ──────────────────────────────────────────────────────

  getLoopCount(step: number): number {
    return this.state.loop_counts.get(step) ?? 0;
  }

  incrementLoopCount(step: number): number {
    const count = (this.state.loop_counts.get(step) ?? 0) + 1;
    this.state.loop_counts.set(step, count);
    return count;
  }

  resetLoopCount(step: number): void {
    this.state.loop_counts.set(step, 0);
  }

  // ─── Cost Tracking ────────────────────────────────────────────────────────

  addTokenUsage(inputTokens: number, outputTokens: number, costUsd: number): void {
    this.state.total_input_tokens += inputTokens;
    this.state.total_output_tokens += outputTokens;
    this.state.total_cost_usd += costUsd;
  }

  getTotalCost(): number {
    return this.state.total_cost_usd;
  }

  getTotalTokens(): { input: number; output: number } {
    return {
      input: this.state.total_input_tokens,
      output: this.state.total_output_tokens,
    };
  }

  // ─── Execution Log ────────────────────────────────────────────────────────

  /** Maximum number of log entries kept in memory to prevent unbounded growth. */
  private static readonly MAX_LOG_ENTRIES = 2000;

  log(step: number, taskId: string, event: ExecutionLogEvent, details?: string): void {
    const entry: ExecutionLogEntry = {
      timestamp: new Date().toISOString(),
      step,
      task_id: taskId,
      event,
      details,
    };
    this.state.execution_log.push(entry);
    if (this.state.execution_log.length > StateManager.MAX_LOG_ENTRIES) {
      this.state.execution_log.splice(0, this.state.execution_log.length - StateManager.MAX_LOG_ENTRIES);
    }
  }

  getLog(): ExecutionLogEntry[] {
    return this.state.execution_log;
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  serialize(): SerializedExecutionState {
    const loopCounts: Record<string, number> = {};
    this.state.loop_counts.forEach((v, k) => {
      loopCounts[String(k)] = v;
    });

    const taskStates: Record<string, TaskState> = {};
    this.state.task_states.forEach((v, k) => {
      taskStates[k] = v;
    });

    const outputStore: Record<string, string> = {};
    this.state.output_store.forEach((v, k) => {
      outputStore[k] = v;
    });

    return {
      workflow_id: this.state.workflow_id,
      status: this.state.status,
      current_step: this.state.current_step,
      loop_counts: loopCounts,
      task_states: taskStates,
      output_store: outputStore,
      handover_notes: this.state.handover_notes,
      execution_log: this.state.execution_log,
      total_input_tokens: this.state.total_input_tokens,
      total_output_tokens: this.state.total_output_tokens,
      total_cost_usd: this.state.total_cost_usd,
    };
  }

  /**
   * Restore execution state from a previously serialized snapshot.
   * Used for state persistence across VS Code reloads.
   */
  deserialize(data: SerializedExecutionState): void {
    const loopCounts = new Map<number, number>();
    for (const [k, v] of Object.entries(data.loop_counts)) {
      loopCounts.set(Number(k), v);
    }
    const taskStates = new Map<string, TaskState>();
    for (const [k, v] of Object.entries(data.task_states)) {
      taskStates.set(k, v);
    }
    const outputStore = new Map<string, string>();
    for (const [k, v] of Object.entries(data.output_store)) {
      outputStore.set(k, v);
    }
    this.state = {
      workflow_id: data.workflow_id,
      status: data.status,
      current_step: data.current_step,
      loop_counts: loopCounts,
      task_states: taskStates,
      output_store: outputStore,
      handover_notes: data.handover_notes,
      execution_log: data.execution_log,
      total_input_tokens: data.total_input_tokens,
      total_output_tokens: data.total_output_tokens,
      total_cost_usd: data.total_cost_usd,
    };
  }
}
