import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowState } from './hooks/useWorkflowState.js';
import { PipelineView } from './components/PipelineView.js';
import { ExecutionBar } from './components/ExecutionBar.js';
import { DryRunPanel } from './components/DryRunPanel.js';
import { BreakpointPanel } from './components/BreakpointPanel.js';
import { TemplateSaveDialog } from './components/TemplateSaveDialog.js';
import { TemplateSelector } from './components/TemplateSelector.js';
import { ToastContainer, ToastItem } from './components/Toast.js';
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
    generateWorkflow,
    executeWorkflow,
    abortWorkflow,
    retryTask,
    resumeFromPause,
    dryRun,
    manualEditOutput,
    loadTemplates,
    setConfig,
    clearDryRun,
    setContextMode,
    refreshContext,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useWorkflowState();

  const [instruction, setInstruction] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [pausedOutputs, setPausedOutputs] = useState<Record<string, string> | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const status = executionState?.status ?? 'idle';
  const taskStates = executionState?.task_states ?? {};
  const outputStore = executionState?.output_store ?? {};
  const totalCost = executionState?.total_cost_usd ?? 0;

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
    if (status === 'aborted') addToast('Workflow aborted', 'info');
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
    generateWorkflow(instruction);
  };

  const handleGenerateAndRun = () => {
    if (!instruction.trim()) return;
    pendingAutoRunRef.current = true;
    generateWorkflow(instruction);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (e.shiftKey) {
        handleGenerateAndRun();
      } else {
        handleGenerate();
      }
    }
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
        </div>
      </header>

      {/* ── Chat / MetaAI input ─────────────────── */}
      <div className="app__chat">
        <div className="chat-input-wrapper">
          <textarea
            className="chat-input"
            placeholder={t('app.chatPlaceholder')}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={isGenerating}
          />
          <button
            className={`chat-send-btn${isGenerating ? ' chat-send-btn--loading' : ''}`}
            onClick={handleGenerate}
            disabled={isGenerating || !instruction.trim()}
            aria-label={t('app.generate')}
          >
            {isGenerating ? (
              <span className="chat-send-btn__spinner" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M14 8L2 2l3 6-3 6 12-6z" fill="currentColor"/>
              </svg>
            )}
          </button>
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
          </div>
        )}

        {generationError && (
          <div className="error-message" role="alert">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M7 4.5v3M7 9.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            {generationError}
            <button
              className="btn btn--ghost btn--xs"
              onClick={handleGenerate}
              style={{ marginLeft: 8 }}
            >
              Retry
            </button>
          </div>
        )}
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
          onChange={setConfig}
          onRetryTask={(taskId) => retryTask(taskId, config)}
          onToast={addToast}
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
          <p className="empty-state__text">{t('app.emptyState') || 'Describe your workflow above to get started'}</p>
          <p className="empty-state__sub">{t('app.emptyStateSub') || 'or load an existing template'}</p>
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
          onPreview={handlePreview}
          onRun={handleRun}
          onStop={abortWorkflow}
          onResume={resumeFromPause}
          onSaveTemplate={() => setShowSaveDialog(true)}
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
          onSaved={() => { setShowSaveDialog(false); addToast('Template saved', 'success'); }}
        />
      )}

      {showTemplateSelector && (
        <TemplateSelector
          templates={templates}
          onSelect={handleLoadTemplate}
          onClose={() => setShowTemplateSelector(false)}
        />
      )}

      {/* ── Toast notifications ─────────────── */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
