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

const STATUS_LABELS: Record<WorkflowStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  error: 'Error',
  aborted: 'Aborted',
};

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
  const isIdle = status === 'idle';
  const isFinished = status === 'completed' || status === 'error' || status === 'aborted';

  return (
    <div className="execution-bar">
      {/* Left: status pill + cost */}
      <div className="execution-bar__left">
        <span className={`execution-bar__status-pill pill--${status}`}>
          {isRunning && (
            <span className="execution-bar__spinner" aria-hidden="true" />
          )}
          {STATUS_LABELS[status]}
        </span>

        {/* Cost section */}
        <div className="execution-bar__costs">
          {dryRunResult && !totalCost && (
            <span className="execution-bar__cost execution-bar__cost--est">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M6 3.5v3l2 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              ${dryRunResult.estimated_min_cost_usd.toFixed(4)}–${dryRunResult.estimated_max_cost_usd.toFixed(4)}
              <span className="execution-bar__cost-label">{t('cost.estimated')}</span>
            </span>
          )}
          {totalCost > 0 && (
            <span className="execution-bar__cost execution-bar__cost--actual">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="5" fill="currentColor" opacity="0.2"/>
                <path d="M4 6.5l1.5 1.5L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              ${totalCost.toFixed(4)}
              <span className="execution-bar__cost-label">Actual</span>
            </span>
          )}
        </div>
      </div>

      {/* Right: action buttons */}
      <div className="execution-bar__actions">
        {isFinished && (
          <button className="btn btn--ghost btn--sm" onClick={onSaveTemplate} title={t('app.saveTemplate')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2h8l2 2v8H2V2zm4 7V6m-2 2l2 2 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t('app.saveTemplate')}
          </button>
        )}

        {!isRunning && !isPaused && (
          <button className="btn btn--secondary btn--sm" onClick={onPreview}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M1 7s2.5-4.5 6-4.5S13 7 13 7s-2.5 4.5-6 4.5S1 7 1 7z" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            {t('app.preview')}
          </button>
        )}

        {(isRunning || isPaused) && (
          <button className="btn btn--danger btn--sm" onClick={onStop}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor"/>
            </svg>
            {t('app.stop')}
          </button>
        )}

        {isPaused && (
          <button className="btn btn--primary btn--sm" onClick={onResume}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 2l8 4-8 4V2z" fill="currentColor"/>
            </svg>
            {t('app.resume')}
          </button>
        )}

        {!isRunning && !isPaused && (
          <button className="btn btn--primary btn--sm" onClick={onRun}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 2l8 4-8 4V2z" fill="currentColor"/>
            </svg>
            {t('app.run')}
          </button>
        )}
      </div>
    </div>
  );
}
