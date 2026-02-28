import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIAdapter } from './openaiAdapter.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeSSEStream(...lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'));
      }
      controller.close();
    },
  });
}

describe('OpenAIAdapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ─── non-streaming ─────────────────────────────────────────────────────────

  it('non-streaming: sends correct URL and Authorization header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        model: 'gpt-4o',
      }),
    });

    const adapter = new OpenAIAdapter('sk-test');
    await adapter.chat({ model: 'gpt-4o', system_prompt: 'sys', user_prompt: 'hi' });

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
  });

  it('non-streaming: sends system and user messages in body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
        model: 'gpt-4o',
      }),
    });

    const adapter = new OpenAIAdapter('key');
    await adapter.chat({ model: 'gpt-4o', system_prompt: 'You are a bot', user_prompt: 'Say hello' });

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a bot' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Say hello' });
    expect(body.stream).toBe(false);
  });

  it('non-streaming: parses content and token counts', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Result text' } }],
        usage: { prompt_tokens: 8, completion_tokens: 12 },
        model: 'gpt-4o',
      }),
    });

    const adapter = new OpenAIAdapter('key');
    const resp = await adapter.chat({ model: 'gpt-4o', system_prompt: '', user_prompt: '' });
    expect(resp.content).toBe('Result text');
    expect(resp.input_tokens).toBe(8);
    expect(resp.output_tokens).toBe(12);
  });

  it('non-streaming: throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });
    const adapter = new OpenAIAdapter('bad-key');
    await expect(
      adapter.chat({ model: 'gpt-4o', system_prompt: '', user_prompt: '' })
    ).rejects.toThrow('OpenAI API error 401');
  });

  // ─── streaming ─────────────────────────────────────────────────────────────

  it('streaming: calls onChunk for each SSE token', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: makeSSEStream(
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        'data: {"choices":[{"delta":{"content":" there"}}]}',
        'data: [DONE]'
      ),
    });

    const chunks: string[] = [];
    const adapter = new OpenAIAdapter('key');
    const resp = await adapter.chat({
      model: 'gpt-4o', system_prompt: '', user_prompt: '',
      onChunk: (c) => chunks.push(c),
    });

    expect(chunks).toEqual(['Hi', ' there']);
    expect(resp.content).toBe('Hi there');
  });

  it('streaming: skips malformed SSE lines without throwing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: makeSSEStream(
        'data: INVALID JSON',
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        'data: [DONE]'
      ),
    });

    const adapter = new OpenAIAdapter('key');
    const resp = await adapter.chat({
      model: 'gpt-4o', system_prompt: '', user_prompt: '',
      onChunk: () => {},
    });
    expect(resp.content).toBe('ok');
  });

  // ─── tool calling ──────────────────────────────────────────────────────────

  it('tool calling: sends tools array and tool_choice in body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_1', type: 'function',
              function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
        model: 'gpt-4o',
      }),
    });

    const adapter = new OpenAIAdapter('key');
    const resp = await adapter.chat({
      model: 'gpt-4o', system_prompt: 'sys', user_prompt: 'do it',
      tools: [{ name: 'read_file', description: 'reads a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'path' } }, required: ['path'] } }],
    });

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('read_file');

    expect(resp.tool_calls).toHaveLength(1);
    expect(resp.tool_calls![0].name).toBe('read_file');
    expect(resp.tool_calls![0].arguments).toEqual({ path: 'src/a.ts' });
  });

  // ─── misc ──────────────────────────────────────────────────────────────────

  it('abort(): does not throw', () => {
    const adapter = new OpenAIAdapter('key');
    expect(() => adapter.abort()).not.toThrow();
  });

  it('estimateTokens(): returns a positive number', () => {
    const adapter = new OpenAIAdapter('key');
    expect(adapter.estimateTokens('hello world')).toBeGreaterThan(0);
  });
});
