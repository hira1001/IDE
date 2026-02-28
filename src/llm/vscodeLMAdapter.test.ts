import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VscodeLMAdapter, listVscodeLMModels, VscodeLMApi } from './vscodeLMAdapter.js';
import { LLMRequest } from '../types/index.js';

// ─── Minimal VS Code LM API mock ─────────────────────────────────────────────

function makeVscodeMock(overrides: Partial<{
  sendRequest: (messages: unknown[], opts: unknown, token: unknown) => Promise<{ text: AsyncIterable<string> }>;
  selectModels: (selector?: unknown) => Promise<{ id: string; name: string; sendRequest: unknown }[]>;
}> = {}): VscodeLMApi {
  const mockCancelFn = vi.fn();
  const mockSendRequest = overrides.sendRequest ?? (async () => ({
    text: (async function* () { yield 'Hello'; yield ' world'; })(),
  }));

  const model = {
    id: 'copilot-gpt-4',
    name: 'GPT-4 (Copilot)',
    sendRequest: mockSendRequest,
  };

  return {
    lm: {
      selectChatModels: (overrides.selectModels ?? vi.fn().mockResolvedValue([model])) as VscodeLMApi['lm']['selectChatModels'],
    },
    LanguageModelChatMessage: {
      User: (content: string) => ({ role: 'user', content }),
      Assistant: (content: string) => ({ role: 'assistant', content }),
    },
    CancellationTokenSource: vi.fn().mockImplementation(() => ({
      token: {},
      cancel: mockCancelFn,
    })),
  };
}

const baseRequest: LLMRequest = {
  model: 'vscode:copilot-gpt-4',
  system_prompt: 'You are a helpful assistant.',
  user_prompt: 'Say hello.',
};

// ─── VscodeLMAdapter — basic chat ────────────────────────────────────────────

