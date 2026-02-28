import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaAdapter } from './ollamaAdapter.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('OllamaAdapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('strips ollama: prefix before calling API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello from Llama' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        model: 'llama3.2',
      }),
    });

    const adapter = new OllamaAdapter('http://localhost:11434');
    const response = await adapter.chat({
      model: 'ollama:llama3.2',
      system_prompt: 'You are helpful',
      user_prompt: 'Say hello',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('llama3.2'); // prefix stripped
    expect(response.content).toBe('Hello from Llama');
    expect(response.input_tokens).toBe(10);
    expect(response.output_tokens).toBe(20);
    expect(response.model).toBe('ollama:llama3.2');
  });

  it('works with model name that already lacks ollama: prefix', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
        model: 'mistral',
      }),
    });

    const adapter = new OllamaAdapter('http://localhost:11434');
    await adapter.chat({
      model: 'mistral',
      system_prompt: 'You are helpful',
      user_prompt: 'Hi',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.model).toBe('mistral');
  });

  it('normalizes trailing slash on endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model: 'llama3.2',
      }),
    });

    const adapter = new OllamaAdapter('http://localhost:11434/');
    await adapter.chat({ model: 'ollama:llama3.2', system_prompt: '', user_prompt: '' });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('throws on non-ok HTTP response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'model not found',
    });

    const adapter = new OllamaAdapter('http://localhost:11434');
    await expect(
      adapter.chat({ model: 'ollama:unknown', system_prompt: '', user_prompt: '' })
    ).rejects.toThrow('Ollama API error 404');
  });

  it('routes tool requests through _chatWithTools and returns tool_calls', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"/foo.ts"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
        model: 'llama3.1',
      }),
    });

    const adapter = new OllamaAdapter('http://localhost:11434');
    const response = await adapter.chat({
      model: 'ollama:llama3.1',
      system_prompt: 'You are helpful',
      user_prompt: 'Read /foo.ts',
      tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] } }],
    });

    expect(response.tool_calls).toHaveLength(1);
    expect(response.tool_calls![0].name).toBe('read_file');
    expect(response.tool_calls![0].arguments).toEqual({ path: '/foo.ts' });
    expect(response.tool_calls![0].id).toBe('call-1');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tool_choice).toBe('auto');
  });

  it('abort() aborts the request', () => {
    const adapter = new OllamaAdapter('http://localhost:11434');
    expect(() => adapter.abort()).not.toThrow();
  });

  it('estimateTokens returns a number', () => {
    const adapter = new OllamaAdapter('http://localhost:11434');
    expect(adapter.estimateTokens('hello world')).toBeGreaterThan(0);
  });
});
