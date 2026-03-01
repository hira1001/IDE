import { describe, it, expect } from 'vitest';
import { getGateway, getProviderFromModel, getRequiredProviders } from './gateway.js';
import { OpenAIAdapter } from './openaiAdapter.js';
import { AnthropicAdapter } from './anthropicAdapter.js';
import { GoogleAIAdapter } from './googleAdapter.js';
import { OllamaAdapter } from './ollamaAdapter.js';
import { VscodeLMAdapter } from './vscodeLMAdapter.js';

// Minimal mock for VS Code LM API
const mockVscodeLM = {
  lm: { selectChatModels: async () => [] },
  LanguageModelChatMessage: {
    User: (c: string) => ({ role: 'user', content: c }),
    Assistant: (c: string) => ({ role: 'assistant', content: c }),
  },
  CancellationTokenSource: class { token = {} },
};

describe('getGateway', () => {
  it('returns OpenAIAdapter for gpt- prefix', () => {
    const gw = getGateway('gpt-4o', { openai: 'key' });
    expect(gw).toBeInstanceOf(OpenAIAdapter);
  });

  it('returns AnthropicAdapter for claude- prefix', () => {
    const gw = getGateway('claude-sonnet-4-5', { anthropic: 'key' });
    expect(gw).toBeInstanceOf(AnthropicAdapter);
  });

  it('returns GoogleAIAdapter for gemini- prefix', () => {
    const gw = getGateway('gemini-1.5-pro', { google: 'key' });
    expect(gw).toBeInstanceOf(GoogleAIAdapter);
  });

  it('returns OllamaAdapter for ollama: prefix (no key needed)', () => {
    const gw = getGateway('ollama:llama3.2', {});
    expect(gw).toBeInstanceOf(OllamaAdapter);
  });

  it('returns VscodeLMAdapter for vscode: prefix', () => {
    const gw = getGateway('vscode:copilot-gpt-4', {}, mockVscodeLM as never);
    expect(gw).toBeInstanceOf(VscodeLMAdapter);
  });

  it('throws when OpenAI key is missing', () => {
    expect(() => getGateway('gpt-4o', {})).toThrow('OpenAI API key is not configured.');
  });

  it('throws when Anthropic key is missing', () => {
    expect(() => getGateway('claude-sonnet-4-5', {})).toThrow('Anthropic API key is not configured.');
  });

  it('throws when Google key is missing', () => {
    expect(() => getGateway('gemini-1.5-pro', {})).toThrow('Google AI API key is not configured.');
  });

  it('throws when VS Code LM API is not provided', () => {
    expect(() => getGateway('vscode:copilot', {})).toThrow('VS Code LM API is not available');
  });

  it('defaults to OllamaAdapter for unknown model prefix', () => {
    const gw = getGateway('unknown-model-xyz', {});
    expect(gw).toBeInstanceOf(OllamaAdapter);
  });

  it('returns OpenAIAdapter for o1 models (reasoning)', () => {
    expect(getGateway('o1', { openai: 'key' })).toBeInstanceOf(OpenAIAdapter);
    expect(getGateway('o1-mini', { openai: 'key' })).toBeInstanceOf(OpenAIAdapter);
    expect(getGateway('o1-preview', { openai: 'key' })).toBeInstanceOf(OpenAIAdapter);
  });

  it('returns OpenAIAdapter for o3 models (reasoning)', () => {
    expect(getGateway('o3', { openai: 'key' })).toBeInstanceOf(OpenAIAdapter);
    expect(getGateway('o3-mini', { openai: 'key' })).toBeInstanceOf(OpenAIAdapter);
  });

  it('throws for o1/o3 models when OpenAI key is missing', () => {
    expect(() => getGateway('o1', {})).toThrow('OpenAI API key is not configured.');
    expect(() => getGateway('o3-mini', {})).toThrow('OpenAI API key is not configured.');
  });
});

describe('getProviderFromModel', () => {
  it.each([
    ['gpt-4o', 'openai'],
    ['gpt-4-turbo', 'openai'],
    ['o1', 'openai'],
    ['o1-mini', 'openai'],
    ['o3', 'openai'],
    ['o3-mini', 'openai'],
    ['claude-sonnet-4-5', 'anthropic'],
    ['claude-haiku-4-5', 'anthropic'],
    ['gemini-1.5-pro', 'google'],
    ['gemini-2.0-flash', 'google'],
    ['ollama:llama3.2', 'ollama'],
    ['vscode:copilot-gpt-4', 'vscode'],
  ])('%s → %s', (model, expected) => {
    expect(getProviderFromModel(model)).toBe(expected);
  });

  it('defaults to ollama provider for unknown model', () => {
    expect(getProviderFromModel('unknown-xyz')).toBe('ollama');
  });
});

describe('getRequiredProviders', () => {
  it('returns unique providers for a model list', () => {
    const providers = getRequiredProviders(['gpt-4o', 'claude-sonnet-4-5', 'gpt-4o-mini']);
    expect(providers).toEqual(new Set(['openai', 'anthropic']));
  });

  it('returns empty set for empty list', () => {
    expect(getRequiredProviders([])).toEqual(new Set());
  });

  it('includes vscode provider', () => {
    const providers = getRequiredProviders(['vscode:copilot', 'gpt-4o']);
    expect(providers.has('vscode')).toBe(true);
    expect(providers.has('openai')).toBe(true);
  });
});
