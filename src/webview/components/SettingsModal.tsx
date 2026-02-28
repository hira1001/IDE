import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useVSCode } from '../hooks/useVSCode.js';
import { AvailableModels } from '../hooks/useWorkflowState.js';

interface SettingsCurrent {
  openai: 'set' | 'unset';
  anthropic: 'set' | 'unset';
  google: 'set' | 'unset';
  ollamaEndpoint: string;
  vscodeLMCount: number;
  defaultModel: string;
  availableModels: AvailableModels;
}

interface OllamaResult {
  ok: boolean;
  latency?: number;
  error?: string;
  models?: string[];
}

interface SettingsModalProps {
  onClose: () => void;
}

type ProviderKey = 'openai' | 'anthropic' | 'google';

const PROVIDER_META: { id: ProviderKey; label: string; placeholder: string }[] = [
  { id: 'openai',    label: 'OpenAI',    placeholder: 'sk-...' },
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { id: 'google',    label: 'Google AI', placeholder: 'AIza...' },
];

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { postMessage } = useVSCode();

  const [settings, setSettings] = useState<SettingsCurrent | null>(null);
  const [inputs, setInputs] = useState<Record<ProviderKey, string>>({ openai: '', anthropic: '', google: '' });
  const [feedback, setFeedback] = useState<Record<ProviderKey, 'ok' | 'error' | null>>({ openai: null, anthropic: null, google: null });
  const [ollamaInput, setOllamaInput] = useState('');
  const [ollamaStatus, setOllamaStatus] = useState<OllamaResult | 'testing' | null>(null);
  const [defaultModelInput, setDefaultModelInput] = useState('');
  const feedbackTimersRef = useRef<Partial<Record<ProviderKey, ReturnType<typeof setTimeout>>>>({});

  // Clear all pending feedback timers on unmount
  useEffect(() => {
    const timers = feedbackTimersRef.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  // Listen for messages from extension
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type: string; payload?: unknown };

      if (msg.type === 'settings:current') {
        const s = msg.payload as SettingsCurrent;
        setSettings(s);
        setOllamaInput(s.ollamaEndpoint);
        setDefaultModelInput(s.defaultModel);
      }

      if (msg.type === 'settings:saved') {
        const p = msg.payload as { provider: ProviderKey; success: boolean };
        setFeedback((f) => ({ ...f, [p.provider]: p.success ? 'ok' : 'error' }));
        if (p.success) {
          setInputs((i) => ({ ...i, [p.provider]: '' }));
          const existing = feedbackTimersRef.current[p.provider];
          if (existing) clearTimeout(existing);
          feedbackTimersRef.current[p.provider] = setTimeout(() => {
            setFeedback((f) => ({ ...f, [p.provider]: null }));
            delete feedbackTimersRef.current[p.provider];
          }, 1500);
        }
      }

      if (msg.type === 'settings:ollama_result') {
        setOllamaStatus(msg.payload as OllamaResult);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Request settings on mount
  useEffect(() => {
    postMessage({ type: 'settings:get' });
  }, [postMessage]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSaveKey = useCallback((provider: ProviderKey) => {
    const key = inputs[provider].trim();
    if (!key) return;
    postMessage({ type: 'settings:save', payload: { provider, key } });
  }, [inputs, postMessage]);

  const handleClearKey = useCallback((provider: ProviderKey) => {
    postMessage({ type: 'settings:clear', payload: { provider } });
  }, [postMessage]);

  const handleTestOllama = useCallback(() => {
    setOllamaStatus('testing');
    postMessage({ type: 'settings:test_ollama', payload: { endpoint: ollamaInput } });
  }, [ollamaInput, postMessage]);

  const handleSaveOllama = useCallback(() => {
    postMessage({ type: 'settings:save_ollama', payload: { endpoint: ollamaInput } });
  }, [ollamaInput, postMessage]);

  const handleSaveDefaultModel = useCallback(() => {
    postMessage({ type: 'settings:save_default_model', payload: { model: defaultModelInput } });
  }, [defaultModelInput, postMessage]);

  const allAvailableModels = settings
    ? [
        ...settings.availableModels.openai,
        ...settings.availableModels.anthropic,
        ...settings.availableModels.google,
        ...settings.availableModels.ollama,
        ...settings.availableModels.vscodeLM,
      ]
    : [];

  const groupedModels = settings
    ? [
        ...(settings.availableModels.openai.length > 0   ? [{ label: 'OpenAI',         models: settings.availableModels.openai }]   : []),
        ...(settings.availableModels.anthropic.length > 0 ? [{ label: 'Anthropic',       models: settings.availableModels.anthropic }] : []),
        ...(settings.availableModels.google.length > 0   ? [{ label: 'Google AI',        models: settings.availableModels.google }]   : []),
        ...(settings.availableModels.ollama.length > 0   ? [{ label: 'Local (Ollama)',   models: settings.availableModels.ollama }]   : []),
        ...(settings.availableModels.vscodeLM.length > 0 ? [{ label: 'VS Code LM',       models: settings.availableModels.vscodeLM }] : []),
      ]
    : [];

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-modal__header">
          <span className="settings-modal__title">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ marginRight: 6 }}>
              <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Settings
          </span>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="settings-modal__body">

          {/* ── Cloud AI API Keys ── */}
          <section className="settings-section">
            <h3 className="settings-section__title">Cloud AI API Keys</h3>
            <p className="settings-section__desc">Keys are stored securely in VS Code SecretStorage (OS keychain).</p>

            {PROVIDER_META.map(({ id, label, placeholder }) => {
              const isSet = settings?.[id] === 'set';
              const inputVal = inputs[id];
              const isDirty = inputVal.trim().length > 0;
              const fb = feedback[id];

              return (
                <div key={id} className="settings-provider-row">
                  <div className="settings-provider-row__header">
                    <span className="settings-provider-row__label">{label}</span>
                    <span className={`settings-provider-row__status ${isSet ? 'settings-provider-row__status--set' : 'settings-provider-row__status--unset'}`}>
                      {isSet ? '✅ Configured' : '⚪ Not configured'}
                    </span>
                  </div>
                  <div className="settings-provider-row__controls">
                    <input
                      type="password"
                      className="field-input settings-provider-row__input"
                      placeholder={isSet ? '••••••••  (enter new key to update)' : placeholder}
                      value={inputVal}
                      autoComplete="off"
                      data-1p-ignore
                      onChange={(e) => {
                        setInputs((i) => ({ ...i, [id]: e.target.value }));
                      }}
                    />
                    <button
                      className="btn btn--primary btn--sm"
                      disabled={!isDirty}
                      onClick={() => handleSaveKey(id)}
                    >
                      {isSet ? 'Update' : 'Save'}
                    </button>
                    {isSet && (
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => handleClearKey(id)}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {fb === 'ok' && <div className="settings-feedback settings-feedback--ok">✅ Saved!</div>}
                  {fb === 'error' && <div className="settings-feedback settings-feedback--error">❌ Failed to save key</div>}
                </div>
              );
            })}
          </section>

          {/* ── Generation Model ── */}
          <section className="settings-section">
            <h3 className="settings-section__title">Generation Model</h3>
            <p className="settings-section__desc">Model used by AI to generate workflows. Configure at least one API key above first.</p>
            <div className="settings-provider-row__controls">
              {allAvailableModels.length > 0 ? (
                <select
                  className="field-select"
                  value={allAvailableModels.includes(defaultModelInput) ? defaultModelInput : ''}
                  onChange={(e) => setDefaultModelInput(e.target.value)}
                  style={{ flex: 1 }}
                >
                  {groupedModels.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <input
                  className="field-input"
                  style={{ flex: 1 }}
                  value={defaultModelInput}
                  onChange={(e) => setDefaultModelInput(e.target.value)}
                  placeholder="Configure an API key first"
                  disabled={allAvailableModels.length === 0}
                />
              )}
              <button
                className="btn btn--primary btn--sm"
                disabled={defaultModelInput === (settings?.defaultModel ?? '')}
                onClick={handleSaveDefaultModel}
              >
                Apply
              </button>
            </div>
            {settings && (
              <div style={{ fontSize: 11, color: 'var(--aao-muted)', marginTop: 4 }}>
                Current: <strong style={{ fontFamily: 'var(--aao-font-mono)' }}>{settings.defaultModel}</strong>
              </div>
            )}
          </section>

          {/* ── Ollama ── */}
          <section className="settings-section">
            <h3 className="settings-section__title">Local LLM (Ollama)</h3>
            <p className="settings-section__desc">
              Run local models via Ollama. Install from{' '}
              <span style={{ fontFamily: 'var(--aao-font-mono)', fontSize: 11 }}>ollama.com</span>, then add models with{' '}
              <code className="settings-code">ollama pull llama3.2</code>.
            </p>
            <div className="settings-provider-row__controls">
              <input
                className="field-input"
                style={{ flex: 1 }}
                value={ollamaInput}
                autoComplete="off"
                onChange={(e) => {
                  setOllamaInput(e.target.value);
                  setOllamaStatus(null);
                }}
                placeholder="http://localhost:11434"
              />
              <button
                className="btn btn--secondary btn--sm"
                onClick={handleTestOllama}
                disabled={ollamaStatus === 'testing'}
              >
                {ollamaStatus === 'testing' ? 'Testing…' : 'Test'}
              </button>
              {ollamaInput !== (settings?.ollamaEndpoint ?? '') && (
                <button className="btn btn--primary btn--sm" onClick={handleSaveOllama}>Save</button>
              )}
            </div>
            {ollamaStatus && ollamaStatus !== 'testing' && (
              <div className={`settings-feedback ${ollamaStatus.ok ? 'settings-feedback--ok' : 'settings-feedback--error'}`}>
                {ollamaStatus.ok
                  ? `✅ Connected (${ollamaStatus.latency}ms)${ollamaStatus.models && ollamaStatus.models.length > 0 ? ` — ${ollamaStatus.models.length} model(s) found` : ''}`
                  : `❌ ${ollamaStatus.error}`}
              </div>
            )}
            {(() => {
              const displayModels = (ollamaStatus && ollamaStatus !== 'testing' && ollamaStatus.ok && ollamaStatus.models && ollamaStatus.models.length > 0)
                ? ollamaStatus.models
                : settings?.availableModels.ollama ?? [];
              return displayModels.length > 0 ? (
                <div className="settings-ollama-models">
                  <span style={{ fontSize: 11, color: 'var(--aao-muted)' }}>Available models: </span>
                  {displayModels.slice(0, 5).map((m) => (
                    <span key={m} className="settings-model-chip">{m}</span>
                  ))}
                  {displayModels.length > 5 && (
                    <span className="settings-model-chip">+{displayModels.length - 5} more</span>
                  )}
                </div>
              ) : null;
            })()}
          </section>

          {/* ── VS Code LM ── */}
          <section className="settings-section">
            <h3 className="settings-section__title">VS Code Language Model API</h3>
            <p className="settings-section__desc">
              Use models from installed VS Code extensions (Cursor, GitHub Copilot, etc.).
              No API key required — activate via the extension.
            </p>
            {settings ? (
              settings.vscodeLMCount > 0 ? (
                <div className="settings-feedback settings-feedback--ok">
                  ✅ {settings.vscodeLMCount} model(s) available via VS Code LM API
                  {settings.availableModels.vscodeLM.length > 0 && (
                    <div className="settings-ollama-models" style={{ marginTop: 4 }}>
                      {settings.availableModels.vscodeLM.slice(0, 5).map((m) => (
                        <span key={m} className="settings-model-chip">{m}</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="settings-feedback settings-feedback--neutral">
                  ⚪ No VS Code LM models detected. Install Cursor or GitHub Copilot extension.
                </div>
              )
            ) : null}
          </section>

          {/* ── Reset ── */}
          <section className="settings-section settings-section--danger">
            <h3 className="settings-section__title">Danger Zone</h3>
            <button
              className="btn btn--danger btn--sm"
              onClick={() => postMessage({ type: 'command:resetState' })}
              style={{ marginTop: 4 }}
            >
              Reset Extension State
            </button>
            <p className="settings-section__desc" style={{ marginTop: 6 }}>
              Clears all API keys, saved execution state, and settings. Cannot be undone.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
