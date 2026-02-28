import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicAdapter } from './anthropicAdapter.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeSSEStream(...lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
}

describe('AnthropicAdapter', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  // ─── non-streaming ─────────────────────────────────────────────────────────

  it('non-streaming: sends correct URL and Anthropic headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: 'ok' }], usage: { input_tokens: 5, output_tokens: 5 }, model: 'claude-sonnet-4-5',
      }),
    });

    const adapter = new AnthropicAdapter('ant-key');
    await adapter.chat({ model: 'claude-sonnet-4-5', system_prompt: 'sys', user_prompt: 'hi' });

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = opts.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('ant-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('non-streaming: sends system as top-level field, not in messages', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: '' }], usage: { input_tokens: 1, output_tokens: 1 }, model: 'claude-sonnet-4-5' }),
    });

    const adapter = new AnthropicAdapter('key');
    await adapter.chat({ model: 'claude-sonnet-4-5', system_prompt: 'You are a bot', user_prompt: 'Hello' });

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.system).toBe('You are a bot');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('non-streaming: parses content[0].text and usage', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'Result' }], usage: { input_tokens: 7, output_tokens: 14 }, model: 'claude-sonnet-4-5' }),
    });

    const adapter = new AnthropicAdapter('key');
    const resp = await adapter.chat({ model: 'claude-sonnet-4-5', system_prompt: '', user_prompt: '' });
    expect(resp.content).toBe('Result');
    expect(resp.input_tokens).toBe(7);
    expect(resp.output_tokens).toBe(14);
  });

  it('non-streaming: throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, text: async () => 'Rate limited' });
    await expect(
      new AnthropicAdapter('key').chat({ model: 'claude-sonnet-4-5', system_prompt: '', user_prompt: '' })
    ).rejects.toThrow('Anthropic API error 429');
  });

  // ─── streaming ─────────────────────────────────────────────────────────────

  it('streaming: extracts text from content_block_delta events', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: makeSSEStream(
        'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":10}}'
      ),
    });

    const chunks: string[] = [];
    const resp = await new AnthropicAdapter('key').chat({
      model: 'claude-sonnet-4-5', system_prompt: '', user_prompt: '',
      onChunk: (c) => chunks.push(c),
    });

    expect(chunks).toEqual(['Hello', ' world']);
    expect(resp.content).toBe('Hello world');
    expect(resp.input_tokens).toBe(5);
    expect(resp.output_tokens).toBe(10);
  });

  it('streaming: falls back to estimateTokens when no usage events', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: makeSSEStream(
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}'
      ),
    });

    const resp = await new AnthropicAdapter('key').chat({
      model: 'claude-sonnet-4-5', system_prompt: '', user_prompt: '',
      onChunk: () => {},
    });
    expect(resp.input_tokens).toBeGreaterThan(0);
    expect(resp.output_tokens).toBeGreaterThan(0);
  });

  // ─── tool calling ──────────────────────────────────────────────────────────

  it('tool calling: parses tool_use blocks and returns tool_calls', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'foo.ts' } }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
      }),
    });

    const resp = await new AnthropicAdapter('key').chat({
      model: 'claude-sonnet-4-5', system_prompt: 'sys', user_prompt: 'read',
      tools: [{ name: 'read_file', description: 'reads a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'path' } }, required: ['path'] } }],
    });

    expect(resp.tool_calls).toHaveLength(1);
    expect(resp.tool_calls![0].id).toBe('tu_1');
    expect(resp.tool_calls![0].name).toBe('read_file');
    expect(resp.tool_calls![0].arguments).toEqual({ path: 'foo.ts' });
  });

  it('tool calling: sends input_schema format (not parameters)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
      }),
    });

    await new AnthropicAdapter('key').chat({
      model: 'claude-sonnet-4-5', system_prompt: '', user_prompt: '',
      tools: [{ name: 'read_file', description: 'desc', parameters: { type: 'object', properties: { path: { type: 'string', description: 'p' } } } }],
    });

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools[0]).toHaveProperty('input_schema');
    expect(body.tools[0]).not.toHaveProperty('parameters');
  });

  // ─── misc ──────────────────────────────────────────────────────────────────

  it('abort(): does not throw', () => {
    expect(() => new AnthropicAdapter('key').abort()).not.toThrow();
  });

  it('estimateTokens(): returns a positive number', () => {
    expect(new AnthropicAdapter('key').estimateTokens('hello world')).toBeGreaterThan(0);
  });
});
