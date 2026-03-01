import {
  LLMGateway,
  LLMRequest,
  LLMResponse,
  ToolDefinition,
  ToolCall,
  ConversationMessage,
  AgentLoopEvent,
} from '../types/index.js';
import { ToolExecutor } from '../tools/toolExecutor.js';
import { FileChangeTracker } from '../tools/fileChangeTracker.js';

const DEFAULT_MAX_ITERATIONS = 25;

export interface AgentLoopResult {
  /** Final text output from the LLM (after all tool calls complete). */
  finalText: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterations: number;
  filesChanged: string[];
}

export interface AgentLoopOptions {
  maxIterations?: number;
  /** Apply file edits immediately at the end of the loop (true) or emit for diff review (false). */
  autoApplyEdits?: boolean;
  /** Called to notify orchestrator/UI about tool call progress. */
  onEvent?: (event: AgentLoopEvent, taskId: string) => void;
  /** AbortSignal to cancel the loop mid-execution. */
  abortSignal?: AbortSignal;
}

/**
 * AgentLoopEngine — runs the ReAct (Reason → Act → Observe) loop.
 *
 * Each iteration:
 *  1. Calls the LLM with the current conversation + available tools.
 *  2. If the LLM responds with tool_calls, executes each tool via ToolExecutor,
 *     appends results to the conversation, and loops.
 *  3. If the LLM responds with plain text (no tool_calls), the loop ends and
 *     the text is the final output.
 *  4. After the loop, if auto_apply_edits, commits staged file changes to disk.
 */
export class AgentLoopEngine {
  private readonly maxIterations: number;
  private readonly autoApplyEdits: boolean;
  private readonly onEvent?: (event: AgentLoopEvent, taskId: string) => void;
  private readonly abortSignal?: AbortSignal;

  constructor(
    private readonly gateway: LLMGateway,
    private readonly executor: ToolExecutor,
    private readonly tracker: FileChangeTracker,
    private readonly taskId: string,
    options: AgentLoopOptions = {}
  ) {
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.autoApplyEdits = options.autoApplyEdits ?? true;
    this.onEvent = options.onEvent;
    this.abortSignal = options.abortSignal;
  }

  async run(
    systemPrompt: string,
    userPrompt: string,
    model: string,
    tools: ToolDefinition[]
  ): Promise<AgentLoopResult> {
    const conversation: ConversationMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iteration = 0;
    let lastAssistantText = '';

    while (iteration < this.maxIterations) {
      this.checkAbort();
      iteration++;

      this.emit({ type: 'iteration', taskId: this.taskId, iteration });

      const request: LLMRequest = {
        model,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        tools,
        conversation,
      };

      const response = await this.gateway.chat(request);
      totalInputTokens += response.input_tokens;
      totalOutputTokens += response.output_tokens;

      if (!response.tool_calls || response.tool_calls.length === 0) {
        // LLM returned final text — loop complete
        lastAssistantText = response.content ?? '';
        if (response.content) {
          conversation.push({ role: 'assistant', content: response.content });
        }
        break;
      }

      // Track any assistant content included before tool calls (thinking/preamble)
      if (response.content) {
        lastAssistantText = response.content;
      }

      // LLM requested tool calls — execute each one
      const assistantMsg: ConversationMessage = {
        role: 'assistant',
        content: response.content ?? '',
        tool_calls: response.tool_calls,
      };
      conversation.push(assistantMsg);

      for (const toolCall of response.tool_calls) {
        this.checkAbort();

        this.emit({
          type: 'tool_call',
          taskId: this.taskId,
          toolName: toolCall.name,
          content: JSON.stringify(toolCall.arguments).slice(0, 200),
        });

        const result = await this.executor.execute(toolCall);

        this.emit({
          type: 'tool_result',
          taskId: this.taskId,
          toolName: toolCall.name,
          content: result.slice(0, 200),
        });

        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          tool_name: toolCall.name,
          content: result,
        });
      }
    }

    // Extract the final text response.
    // If max iterations were hit while still in tool-call state (last msg is a 'tool' result),
    // fall back to the last assistant text seen during the loop.
    const lastMsg = conversation[conversation.length - 1];
    const finalText = (lastMsg?.role === 'assistant' ? lastMsg.content : '') || lastAssistantText;

    // Commit file changes
    if (this.autoApplyEdits && this.tracker.hasChanges()) {
      await this.executor.commitChanges();
    }

    const filesChanged = this.tracker.getChanges().map((c) => c.path);

    return {
      finalText,
      totalInputTokens,
      totalOutputTokens,
      iterations: iteration,
      filesChanged,
    };
  }

  private emit(event: AgentLoopEvent): void {
    this.onEvent?.(event, this.taskId);
  }

  private checkAbort(): void {
    if (this.abortSignal?.aborted) {
      const err = new Error('Agent loop aborted');
      err.name = 'AbortError';
      throw err;
    }
  }
}
