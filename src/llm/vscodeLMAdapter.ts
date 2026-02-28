import { LLMGateway, LLMRequest, LLMResponse, ConversationMessage, ToolCall } from '../types/index.js';
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

    // Build messages
    const messages = this.buildMessages(request);

    // Send request
    const responseStream = await model.sendRequest(
      messages,
      {},
      new this.vscode.CancellationTokenSource().token
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

    return {
      content: fullContent,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model: `vscode:${this.modelId}`,
      duration_ms: Date.now() - start,
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
  CancellationTokenSource: new () => { token: unknown };
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
