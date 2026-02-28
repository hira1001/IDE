import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleAIAdapter } from './googleAdapter.js';

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

describe('GoogleAIAdapter', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  // ─── non-streaming ─────────────────────────────────────────────────────────

  it('non-streaming: URL contains model ID and API key', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'hi' }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
      }),
    });

    await new GoogleAIAdapter('g-key').chat({
      model: 'gemini-1.5-pro', system_prompt: 'sys', user_prompt: 'hello',
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('gemini-1.5-pro');
    expect(url).toContain('key=g-key');
    expect(url).toContain('generateContent');
  });

  it('non-streaming: sends systemInstruction and user contents', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '' }] } }] }),
    });

    await new GoogleAIAdapter('key').chat({
      model: 'gemini-1.5-pro', system_prompt: 'You are a bot', user_prompt: 'Hello',
    });

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.systemInstruction.parts[0].text).toBe('You are a bot');
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe('Hello');
  });

  it('non-streaming: parses candidates and usageMetadata', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Answer' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8 },
      }),
    });

    const resp = await new GoogleAIAdapter('key').chat({
      model: 'gemini-1.5-pro', system_prompt: '', user_prompt: '',
    });
    expect(resp.content).toBe('Answer');
    expect(resp.input_tokens).toBe(5);
    expect(resp.output_tokens).toBe(8);
  });

  it('non-streaming: throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: async () => 'Forbidden' });
    await expect(
      new GoogleAIAdapter('key').chat({ model: 'gemini-1.5-pro', system_prompt: '', user_prompt: '' })
    ).rejects.toThrow('Google AI API error 403');
  });

  // ─── streaming ─────────────────────────────────────────────────────────────

  it('streaming: uses streamGenerateContent endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: makeSSEStream(
        'data: {"candidates":[{"content":{"parts":[{"text":"chunk"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3}}'
      ),
    });

    const chunks: string[] = [];
    await new GoogleAIAdapter('key').chat({
      model: 'gemini-1.5-pro', system_prompt: '', user_prompt: '',
      onChunk: (c) => chunks.push(c),
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('streamGenerateContent');
    expect(url).toContain('alt=sse');
    expect(chunks).toEqual(['chunk']);
  });

  it('streaming: extracts usageMetadata token counts', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: makeSSEStream(
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":6}}'
      ),
    });

    const resp = await new GoogleAIAdapter('key').chat({
      model: 'gemini-1.5-pro', system_prompt: '', user_prompt: '',
      onChunk: () => {},
    });
    expect(resp.input_tokens).toBe(4);
    expect(resp.output_tokens).toBe(6);
  });

  // ─── tool calling ──────────────────────────────────────────────────────────

  it('tool calling: uses generateContent (not stream) endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ functionCall: { name: 'list_files', args: { pattern: '**/*.ts' } } }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    });

    const resp = await new GoogleAIAdapter('key').chat({
      model: 'gemini-1.5-pro', system_prompt: '', user_prompt: '',
      tools: [{ name: 'list_files', description: 'lists files', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'glob' } }, required: ['pattern'] } }],
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('generateContent');
    expect(url).not.toContain('streamGenerateContent');

    expect(resp.tool_calls).toHaveLength(1);
    expect(resp.tool_calls![0].name).toBe('list_files');
    expect(resp.tool_calls![0].arguments).toEqual({ pattern: '**/*.ts' });
  });

  it('tool calling: sends functionDeclarations in tools array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'done' }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
      }),
    });

    await new GoogleAIAdapter('key').chat({
      model: 'gemini-1.5-pro', system_prompt: '', user_prompt: '',
      tools: [{ name: 'read_file', description: 'desc', parameters: { type: 'object', properties: { path: { type: 'string', description: 'p' } } } }],
    });

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools[0]).toHaveProperty('functionDeclarations');
    expect(body.tools[0].functionDeclarations[0].name).toBe('read_file');
  });

  // ─── misc ──────────────────────────────────────────────────────────────────

  it('abort(): does not throw', () => {
    expect(() => new GoogleAIAdapter('key').abort()).not.toThrow();
  });

  it('estimateTokens(): returns a positive number', () => {
    expect(new GoogleAIAdapter('key').estimateTokens('hello world')).toBeGreaterThan(0);
  });
});
