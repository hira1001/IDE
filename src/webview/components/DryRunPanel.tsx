import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DryRunResult } from '../../types/index.js';

interface DryRunPanelProps {
  result: DryRunResult;
  onClose: () => void;
  onExecute: () => void;
}

export function DryRunPanel({ result, onClose, onExecute }: DryRunPanelProps) {
  const { t } = useTranslation();
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const totalTasks = result.steps.reduce((sum, s) => sum + s.tasks.length, 0);

  return (
    <div className="panel-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel-card dry-run-panel">
        {/* Header */}
        <div className="panel-card__header">
          <div className="panel-card__header-left">
            <div className="panel-card__icon panel-card__icon--blue">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 4.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h2 className="panel-card__title">{t('dryrun.title')}</h2>
              <p className="panel-card__subtitle">{totalTasks} tasks · {result.providers.join(', ')}</p>
            </div>
          </div>
          <button className="panel-card__close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Summary stats */}
        <div className="dry-run-summary">
          <div className="dry-run-summary__stat">
            <span className="dry-run-summary__label">{t('dryrun.estimatedTokens')}</span>
            <span className="dry-run-summary__value">
              ~{result.total_min_tokens.toLocaleString()}
              <span className="dry-run-summary__range">–{result.total_max_tokens.toLocaleString()}</span>
            </span>
          </div>
          <div className="dry-run-summary__divider" />
          <div className={`dry-run-summary__stat ${result.estimated_max_cost_usd > 1 ? 'dry-run-summary__stat--warning' : ''}`}>
            <span className="dry-run-summary__label">{t('dryrun.estimatedCost')}</span>
            <span className="dry-run-summary__value dry-run-summary__value--cost">
              {result.estimated_max_cost_usd === 0 && result.providers.includes('ollama') ? (
                'Free (Local)'
              ) : (
                <>
                  ${result.estimated_min_cost_usd.toFixed(4)}
                  <span className="dry-run-summary__range">–${result.estimated_max_cost_usd.toFixed(4)}</span>
                </>
              )}
            </span>
          </div>
          <div className="dry-run-summary__divider" />
          <div className="dry-run-summary__stat">
            <span className="dry-run-summary__label">{t('dryrun.providers')}</span>
            <span className="dry-run-summary__value">{result.providers.join(', ')}</span>
          </div>
        </div>

        {/* Step / task list */}
        <div className="dry-run-steps">
          {result.steps.map((step) => (
            <div key={step.step} className="dry-run-step">
              <div className="dry-run-step__header">
                <span className={`step-type-badge step-type-badge--${step.type}`}>{step.type}</span>
                <span className="dry-run-step__label">Step {step.step}</span>
                <span className="dry-run-step__count">{step.tasks.length} task{step.tasks.length !== 1 ? 's' : ''}</span>
              </div>

              {step.tasks.map((task) => (
                <div key={task.task_id} className="dry-run-task">
                  <button
                    className="dry-run-task__header"
                    onClick={() => setExpandedTask(expandedTask === task.task_id ? null : task.task_id)}
                    aria-expanded={expandedTask === task.task_id}
                  >
                    <span className="dry-run-task__name">{task.task_name}</span>
                    <span className="dry-run-task__meta">
                      <span className="dry-run-task__model-badge">{task.model}</span>
                      <span className="dry-run-task__tokens">
                        ~{task.estimated_input_tokens.toLocaleString()} tok
                      </span>
                    </span>
                    <svg
                      className={`dry-run-task__chevron${expandedTask === task.task_id ? ' dry-run-task__chevron--open' : ''}`}
                      width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                    >
                      <path d="M3.5 5.5L7 9l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {expandedTask === task.task_id && (
                    <div className="dry-run-task__preview">
                      <div className="dry-run-task__prompt-section">
                        <div className="dry-run-task__prompt-label">System</div>
                        <pre className="dry-run-task__prompt-text">
                          {task.system_prompt.slice(0, 500)}{task.system_prompt.length > 500 ? '…' : ''}
                        </pre>
                      </div>
                      <div className="dry-run-task__prompt-section">
                        <div className="dry-run-task__prompt-label">User</div>
                        <pre className="dry-run-task__prompt-text">
                          {task.user_prompt.slice(0, 300)}{task.user_prompt.length > 300 ? '…' : ''}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="panel-card__footer">
          <button className="btn btn--ghost" onClick={onClose}>{t('dryrun.close')}</button>
          <button className="btn btn--primary" onClick={onExecute}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M2.5 2l9 4.5-9 4.5V2z" fill="currentColor" />
            </svg>
            {t('dryrun.executeNow')}
          </button>
        </div>
      </div>
    </div>
  );
}
