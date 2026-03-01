import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoopEngine } from './reactLoop.js';
import { ToolExecutor } from '../tools/toolExecutor.js';
import { FileChangeTracker } from '../tools/fileChangeTracker.js';
import { LLMGateway, LLMRequest, LLMResponse, AgentLoopEvent } from '../types/index.js';
import { ALL_TOOLS } from '../tools/toolDefinitions.js';

// ─── mock gateway ─────────────────────────────────────────────────────────────

function makeGateway(responses: Partial<LLMResponse>[]): LLMGateway {
  let call = 0;
  return {
    chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => {
      const r = responses[call] ?? responses[responses.length - 1];
      call++;
      return {
        content: r.content ?? '',
        input_tokens: r.input_tokens ?? 5,
        output_tokens: r.output_tokens ?? 5,
        model: 'mock-model',
        duration_ms: 1,
        tool_calls: r.tool_calls,
      };
    }),
    abort: vi.fn(),
    estimateTokens: (t) => Math.ceil(t.length / 4),
  };
}

// ─── mock executor ────────────────────────────────────────────────────────────

function makeExecutor(toolResults: Record<string, string> = {}): ToolExecutor {
  const tracker = new FileChangeTracker();
  const exec = new ToolExecutor({
    workspaceRoot: '/tmp',
    tracker,
    autonomyMode: 'auto',
    confirmTerminal: async () => true,
  });
  // Override execute to use provided results
  exec.execute = vi.fn(async (call) => {
    return toolResults[call.name] ?? `result of ${call.name}`;
  });
  return exec;
}

