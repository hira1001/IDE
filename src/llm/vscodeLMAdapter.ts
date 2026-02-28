import { LLMGateway, LLMRequest, LLMResponse, ConversationMessage, ToolCall, ToolDefinition } from '../types/index.js';
import { estimateTokens } from './tokenCounter.js';

/**
 * VS Code Language Model API adapter.
 *
 * Allows using models provided by VS Code extensions (GitHub Copilot, Cursor's
 * built-in AI, Google Cloud Code, etc.) without requiring separate API keys.
 * Model IDs use the "vscode:" prefix, e.g. "vscode:copilot-gpt-4".
 *
 * The VS Code LM API is only available in the Extension Host context.
 * This adapter receives the vscode module as a constructor parameter so that
 * it can be injected/mocked in tests.
 */
export class VscodeLMAdapter implements LLMGateway {
  private aborted = false;
  private currentRequest: { cancel(): void } | null = null;

  constructor(
    private readonly modelId: string,  // without "vscode:" prefix
    private readonly vscode: VscodeLMApi
  ) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.aborted = false;
    const start = Date.now();

    // Select the model
    const [model] = await this.vscode.lm.selectChatModels({ id: this.modelId });
    if (!model) {
      throw new Error(`VS Code LM model not found: ${this.modelId}`);
    }

    const hasTools = request.tools && request.tools.length > 0;

    // Build messages - inject tool definitions via prompt embedding if tools are present
    const messages = hasTools
      ? this.buildMessagesWithTools(request)
      : this.buildMessages(request);

    // Send request — store the token source so abort() can cancel it
    const tokenSource = new this.vscode.CancellationTokenSource();
    this.currentRequest = tokenSource;
    const responseStream = await model.sendRequest(
      messages,
      {},
      tokenSource.token
    );

    if (this.aborted) throw new Error('Aborted');

    let fullContent = '';
    for await (const fragment of responseStream.text) {
      if (this.aborted) break;
      fullContent += fragment;
      request.onChunk?.(fragment);
    }

    const inputTokens = estimateTokens(
      messages.map((m) => ('content' in m ? String(m.content) : '')).join(' ')
    );
    const outputTokens = estimateTokens(fullContent);

    // Parse tool calls from text when using prompt-embedding mode
    const toolCalls = hasTools ? parseToolCallsFromText(fullContent) : undefined;
    const content = toolCalls && toolCalls.length > 0
      ? fullContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim()
      : fullContent;

    return {
      content,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model: `vscode:${this.modelId}`,
      duration_ms: Date.now() - start,
      tool_calls: toolCalls,
    };
  }

  private buildMessages(request: LLMRequest): VscodeChatMessage[] {
    if (request.conversation) {
      return conversationToVscode(request.conversation, this.vscode);
    }
    return [
      this.vscode.LanguageModelChatMessage.User(request.user_prompt),
    ];
  }

  private buildMessagesWithTools(request: LLMRequest): VscodeChatMessage[] {
    const toolInstructions = buildToolSystemPrompt(request.tools!);
    if (request.conversation) {
      return conversationToVscodeWithTools(request.conversation, toolInstructions, this.vscode);
    }
    const combined = [
      request.system_prompt ? `${request.system_prompt}\n\n` : '',
      toolInstructions,
      '\n\n---\n\n',
      request.user_prompt,
    ].join('');
    return [this.vscode.LanguageModelChatMessage.User(combined)];
  }

  abort(): void {
    this.aborted = true;
    this.currentRequest?.cancel();
  }

  estimateTokens(text: string): number {
    return estimateTokens(text);
  }
}

/**
 * List all VS Code LM models available in the current IDE session.
 * Returns model IDs with the "vscode:" prefix (e.g. "vscode:copilot-gpt-4").
 */
export async function listVscodeLMModels(vscode: VscodeLMApi): Promise<string[]> {
  try {
    const models = await vscode.lm.selectChatModels({});
    return models.map((m) => `vscode:${m.id}`);
  } catch {
    return [];
  }
}

// ─── VS Code API surface (minimal) ───────────────────────────────────────────

