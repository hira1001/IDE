import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowState } from './hooks/useWorkflowState.js';
import { PipelineView } from './components/PipelineView.js';
import { ExecutionBar } from './components/ExecutionBar.js';
import { DryRunPanel } from './components/DryRunPanel.js';
import { BreakpointPanel } from './components/BreakpointPanel.js';
import { TemplateSaveDialog } from './components/TemplateSaveDialog.js';
import { TemplateSelector } from './components/TemplateSelector.js';
import { ToastContainer, ToastItem } from './components/Toast.js';
import { SettingsModal } from './components/SettingsModal.js';
import { WorkflowTemplate, ProjectContextSummary, SourceInput } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

// ─── ContextIndicator ─────────────────────────────────────────────────────────

interface ContextIndicatorProps {
  summary: ProjectContextSummary | null;
  source: SourceInput | null;
  onToggleMode: () => void;
  onRefresh: () => void;
}

function ContextIndicator({ summary, source, onToggleMode, onRefresh }: ContextIndicatorProps) {
  const { t } = useTranslation();
  const isProject = summary?.mode === 'project';

  if (!summary && !source) {
    // No context at all
    return (
      <div className="source-indicator source-indicator--empty">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M6.5 4v3.5M6.5 9v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        {t('app.noSource')}
      </div>
    );
  }

  const activeFilename = summary?.activeFilename ?? source?.filename ?? null;
  const tokenK = summary ? Math.round(summary.tokenEstimate / 100) / 10 : null;

  return (
    <div className={`source-indicator source-indicator--context${isProject ? ' source-indicator--project' : ''}`}>
      {/* Mode toggle button */}
      <button
        className="source-indicator__mode-btn"
        onClick={onToggleMode}
        title={isProject ? 'Switch to file-only mode' : 'Switch to project mode'}
        aria-label={isProject ? 'Project mode (click to switch to file mode)' : 'File mode (click to switch to project mode)'}
      >
        {isProject ? (
          // Folder icon for project mode
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M1.5 3h3.5l1 1.5H11.5v6H1.5V3z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          </svg>
        ) : (
          // File icon for file mode
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M2 2h7l2 2v7H2V2z" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M5 5.5h3M5 7.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        )}
        <span className="source-indicator__mode-label">{isProject ? 'Project' : 'File'}</span>
        <span className="source-indicator__chevron">▾</span>
      </button>

      {/* Active file */}
      {activeFilename && (
        <span className="source-indicator__name" title={activeFilename}>{activeFilename}</span>
      )}

      {/* Project-mode extras */}
      {isProject && summary && (
        <>
          {summary.totalFiles > 0 && (
            <span className="source-indicator__meta">{summary.totalFiles} files</span>
          )}
          {summary.relatedFilePaths.length > 0 && (
            <span className="source-indicator__meta" title={summary.relatedFilePaths.join('\n')}>
              +{summary.relatedFilePaths.length} related
            </span>
          )}
          {summary.framework && (
            <span className="source-indicator__badge">{summary.framework}</span>
          )}
          {tokenK !== null && tokenK > 0 && (
            <span className="source-indicator__meta source-indicator__tokens">~{tokenK}k tok</span>
          )}
        </>
      )}

      {/* File-mode: show language + lines */}
      {!isProject && source && (
        <>
          <span className="source-indicator__meta">{source.language_id}</span>
          <span className="source-indicator__meta">{source.line_count.toLocaleString()} lines</span>
        </>
      )}

      {/* Refresh button */}
      <button
        className="source-indicator__refresh"
        onClick={onRefresh}
        title="Refresh context"
        aria-label="Refresh context"
      >↺</button>
    </div>
  );
}

export function App() {
  const { t } = useTranslation();
  const {
    config,
    executionState,
    source,
    contextSummary,
    templates,
    dryRunResult,
    isGenerating,
    generationError,
    noApiKeys,
    streamingChunks,
    toolEvents,
    availableModels,
    generateWorkflow,
    dismissNoApiKeys,
    executeWorkflow,
    executeFromStep,
    abortWorkflow,
    abortGenerate,
    retryTask,
    resumeFromPause,
    dryRun,
    manualEditOutput,
    loadTemplates,
    setConfig,
    clearWorkflow,
    clearDryRun,
    setContextMode,
    refreshContext,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useWorkflowState();

  const [instruction, setInstruction] = useState('');
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  // Auto-resize chat input
  useEffect(() => {
    const el = chatInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 18;
    el.style.height = `${Math.max(el.scrollHeight, lineHeight * 2 + 20)}px`;
  }, [instruction]);

  const [errorExpanded, setErrorExpanded] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pausedOutputs, setPausedOutputs] = useState<Record<string, string> | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const status = executionState?.status ?? 'idle';
  const taskStates = executionState?.task_states ?? {};
  const outputStore = executionState?.output_store ?? {};
  const totalCost = executionState?.total_cost_usd ?? 0;

  // Compute completed task counts for progress bar
  const totalTasks = config ? config.workflow.reduce((acc, s) => acc + s.tasks.length, 0) : 0;
  const completedTasks = Object.values(taskStates).filter(
    (ts) => ts.status === 'completed' || ts.status === 'skipped'
  ).length;

  const addToast = useCallback((message: string, type: ToastItem['type']) => {
    const id = uuidv4();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Detect pause state
  React.useEffect(() => {
    if (status === 'paused' && executionState) {
      setPausedOutputs(executionState.output_store);
    } else {
      setPausedOutputs(null);
    }
  }, [status, executionState]);

  // Show toast on abort
  React.useEffect(() => {
    if (status === 'aborted') addToast(t('app.aborted'), 'info');
  }, [status]); // addToast is stable (useCallback with no deps)

  // Pending auto-run after Generate & Run
  const pendingAutoRunRef = React.useRef(false);
  React.useEffect(() => {
    if (pendingAutoRunRef.current && config && !isGenerating) {
      pendingAutoRunRef.current = false;
      executeWorkflow(config);
    }
  }, [config, isGenerating]); // executeWorkflow is stable (useCallback)

  const handleGenerate = () => {
    if (!instruction.trim()) return;
    if (noApiKeys) { setShowSettings(true); return; }
    generateWorkflow(instruction);
  };

  const handleGenerateAndRun = () => {
    if (!instruction.trim()) return;
    if (noApiKeys) { setShowSettings(true); return; }
    pendingAutoRunRef.current = true;
    generateWorkflow(instruction);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+Enter / Cmd+Enter shortcuts work from anywhere (intended for the instruction textarea)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (e.shiftKey) {
        handleGenerateAndRun();
      } else {
        handleGenerate();
      }
    }

    // Undo/redo must NOT fire when the user is editing text in an input or textarea,
    // since those elements have their own native undo stack (typing Ctrl+Z to undo a
    // word edit must not accidentally undo the entire agent config).
    const target = e.target as HTMLElement;
    const isEditableTarget =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // Ctrl+, → Open Settings (VS Code convention)
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      setShowSettings(true);
      return;
    }

    // Show shortcuts panel with '?' when not editing text
    if (e.key === '?' && !isEditableTarget) {
      e.preventDefault();
      setShowShortcuts(true);
    }
    if (e.key === 'Escape') {
      if (showSettings) { setShowSettings(false); return; }
      if (showShortcuts) { setShowShortcuts(false); return; }
      if (showTemplateSelector) { setShowTemplateSelector(false); return; }
      if (showSaveDialog) { setShowSaveDialog(false); return; }
    }

    if (isEditableTarget) return;

    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && canUndo) {
      e.preventDefault();
      undo();
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && canRedo) {
      e.preventDefault();
      redo();
    }
  };

  const handleRun = () => {
    if (!config) return;
    executeWorkflow(config);
  };

  const handlePreview = () => {
    if (!config) return;
    dryRun(config);
  };

  const handleDryRunExecute = () => {
    clearDryRun();
    handleRun();
  };

  const handleContinueFromPause = (editedOutputs: Record<string, string>) => {
    if (!executionState) return;
    for (const [key, content] of Object.entries(editedOutputs)) {
      manualEditOutput(key, content, executionState.current_step);
    }
    resumeFromPause();
    setPausedOutputs(null);
  };

  const handleLoadTemplate = (template: WorkflowTemplate) => {
    setConfig(template.config);
    setShowTemplateSelector(false);
  };

  const handleOpenTemplates = () => {
    loadTemplates();
    setShowTemplateSelector(true);
  };

  return (
    <div className="app" onKeyDown={handleKeyDown}>
      {/* ── Header ─────────────────────────────── */}
      <header className="app__header">
        <div className="app__header-brand">
          <div className="app__logo" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="9" stroke="url(#logoGrad)" strokeWidth="1.5"/>
              <circle cx="10" cy="6.5" r="2.5" fill="url(#logoGrad)"/>
              <path d="M5.5 15c0-2.49 2.01-4.5 4.5-4.5s4.5 2.01 4.5 4.5" stroke="url(#logoGrad)" strokeWidth="1.5" strokeLinecap="round"/>
              <defs>
                <linearGradient id="logoGrad" x1="2" y1="2" x2="18" y2="18" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#818cf8"/>
                  <stop offset="1" stopColor="#38bdf8"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className="app__title">{t('app.title')}</h1>
        </div>

        <div className="app__header-actions">
          {canUndo && (
            <button
              className="btn btn--icon-only"
              onClick={undo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo last change"
            >↩</button>
          )}
          {canRedo && (
            <button
              className="btn btn--icon-only"
              onClick={redo}
              title="Redo (Ctrl+Y)"
              aria-label="Redo change"
            >↪</button>
          )}
          <button
            className="btn btn--icon-only"
            onClick={() => setShowShortcuts(true)}
            title={t('app.keyboardShortcuts')}
            aria-label={t('app.keyboardShortcuts')}
            style={{ fontSize: 13, fontWeight: 600 }}
          >?</button>
          <button
            className="btn btn--icon-only"
            onClick={() => setShowSettings(true)}
            title="Settings — API keys, models (Ctrl+,)"
            aria-label="Open Settings"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.96 2.96l1.06 1.06M10.98 10.98l1.06 1.06M2.96 12.04l1.06-1.06M10.98 4.02l1.06-1.06" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            className="btn btn--icon-only"
            onClick={handleOpenTemplates}
            title={t('app.loadTemplate')}
            aria-label={t('app.loadTemplate')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 3.5C2 2.67 2.67 2 3.5 2h3l2 2h4c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-9.5C2.67 14 2 13.33 2 12.5v-9z" stroke="currentColor" strokeWidth="1.4"/>
            </svg>
          </button>
          {config && (
            <button
              className="btn btn--icon-only"
              onClick={() => setShowSaveDialog(true)}
              title={t('app.saveTemplate')}
              aria-label={t('app.saveTemplate')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 3h8l2 2v8H3V3z" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="5.5" y="3" width="4" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M5 10h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          {config && (status === 'idle' || status === 'completed' || status === 'error') && (
            <button
              className="btn btn--icon-only btn--danger-hover"
              onClick={clearWorkflow}
              title={t('app.clearWorkflow') || 'Clear workflow'}
              aria-label={t('app.clearWorkflow') || 'Clear workflow'}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* ── API Key onboarding banner ──────────── */}
      {noApiKeys && (
        <div className="onboarding-banner" role="alert">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span>{t('app.noApiKeysMsg') || 'No API key configured. Click ⚙ Settings to add your API keys.'}</span>
          <button
            className="btn btn--ghost btn--xs"
            onClick={() => { setShowSettings(true); dismissNoApiKeys(); }}
          >
            {t('app.configureKeys') || 'Open Settings'}
          </button>
          <button
            className="btn btn--icon-only btn--ghost btn--xs"
            onClick={dismissNoApiKeys}
            aria-label="Dismiss"
            style={{ marginLeft: 2 }}
          >✕</button>
        </div>
      )}

      {/* ── Chat / MetaAI input ─────────────────── */}
      <div className="app__chat">
        <div className="chat-input-wrapper">
          <textarea
            ref={chatInputRef}
            className="chat-input"
            placeholder={t('app.chatPlaceholder')}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={isGenerating}
          />
          <div className="chat-send-group">
            <button
              className={`chat-send-btn${isGenerating ? ' chat-send-btn--loading' : ''}`}
              onClick={handleGenerate}
              disabled={isGenerating || !instruction.trim()}
              aria-label={t('app.generate')}
              title="Generate a multi-agent workflow from your description (Ctrl+Enter)"
            >
              {isGenerating ? (
                <span className="chat-send-btn__spinner" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M14 8L2 2l3 6-3 6 12-6z" fill="currentColor"/>
                </svg>
              )}
            </button>
            <button
              className="chat-run-btn"
              onClick={handleGenerateAndRun}
              disabled={isGenerating || !instruction.trim()}
              aria-label={t('app.generateAndRun') || 'Generate & Run'}
              title="Generate workflow and run it immediately (Ctrl+Shift+Enter)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2.5 2l10 5-10 5V2z" fill="currentColor"/>
              </svg>
              <span className="chat-run-btn__label">{t('app.generateAndRun') || 'Generate & Run'}</span>
            </button>
          </div>
        </div>
        <div className="chat-input-hint">
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> {t('app.generate') || 'Generate'}
          {' · '}
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> {t('app.generateAndRun') || 'Generate & Run'}
        </div>

        {isGenerating && (
          <div className="generating-indicator" role="status">
            <div className="generating-indicator__dots">
              <span /><span /><span />
            </div>
            <span className="generating-indicator__text">{t('app.generating') || 'Generating workflow…'}</span>
            <button
              className="btn btn--ghost btn--xs"
              onClick={abortGenerate}
              style={{ marginLeft: 'auto' }}
              aria-label={t('app.cancelGeneration') || 'Cancel'}
            >
              {t('app.cancelGeneration') || 'Cancel'}
            </button>
          </div>
        )}

        {generationError && (() => {
          const MAX_LEN = 200;
          const truncated = !errorExpanded && generationError.length > MAX_LEN;
          const displayError = truncated ? generationError.slice(0, MAX_LEN) + '…' : generationError;
          const isAuthError = /auth|key|unauthorized|forbidden|api_key|invalid.*key/i.test(generationError);
          return (
            <div className="error-message" role="alert">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M7 4.5v3M7 9.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <span>{displayError}</span>
              {generationError.length > MAX_LEN && (
                <button
                  className="btn btn--ghost btn--xs"
                  onClick={() => setErrorExpanded((v) => !v)}
                  style={{ marginLeft: 4 }}
                >
                  {errorExpanded ? (t('app.showLess') || 'Show less') : (t('app.showMore') || 'Show more')}
                </button>
              )}
              {isAuthError && (
                <button
                  className="btn btn--ghost btn--xs"
                  onClick={() => setShowSettings(true)}
                  style={{ marginLeft: 4 }}
                >
                  ⚙ Check API Keys
                </button>
              )}
              <button
                className="btn btn--ghost btn--xs"
                onClick={handleGenerate}
                style={{ marginLeft: 4 }}
              >
                {t('app.retry') || 'Retry'}
              </button>
            </div>
          );
        })()}
      </div>

      {/* ── Context indicator ───────────────────── */}
      <ContextIndicator
        summary={contextSummary}
        source={source}
        onToggleMode={() => {
          const next = contextSummary?.mode === 'project' ? 'file' : 'project';
          setContextMode(next);
        }}
        onRefresh={refreshContext}
      />

      {/* ── Pipeline ────────────────────────────── */}
      {config && (
        <PipelineView
          config={config}
          taskStates={taskStates}
          outputStore={outputStore}
          streamingChunks={streamingChunks}
          toolEvents={toolEvents}
          availableModels={availableModels}
          onChange={setConfig}
          onRetryTask={(taskId) => retryTask(taskId, config)}
          onToast={addToast}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      {!config && !isGenerating && (
        <div className="empty-state">
          <div className="empty-state__icon" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="1.5" opacity="0.2"/>
              <circle cx="24" cy="18" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
              <path d="M12 38c0-6.63 5.37-12 12-12s12 5.37 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
              <circle cx="38" cy="16" r="4" stroke="currentColor" strokeWidth="1.2" opacity="0.3"/>
              <path d="M35 23c0-3.31 2.69-6 6-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"/>
              <circle cx="10" cy="16" r="4" stroke="currentColor" strokeWidth="1.2" opacity="0.3"/>
              <path d="M7 23c0-3.31 2.69-6 6-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3" transform="scale(-1,1) translate(-20,0)"/>
            </svg>
          </div>
          <p className="empty-state__text">{t('app.emptyState')}</p>
          <p className="empty-state__sub">{t('app.emptyStateSub')}</p>
          <div className="empty-state__examples">
            <div className="empty-state__examples-title">{t('app.examples')}</div>
            <div className="empty-state__examples-list">
              {(t('app.examplePrompts', { returnObjects: true }) as string[]).map((prompt: string, i: number) => (
                <button
                  key={i}
                  className="empty-state__example-btn"
                  onClick={() => {
                    setInstruction(prompt);
                    chatInputRef.current?.focus();
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Execution Bar (sticky footer) ──────── */}
      {config && (
        <ExecutionBar
          status={status}
          dryRunResult={dryRunResult}
          totalCost={totalCost}
          currentStep={executionState?.current_step}
          totalSteps={config.workflow.length}
          completedTasks={completedTasks}
          totalTasks={totalTasks}
          onPreview={handlePreview}
          onRun={handleRun}
          onStop={abortWorkflow}
          onResume={resumeFromPause}
          onSaveTemplate={() => setShowSaveDialog(true)}
          onRerunFromStep={config ? (fromStep) => executeFromStep(config, fromStep) : undefined}
        />
      )}

      {/* ── Overlay panels ───────────────────── */}
      {dryRunResult && (
        <DryRunPanel
          result={dryRunResult}
          onClose={clearDryRun}
          onExecute={handleDryRunExecute}
        />
      )}

      {pausedOutputs && (
        <BreakpointPanel
          stepNumber={executionState?.current_step ?? 0}
          outputs={pausedOutputs}
          onContinue={handleContinueFromPause}
          onAbort={abortWorkflow}
        />
      )}

      {showSaveDialog && config && (
        <TemplateSaveDialog
          config={config}
          onClose={() => setShowSaveDialog(false)}
          onSaved={() => { setShowSaveDialog(false); addToast(t('app.templateSaved'), 'success'); }}
        />
      )}

      {showTemplateSelector && (
        <TemplateSelector
          templates={templates}
          onSelect={handleLoadTemplate}
          onClose={() => setShowTemplateSelector(false)}
        />
      )}

      {/* ── Keyboard shortcuts modal ─────────── */}
      {showShortcuts && (
        <div
          className="modal-overlay"
          onClick={() => setShowShortcuts(false)}
          role="dialog"
          aria-modal="true"
          aria-label={t('shortcuts.title')}
        >
          <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-modal__header">
              <span className="shortcuts-modal__title">{t('shortcuts.title')}</span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setShowShortcuts(false)}
                aria-label={t('shortcuts.close')}
              >✕</button>
            </div>
            <div className="shortcuts-modal__list">
              <div className="shortcuts-modal__row">
                <div className="shortcuts-modal__keys"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></div>
                <span>{t('shortcuts.generate')}</span>
              </div>
              <div className="shortcuts-modal__row">
                <div className="shortcuts-modal__keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd></div>
                <span>{t('shortcuts.generateAndRun')}</span>
              </div>
              <div className="shortcuts-modal__row">
                <div className="shortcuts-modal__keys"><kbd>Ctrl</kbd>+<kbd>Z</kbd></div>
                <span>{t('shortcuts.undo')}</span>
              </div>
              <div className="shortcuts-modal__row">
                <div className="shortcuts-modal__keys"><kbd>Ctrl</kbd>+<kbd>Y</kbd></div>
                <span>{t('shortcuts.redo')}</span>
              </div>
              <div className="shortcuts-modal__row">
                <div className="shortcuts-modal__keys"><kbd>?</kbd></div>
                <span>{t('shortcuts.title')}</span>
              </div>
              <div className="shortcuts-modal__row">
                <div className="shortcuts-modal__keys"><kbd>Ctrl</kbd>+<kbd>,</kbd></div>
                <span>{t('shortcuts.openSettings')}</span>
              </div>
              <div className="shortcuts-modal__row">
                <div className="shortcuts-modal__keys"><kbd>Esc</kbd></div>
                <span>{t('shortcuts.close')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings modal ───────────────────── */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {/* ── Toast notifications ─────────────── */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