describe('AgentLoopEngine', () => {
  let tracker: FileChangeTracker;

  beforeEach(() => {
    tracker = new FileChangeTracker();
  });

  it('returns finalText when LLM responds with no tool_calls', async () => {
    const gateway = makeGateway([{ content: 'All done!' }]);
    const executor = makeExecutor();
    const loop = new AgentLoopEngine(gateway, executor, tracker, 'task-1');

    const result = await loop.run('sys', 'do task', 'mock', ALL_TOOLS);

    expect(result.finalText).toBe('All done!');
    expect(result.iterations).toBe(1);
  });

  it('executes tool calls and loops until final text', async () => {
    const gateway = makeGateway([
      // First response: request a tool call
      {
        content: '',
        tool_calls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }],
      },
      // Second response: final text
      { content: 'Task complete after reading file.' },
    ]);
    const executor = makeExecutor({ read_file: 'contents of a.ts' });
    const loop = new AgentLoopEngine(gateway, executor, tracker, 'task-1');

    const result = await loop.run('sys', 'do task', 'mock', ALL_TOOLS);

    expect(result.finalText).toBe('Task complete after reading file.');
    expect(result.iterations).toBe(2);
    expect(gateway.chat).toHaveBeenCalledTimes(2);
    // Second LLM call should include the tool result in conversation
    const secondCall = (gateway.chat as ReturnType<typeof vi.fn>).mock.calls[1][0] as LLMRequest;
    const toolResultMsg = secondCall.conversation?.find((m) => m.role === 'tool');
    expect(toolResultMsg?.content).toBe('contents of a.ts');
  });

  it('handles multiple tool calls in a single iteration', async () => {
    const gateway = makeGateway([
      {
        content: '',
        tool_calls: [
          { id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } },
          { id: 'tc2', name: 'read_file', arguments: { path: 'b.ts' } },
        ],
      },
      { content: 'Done with both files.' },
    ]);
    const executor = makeExecutor({ read_file: 'file content' });
    const loop = new AgentLoopEngine(gateway, executor, tracker, 'task-1');

    const result = await loop.run('sys', 'read files', 'mock', ALL_TOOLS);

    expect(result.finalText).toBe('Done with both files.');
    // Both tool calls should be in the second LLM request's conversation
    const secondCall = (gateway.chat as ReturnType<typeof vi.fn>).mock.calls[1][0] as LLMRequest;
    const toolResults = secondCall.conversation?.filter((m) => m.role === 'tool') ?? [];
    expect(toolResults).toHaveLength(2);
  });

  it('stops after maxIterations even if LLM keeps requesting tools', async () => {
    // Always return a tool call
    const gateway = makeGateway([
      { content: '', tool_calls: [{ id: 'tc', name: 'read_file', arguments: { path: 'x.ts' } }] },
    ]);
    const executor = makeExecutor();
    const loop = new AgentLoopEngine(gateway, executor, tracker, 'task-1', {
      maxIterations: 3,
    });

    const result = await loop.run('sys', 'loop forever', 'mock', ALL_TOOLS);

    expect(result.iterations).toBe(3);
    expect(gateway.chat).toHaveBeenCalledTimes(3);
  });

  it('falls back to last assistant preamble text when max iterations hit mid-tool-call', async () => {
    // First response: assistant has thinking text + tool call
    // Second and beyond: still requesting tool calls (no content preamble)
    const gateway = makeGateway([
      { content: 'I will read the files to understand the codebase.', tool_calls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }] },
      { content: '', tool_calls: [{ id: 'tc2', name: 'read_file', arguments: { path: 'b.ts' } }] },
    ]);
    const executor = makeExecutor();
    const loop = new AgentLoopEngine(gateway, executor, tracker, 'task-1', {
      maxIterations: 3,
    });

    const result = await loop.run('sys', 'analyze files', 'mock', ALL_TOOLS);

    expect(result.iterations).toBe(3);
    // finalText should fall back to the last non-empty assistant content seen
    expect(result.finalText).toBe('I will read the files to understand the codebase.');
  });

  it('emits tool_call and tool_result events', async () => {
    const gateway = makeGateway([
      { content: '', tool_calls: [{ id: 'tc1', name: 'search_code', arguments: { pattern: 'TODO' } }] },
      { content: 'Found TODOs.' },
    ]);
    const executor = makeExecutor({ search_code: '3 matches: ...' });
    const events: AgentLoopEvent[] = [];
    const loop = new AgentLoopEngine(gateway, executor, tracker, 'task-1', {
      onEvent: (e) => events.push(e),
    });

    await loop.run('sys', 'find todos', 'mock', ALL_TOOLS);

    const toolCallEvent = events.find((e) => e.type === 'tool_call');
    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolCallEvent?.toolName).toBe('search_code');
    expect(toolResultEvent?.toolName).toBe('search_code');
    expect(toolResultEvent?.content).toContain('3 matches');
  });

  it('aborts when abortSignal is triggered before loop starts', async () => {
    const controller = new AbortController();
    const gateway = makeGateway([
      { content: '', tool_calls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'x.ts' } }] },
    ]);
    const executor = makeExecutor();
    // Abort before the loop runs
    controller.abort();

    const loop = new AgentLoopEngine(gateway, executor, tracker, 'task-1', {
      abortSignal: controller.signal,
    });

    await expect(loop.run('sys', 'task', 'mock', ALL_TOOLS)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts mid-loop when signal fires between tool calls', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const gateway: LLMGateway = {
      chat: vi.fn(async () => {
        callCount++;
        // Abort after first LLM call completes
        if (callCount === 1) controller.abort();
        return {
          content: '',
          input_tokens: 5, output_tokens: 5, model: 'mock', duration_ms: 1,
          tool_calls: [{ id: `tc${callCount}`, name: 'read_file', arguments: { path: 'x.ts' } }],
        };
      }),
      abort: vi.fn(),
      estimateTokens: (t) => Math.ceil(t.length / 4),
    };
    const executor = makeExecutor();

    const loop = new AgentLoopEngine(gateway, executor, tracker, 'task-1', {
      abortSignal: controller.signal,
    });

    await expect(loop.run('sys', 'task', 'mock', ALL_TOOLS)).rejects.toMatchObject({ name: 'AbortError' });
    // Should have made exactly 1 LLM call before aborting
    expect(callCount).toBe(1);
  });

  it('accumulates token usage across iterations', async () => {
    const gateway = makeGateway([
      { content: '', tool_calls: [{ id: 'tc', name: 'read_file', arguments: { path: 'x.ts' } }], input_tokens: 10, output_tokens: 5 },
      { content: 'done', input_tokens: 15, output_tokens: 8 },
    ]);
    const executor = makeExecutor();
    const loop = new AgentLoopEngine(gateway, executor, tracker, 'task-1');

    const result = await loop.run('sys', 'task', 'mock', ALL_TOOLS);

    expect(result.totalInputTokens).toBe(25);
    expect(result.totalOutputTokens).toBe(13);
  });

  it('reports filesChanged after committing', async () => {
    const gateway = makeGateway([{ content: 'done' }]);
    const executor = makeExecutor();
    // Manually stage a file change in the tracker
    tracker.stage('src/foo.ts', 'new content', '');
    // Mock commitChanges to clear the tracker
    executor.commitChanges = vi.fn(async () => { tracker.clear(); });

    const loop = new AgentLoopEngine(gateway, executor, tracker, 'task-1', {
      autoApplyEdits: true,
    });

    const result = await loop.run('sys', 'task', 'mock', ALL_TOOLS);

    expect(executor.commitChanges).toHaveBeenCalled();
  });
});
