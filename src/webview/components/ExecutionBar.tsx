import React from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowStatus, DryRunResult } from '../../types/index.js';

interface ExecutionBarProps {
  status: WorkflowStatus;
  dryRunResult: DryRunResult | null;
  totalCost: number;
  onPreview: () => void;
  onRun: () => void;
  onStop: () => void;
  onResume: () => void;
  onSaveTemplate: () => void;
}

export function ExecutionBar({
  status,
  dryRunResult,
  totalCost,
  onPreview,
  onRun,
  onStop,
  onResume,
  onSaveTemplate,
}: ExecutionBarProps) {
  const { t } = useTranslation();

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isCompleted = status === 'completed' || status === 'error' || status === 'aborted';

  return (
    <div className="execution-bar">
      {/* Cost display */}
      {dryRunResult && (
        <span className="execution-bar__cost">
          💰 {t('cost.estimated')}: ${dryRunResult.estimated_min_cost_usd.toFixed(4)}–${dryRunResult.estimated_max_cost_usd.toFixed(4)}
        </span>
      )}
      {totalCost > 0 && (
        <span className="execution-bar__cost execution-bar__cost--actual">
          💰 Actual: ${totalCost.toFixed(4)}
        </span>
      )}

      <div className="execution-bar__actions">
        {/* Template buttons */}
        {isCompleted && (
          <button className="btn btn--secondary btn--sm" onClick={onSaveTemplate}>
            💾 {t('app.saveTemplate')}
          </button>
        )}

        {/* Preview */}
        {!isRunning && !isPaused && (
          <button className="btn btn--secondary" onClick={onPreview}>
            👁 {t('app.preview')}
          </button>
        )}

        {/* Stop (during execution) */}
        {(isRunning || isPaused) && (
          <button className="btn btn--danger" onClick={onStop}>
            ⏹ {t('app.stop')}
          </button>
        )}

        {/* Resume (during pause) */}
        {isPaused && (
          <button className="btn btn--primary" onClick={onResume}>
            ▶ {t('app.resume')}
          </button>
        )}

        {/* Run */}
        {!isRunning && !isPaused && (
          <button className="btn btn--primary" onClick={onRun}>
            ▶ {t('app.run')}
          </button>
        )}
      </div>
    </div>
  );
}
