import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowState } from './hooks/useWorkflowState.js';
import { PipelineView } from './components/PipelineView.js';
import { ExecutionBar } from './components/ExecutionBar.js';
import { DryRunPanel } from './components/DryRunPanel.js';
import { BreakpointPanel } from './components/BreakpointPanel.js';
import { TemplateSaveDialog } from './components/TemplateSaveDialog.js';
import { TemplateSelector } from './components/TemplateSelector.js';
import { WorkflowTemplate } from '../types/index.js';

export function App() {
  const { t } = useTranslation();
  const {
    config,
    executionState,
    source,
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
    postMessage,
  } = useWorkflowState();

  const [instruction, setInstruction] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [pausedOutputs, setPausedOutputs] = useState<Record<string, string> | null>(null);

  const status = executionState?.status ?? 'idle';
  const taskStates = executionState?.task_states ?? {};
  const outputStore = executionState?.output_store ?? {};
  const totalCost = executionState?.total_cost_usd ?? 0;

  // Detect pause state
  React.useEffect(() => {
    if (status === 'paused' && executionState) {
      setPausedOutputs(executionState.output_store);
    } else {
      setPausedOutputs(null);
    }
  }, [status, executionState]);

  const handleGenerate = () => {
    if (!instruction.trim()) return;
    generateWorkflow(instruction);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleGenerate();
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
    // Apply manual edits
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
    <div className="app">
      {/* Header */}
      <div className="app__header">
        <h1 className="app__title">🤖 {t('app.title')}</h1>
      </div>

      {/* Chat Input */}
      <div className="app__chat">
        <div className="chat-input-row">
          <textarea
            className="chat-input"
            placeholder={t('app.chatPlaceholder')}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
          />
          <div className="chat-input-buttons">
            <button
              className="btn btn--icon"
              onClick={handleOpenTemplates}
              title={t('app.loadTemplate')}
            >
              📂
            </button>
            {config && (
              <button
                className="btn btn--icon"
                onClick={() => setShowSaveDialog(true)}
                title={t('app.saveTemplate')}
              >
                💾
              </button>
            )}
            <button
              className="btn btn--primary"
              onClick={handleGenerate}
              disabled={isGenerating || !instruction.trim()}
            >
              {isGenerating ? '⟳' : t('app.generate')}
            </button>
          </div>
        </div>

        {generationError && (
          <div className="error-message">⚠️ {generationError}</div>
        )}
      </div>

      {/* Source Indicator */}
      {source ? (
        <div className="source-indicator">
          📎 {t('app.sourceIndicator')}: {source.filename} ({source.language_id}, {source.line_count} lines)
        </div>
      ) : (
        <div className="source-indicator source-indicator--empty">
          ⚠️ {t('app.noSource')}
        </div>
      )}

      {/* Pipeline */}
      {config && (
        <PipelineView
          config={config}
          taskStates={taskStates}
          outputStore={outputStore}
          onChange={setConfig}
          onRetryTask={(taskId) => retryTask(taskId, config)}
        />
      )}

      {/* Execution Bar (sticky) */}
      {config && (
        <ExecutionBar
          status={status}
          dryRunResult={dryRunResult}
          totalCost={totalCost}
          onPreview={handlePreview}
          onRun={handleRun}
          onStop={abortWorkflow}
          onResume={resumeFromPause}
          onSaveTemplate={() => setShowSaveDialog(true)}
        />
      )}

      {/* Dry Run Panel */}
      {dryRunResult && (
        <DryRunPanel
          result={dryRunResult}
          onClose={clearDryRun}
          onExecute={handleDryRunExecute}
        />
      )}

      {/* Breakpoint Panel */}
      {pausedOutputs && (
        <BreakpointPanel
          stepNumber={executionState?.current_step ?? 0}
          outputs={pausedOutputs}
          onContinue={handleContinueFromPause}
          onAbort={abortWorkflow}
        />
      )}

      {/* Template Save Dialog */}
      {showSaveDialog && config && (
        <TemplateSaveDialog
          config={config}
          onClose={() => setShowSaveDialog(false)}
        />
      )}

      {/* Template Selector */}
      {showTemplateSelector && (
        <TemplateSelector
          templates={templates}
          onSelect={handleLoadTemplate}
          onClose={() => setShowTemplateSelector(false)}
        />
      )}
    </div>
  );
}
