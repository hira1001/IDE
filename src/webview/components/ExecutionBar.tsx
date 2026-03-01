import React from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowStatus, DryRunResult } from '../../types/index.js';

interface ExecutionBarProps {
  status: WorkflowStatus;
  dryRunResult: DryRunResult | null;
  totalCost: number;
  currentStep?: number;
  totalSteps?: number;
  /** Count of completed tasks across all steps (for progress display). */
  completedTasks?: number;
  totalTasks?: number;
  onPreview: () => void;
  onRun: () => void;
  onStop: () => void;
  onResume: () => void;
  onSaveTemplate: () => void;
  onRerunFromStep?: (fromStep: number) => void;
  onGeneratePlan?: () => void;
  isGeneratingPlan?: boolean;
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
  onRerunFromStep,
  currentStep,
  totalSteps,
  completedTasks,
  totalTasks,
  onPreview,
  onRun,
  onStop,
  onResume,
  onSaveTemplate,
  onGeneratePlan,
  isGeneratingPlan,
}: ExecutionBarProps) {
  const { t } = useTranslation();

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isFinished = status === 'completed' || status === 'error' || status === 'aborted';

  // Progress percentage based on completed tasks
  const progressPct = totalTasks && totalTasks > 0
    ? Math.round(((completedTasks ?? 0) / totalTasks) * 100)
    : totalSteps && totalSteps > 0
      ? Math.round(((currentStep ?? 0) / totalSteps) * 100)
      : 0;
  const showProgress = (isRunning || isPaused) && totalSteps !== undefined && totalSteps > 0;

  return (
    <>
      {/* Progress bar (full width, above the bar) */}
      {showProgress && (
        <div className="execution-bar__progress-track" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="execution-bar__progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      <div className="execution-bar">
        {/* Left: status pill + cost */}
        <div className="execution-bar__left">
          <span className={`execution-bar__status-pill pill--${status}`}>
            {isRunning && (
              <span className="execution-bar__spinner" aria-hidden="true" />
            )}
            {STATUS_LABELS[status]}
          </span>

          {/* Step + task progress during run */}
          {showProgress && (
            <span className="execution-bar__step-progress" aria-label={`Step ${(currentStep ?? 0) + 1} of ${totalSteps}`}>
              Step {(currentStep ?? 0) + 1}/{totalSteps}
              {totalTasks !== undefined && totalTasks > 0 && (
                <> · {completedTasks ?? 0}/{totalTasks} tasks</>
              )}
              {' '}
              <span className="execution-bar__pct">{progressPct}%</span>
            </span>
          )}

          {/* Cost section */}
          <div className="execution-bar__costs">
            {dryRunResult && !totalCost && (
              <span className="execution-bar__cost execution-bar__cost--est">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M6 3.5v3l2 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                ${dryRunResult.estimated_min_cost_usd.toFixed(4)}–${dryRunResult.estimated_max_cost_usd.toFixed(4)}
                <span className="execution-bar__cost-label">{t('cost.estimated')}</span>
              </span>
            )}
            {totalCost > 0 && (
              <span className="execution-bar__cost execution-bar__cost--actual">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <circle cx="6" cy="6" r="5" fill="currentColor" opacity="0.2" />
                  <path d="M4 6.5l1.5 1.5L8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                ${totalCost.toFixed(4)}
                <span className="execution-bar__cost-label">Actual</span>
              </span>
            )}
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="execution-bar__actions">
          {status === 'error' && onRerunFromStep && currentStep !== undefined && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => onRerunFromStep(currentStep)}
              title={`Re-run from step ${currentStep + 1}`}
              aria-label={`Re-run workflow from step ${currentStep + 1}`}>
              ↩ Re-run from step {currentStep + 1}
            </button>
          )}

          {isFinished && (
            <button className="btn btn--ghost btn--sm" onClick={onSaveTemplate} title={t('app.saveTemplate')}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 2h8l2 2v8H2V2zm4 7V6m-2 2l2 2 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('app.saveTemplate')}
            </button>
          )}

          {!isRunning && !isPaused && (
            <button className="btn btn--secondary btn--sm" onClick={onPreview}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M1 7s2.5-4.5 6-4.5S13 7 13 7s-2.5 4.5-6 4.5S1 7 1 7z" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              {t('app.preview')}
            </button>
          )}

          {!isRunning && !isPaused && onGeneratePlan && (
            <button
              className="btn btn--accent btn--sm"
              onClick={onGeneratePlan}
              disabled={isGeneratingPlan}
              title={t('app.plan') || 'Plan'}
            >
              {isGeneratingPlan ? (
                <span className="spinner" style={{ width: 12, height: 12 }} />
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M3 2h8v10H3V2z" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M5 5h4M5 7h4M5 9h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                </svg>
              )}
              {t('app.plan') || 'Plan'}
            </button>
          )}

          {(isRunning || isPaused) && (
            <button className="btn btn--danger btn--sm" onClick={onStop}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
              </svg>
              {t('app.stop')}
            </button>
          )}

          {isPaused && (
            <button className="btn btn--primary btn--sm" onClick={onResume}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M3 2l8 4-8 4V2z" fill="currentColor" />
              </svg>
              {t('app.resume')}
            </button>
          )}

          {!isRunning && !isPaused && (
            <button className="btn btn--blue btn--sm" onClick={onRun}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M3 2l8 4-8 4V2z" fill="currentColor" />
              </svg>
              {t('app.planAndRun') || 'Plan & Run'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