describe('VscodeLMAdapter', () => {
  describe('chat() — basic text response', () => {
    it('returns concatenated streaming text', async () => {
      const adapter = new VscodeLMAdapter('copilot-gpt-4', makeVscodeMock());
      const resp = await adapter.chat(baseRequest);
      expect(resp.content).toBe('Hello world');
      expect(resp.model).toBe('vscode:copilot-gpt-4');
      expect(resp.input_tokens).toBeGreaterThan(0);
      expect(resp.output_tokens).toBeGreaterThan(0);
      expect(resp.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('calls onChunk for each streamed fragment', async () => {
      const chunks: string[] = [];
      const adapter = new VscodeLMAdapter('copilot-gpt-4', makeVscodeMock());
      await adapter.chat({ ...baseRequest, onChunk: (c) => chunks.push(c) });
      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('throws when model is not found', async () => {
      const vscodeMock = makeVscodeMock({ selectModels: vi.fn().mockResolvedValue([]) });
      const adapter = new VscodeLMAdapter('nonexistent', vscodeMock);
      await expect(adapter.chat(baseRequest)).rejects.toThrow('VS Code LM model not found: nonexistent');
    });

    it('calls CancellationTokenSource.cancel() when abort is called during streaming', async () => {
      const cancelFn = vi.fn();
      let unpauseStream!: () => void;
      // Resolves once the generator has paused and set unpauseStream
      let signalPaused!: () => void;
      const pausedPromise = new Promise<void>((resolve) => { signalPaused = resolve; });

      const vscodeMock = makeVscodeMock({
        sendRequest: async () => ({
          text: (async function* () {
            yield 'chunk1';
            // Pause here so the test can call abort() after tokenSource is stored
            await new Promise<void>((resolve) => {
              unpauseStream = resolve;
              signalPaused();  // notify the test that unpauseStream is now set
            });
            yield 'chunk2';
          })(),
        }),
      });
      (vscodeMock.CancellationTokenSource as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        token: {},
        cancel: cancelFn,
      }));

      const adapter = new VscodeLMAdapter('copilot-gpt-4', vscodeMock);
      const chatPromise = adapter.chat(baseRequest);

      // Wait until the generator has reached its pause point and set unpauseStream
      await pausedPromise;

      adapter.abort();  // tokenSource is stored by now → cancel() is called
      unpauseStream();  // unblock generator so chat() can finish

      await chatPromise;  // resolves (aborted flag stops the for-await loop early)
      expect(cancelFn).toHaveBeenCalled();
    });
  });

  // ─── Tool calling via prompt-embedding ─────────────────────────────────────

  describe('chat() — tool calling (prompt-embedding mode)', () => {
    const toolsRequest: LLMRequest = {
      ...baseRequest,
      tools: [{
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'File path' } },
          required: ['path'],
        },
      }],
    };

    it('returns tool_calls when response contains <tool_call> block', async () => {
      const responseText = 'I need to read a file.\n<tool_call>\n{"name":"read_file","arguments":{"path":"src/index.ts"}}\n</tool_call>';
      const vscodeMock = makeVscodeMock({
        sendRequest: async () => ({ text: (async function* () { yield responseText; })() }),
      });

      const adapter = new VscodeLMAdapter('copilot-gpt-4', vscodeMock);
      const resp = await adapter.chat(toolsRequest);

      expect(resp.tool_calls).toHaveLength(1);
      expect(resp.tool_calls![0].name).toBe('read_file');
      expect(resp.tool_calls![0].arguments).toEqual({ path: 'src/index.ts' });
      expect(resp.tool_calls![0].id).toMatch(/^vscode_tc_/);
    });

    it('strips <tool_call> blocks from content', async () => {
      const responseText = 'Thinking...\n<tool_call>\n{"name":"read_file","arguments":{"path":"x.ts"}}\n</tool_call>';
      const vscodeMock = makeVscodeMock({
        sendRequest: async () => ({ text: (async function* () { yield responseText; })() }),
      });

      const adapter = new VscodeLMAdapter('copilot-gpt-4', vscodeMock);
      const resp = await adapter.chat(toolsRequest);

      expect(resp.content).toBe('Thinking...');
      expect(resp.content).not.toContain('<tool_call>');
    });

    it('returns undefined tool_calls when response has no <tool_call>', async () => {
      const vscodeMock = makeVscodeMock({
        sendRequest: async () => ({ text: (async function* () { yield 'Final answer: all done.'; })() }),
      });

      const adapter = new VscodeLMAdapter('copilot-gpt-4', vscodeMock);
      const resp = await adapter.chat(toolsRequest);

      expect(resp.tool_calls).toBeUndefined();
      expect(resp.content).toBe('Final answer: all done.');
    });

    it('skips malformed <tool_call> blocks and logs a warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const responseText = '<tool_call>not valid json at all!!!</tool_call>';
      const vscodeMock = makeVscodeMock({
        sendRequest: async () => ({ text: (async function* () { yield responseText; })() }),
      });

      const adapter = new VscodeLMAdapter('copilot-gpt-4', vscodeMock);
      const resp = await adapter.chat(toolsRequest);

      expect(resp.tool_calls).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[VscodeLMAdapter]'));
      warnSpy.mockRestore();
    });

    it('parses multiple <tool_call> blocks in one response', async () => {
      const responseText = [
        '<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>',
        '<tool_call>{"name":"read_file","arguments":{"path":"b.ts"}}</tool_call>',
      ].join('\n');
      const vscodeMock = makeVscodeMock({
        sendRequest: async () => ({ text: (async function* () { yield responseText; })() }),
      });

      const adapter = new VscodeLMAdapter('copilot-gpt-4', vscodeMock);
      const resp = await adapter.chat(toolsRequest);

      expect(resp.tool_calls).toHaveLength(2);
      expect(resp.tool_calls![0].arguments).toEqual({ path: 'a.ts' });
      expect(resp.tool_calls![1].arguments).toEqual({ path: 'b.ts' });
    });

    it('injects tool definitions into system prompt when conversation is absent', async () => {
      let capturedMessages: unknown[] = [];
      const vscodeMock = makeVscodeMock({
        sendRequest: async (messages) => {
          capturedMessages = messages as unknown[];
          return { text: (async function* () { yield 'ok'; })() };
        },
      });

      const adapter = new VscodeLMAdapter('copilot-gpt-4', vscodeMock);
      await adapter.chat(toolsRequest);

      const firstMsg = capturedMessages[0] as { role: string; content: string };
      expect(firstMsg.role).toBe('user');
      expect(firstMsg.content).toContain('<tools>');
      expect(firstMsg.content).toContain('read_file');
    });

    it('converts system message to User and injects tools when conversation is provided', async () => {
      let capturedMessages: unknown[] = [];
      const vscodeMock = makeVscodeMock({
        sendRequest: async (messages) => {
          capturedMessages = messages as unknown[];
          return { text: (async function* () { yield 'ok'; })() };
        },
      });

      const adapter = new VscodeLMAdapter('copilot-gpt-4', vscodeMock);
      await adapter.chat({
        ...toolsRequest,
        conversation: [
          { role: 'system', content: 'You are an expert.' },
          { role: 'user', content: 'Fix the bug.' },
        ],
      });

      // System message should become a User message with tool instructions injected
      const firstMsg = capturedMessages[0] as { role: string; content: string };
      expect(firstMsg.role).toBe('user');
      expect(firstMsg.content).toContain('You are an expert.');
      expect(firstMsg.content).toContain('<tools>');
    });

    it('formats tool result messages as User messages', async () => {
      let capturedMessages: unknown[] = [];
      const vscodeMock = makeVscodeMock({
        sendRequest: async (messages) => {
          capturedMessages = messages as unknown[];
          return { text: (async function* () { yield 'ok'; })() };
        },
      });

      const adapter = new VscodeLMAdapter('copilot-gpt-4', vscodeMock);
      await adapter.chat({
        ...toolsRequest,
        conversation: [
          { role: 'system', content: 'sys' },
          { role: 'assistant', content: '', tool_calls: [{ id: 'tc_1', name: 'read_file', arguments: { path: 'x.ts' } }] },
          { role: 'tool', tool_call_id: 'tc_1', content: 'file contents here' },
        ],
      });

      const toolResultMsg = capturedMessages.find(
        (m) => (m as { content: string }).content?.includes('file contents here')
      ) as { role: string; content: string };
      expect(toolResultMsg.role).toBe('user');
      expect(toolResultMsg.content).toContain('[Tool result for "tc_1"]');
    });
  });

  // ─── abort() ─────────────────────────────────────────────────────────────────

  describe('abort()', () => {
    it('sets aborted flag — streaming stops mid-response', async () => {
      const chunks: string[] = [];
      let requestAborted = false;

      const vscodeMock = makeVscodeMock({
        sendRequest: async () => ({
          text: (async function* () {
            yield 'chunk1';
            // Simulate delay where abort() is called
            await new Promise((r) => setTimeout(r, 1));
            yield 'chunk2';
          })(),
        }),
      });
      (vscodeMock.CancellationTokenSource as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        token: {},
        cancel: () => { requestAborted = true; },
      }));

      const adapter = new VscodeLMAdapter('copilot-gpt-4', vscodeMock);
      const req = { ...baseRequest, onChunk: (c: string) => { chunks.push(c); adapter.abort(); } };
      await adapter.chat(req);

      expect(requestAborted).toBe(true);
      expect(chunks).toHaveLength(1); // Stopped after first chunk
    });
  });

  // ─── estimateTokens ──────────────────────────────────────────────────────────

  describe('estimateTokens()', () => {
    it('returns a positive number for non-empty text', () => {
      const adapter = new VscodeLMAdapter('copilot-gpt-4', makeVscodeMock());
      expect(adapter.estimateTokens('Hello world')).toBeGreaterThan(0);
    });

    it('returns 0 for empty string', () => {
      const adapter = new VscodeLMAdapter('copilot-gpt-4', makeVscodeMock());
      expect(adapter.estimateTokens('')).toBe(0);
    });
  });
});

// ─── listVscodeLMModels ───────────────────────────────────────────────────────

describe('listVscodeLMModels()', () => {
  it('returns model IDs with vscode: prefix', async () => {
    const vscodeMock = makeVscodeMock({
      selectModels: vi.fn().mockResolvedValue([
        { id: 'copilot-gpt-4', name: 'GPT-4' },
        { id: 'copilot-gpt-3.5', name: 'GPT-3.5' },
      ]),
    });
    const models = await listVscodeLMModels(vscodeMock);
    expect(models).toEqual(['vscode:copilot-gpt-4', 'vscode:copilot-gpt-3.5']);
  });

  it('returns empty array when API throws', async () => {
    const vscodeMock = makeVscodeMock({
      selectModels: vi.fn().mockRejectedValue(new Error('LM API unavailable')),
    });
    const models = await listVscodeLMModels(vscodeMock);
    expect(models).toEqual([]);
  });

  it('returns empty array when no models available', async () => {
    const vscodeMock = makeVscodeMock({
      selectModels: vi.fn().mockResolvedValue([]),
    });
    const models = await listVscodeLMModels(vscodeMock);
    expect(models).toEqual([]);
  });
});