export interface VscodeLMApi {
  lm: {
    selectChatModels(selector?: { id?: string; vendor?: string }): Promise<VscodeLMModel[]>;
  };
  LanguageModelChatMessage: {
    User(content: string): VscodeChatMessage;
    Assistant(content: string): VscodeChatMessage;
  };
  CancellationTokenSource: new () => { token: unknown; cancel(): void };
}

export interface VscodeLMModel {
  id: string;
  name: string;
  sendRequest(
    messages: VscodeChatMessage[],
    options: Record<string, unknown>,
    token: unknown
  ): Promise<{ text: AsyncIterable<string> }>;
}

export type VscodeChatMessage = { role: string; content: string };

// ─── helpers ──────────────────────────────────────────────────────────────────

function conversationToVscode(
  messages: ConversationMessage[],
  vscode: VscodeLMApi
): VscodeChatMessage[] {
  return messages
    .filter((m) => m.role !== 'system' && m.role !== 'tool')
    .map((m) => {
      if (m.role === 'assistant') {
        return vscode.LanguageModelChatMessage.Assistant(m.content);
      }
      return vscode.LanguageModelChatMessage.User(m.content);
    });
}

/**
 * Convert a multi-turn conversation (with possible tool calls/results) to VS Code
 * chat messages, injecting tool instructions into the first system/user turn.
 */
function conversationToVscodeWithTools(
  messages: ConversationMessage[],
  toolInstructions: string,
  vscode: VscodeLMApi
): VscodeChatMessage[] {
  const result: VscodeChatMessage[] = [];
  let toolInjected = false;

  for (const m of messages) {
    if (m.role === 'system') {
      // Convert system to User and inject tool instructions
      result.push(vscode.LanguageModelChatMessage.User(`${m.content}\n\n${toolInstructions}`));
      toolInjected = true;
    } else if (m.role === 'assistant') {
      let content = m.content;
      if (m.tool_calls && m.tool_calls.length > 0) {
        content += '\n' + m.tool_calls
          .map((tc) => `<tool_call>\n${JSON.stringify({ name: tc.name, arguments: tc.arguments }, null, 2)}\n</tool_call>`)
          .join('\n');
      }
      result.push(vscode.LanguageModelChatMessage.Assistant(content));
    } else if (m.role === 'tool') {
      result.push(vscode.LanguageModelChatMessage.User(`[Tool result for "${m.tool_call_id}"]\n${m.content}`));
    } else if (m.role === 'user') {
      if (!toolInjected) {
        result.push(vscode.LanguageModelChatMessage.User(`${toolInstructions}\n\n---\n\n${m.content}`));
        toolInjected = true;
      } else {
        result.push(vscode.LanguageModelChatMessage.User(m.content));
      }
    }
  }

  return result;
}

/**
 * Build a system-prompt section that describes available tools and the
 * <tool_call> response format (prompt-embedding approach for models that
 * don't support native function calling via the VS Code LM API).
 */
function buildToolSystemPrompt(tools: ToolDefinition[]): string {
  const toolXml = tools.map((t) => [
    `<tool>`,
    `  <name>${t.name}</name>`,
    `  <description>${t.description}</description>`,
    `  <parameters>${JSON.stringify(t.parameters)}</parameters>`,
    `</tool>`,
  ].join('\n')).join('\n');

  return [
    'You have access to the following tools. To use a tool, include a <tool_call> block in your response:',
    '<tool_call>',
    '{"name": "tool_name", "arguments": {"param": "value"}}',
    '</tool_call>',
    'Call one tool per response. When you have gathered enough information, answer without any <tool_call> block.',
    '<tools>',
    toolXml,
    '</tools>',
  ].join('\n');
}

/**
 * Extract tool calls embedded as <tool_call>...</tool_call> blocks in response text.
 */
function parseToolCallsFromText(text: string): ToolCall[] | undefined {
  const matches = [...text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)];
  if (matches.length === 0) return undefined;

  const toolCalls: ToolCall[] = [];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim()) as { name: string; arguments?: Record<string, unknown> };
      toolCalls.push({
        id: `vscode_tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: parsed.name,
        arguments: parsed.arguments ?? {},
      });
    } catch {
      console.warn(`[VscodeLMAdapter] Skipped malformed <tool_call> block: ${match[1].slice(0, 100)}`);
    }
  }
  return toolCalls.length > 0 ? toolCalls : undefined;
}
