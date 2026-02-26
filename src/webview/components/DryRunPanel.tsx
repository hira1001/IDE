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

  return (
    <div className="panel-overlay">
      <div className="dry-run-panel">
        <h2>{t('dryrun.title')}</h2>

        {result.steps.map((step) => (
          <div key={step.step} className="dry-run-step">
            <div className="dry-run-step__header">
              ── Step {step.step} ({step.type}) ──
            </div>
            {step.tasks.map((task) => (
              <div key={task.task_id} className="dry-run-task">
                <div
                  className="dry-run-task__header"
                  onClick={() => setExpandedTask(expandedTask === task.task_id ? null : task.task_id)}
                >
                  📄 {task.task_name} ({task.agent_name} / {task.model})
                  <span className="dry-run-task__tokens">
                    ~{task.estimated_input_tokens.toLocaleString()} tokens input
                  </span>
                  <span className="dry-run-task__expand">
                    {expandedTask === task.task_id ? '▲' : '▼'} プレビュー
                  </span>
                </div>
                {expandedTask === task.task_id && (
                  <div className="dry-run-task__preview">
                    <strong>System Prompt:</strong>
                    <pre>{task.system_prompt.slice(0, 500)}{task.system_prompt.length > 500 ? '…' : ''}</pre>
                    <strong>User Prompt:</strong>
                    <pre>{task.user_prompt.slice(0, 300)}{task.user_prompt.length > 300 ? '…' : ''}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        <div className="dry-run-summary">
          <div className="dry-run-summary__row">
            <span>📊 {t('dryrun.estimatedTokens')}:</span>
            <span>
              ~{result.total_min_tokens.toLocaleString()} ({t('dryrun.min')}) /
              ~{result.total_max_tokens.toLocaleString()} ({t('dryrun.max')})
            </span>
          </div>
          <div className="dry-run-summary__row">
            <span>💰 {t('dryrun.estimatedCost')}:</span>
            <span>
              ${result.estimated_min_cost_usd.toFixed(4)} ~ ${result.estimated_max_cost_usd.toFixed(4)}
            </span>
          </div>
          <div className="dry-run-summary__row">
            <span>⚡ {t('dryrun.providers')}:</span>
            <span>{result.providers.join(', ')}</span>
          </div>
        </div>

        <div className="dry-run-panel__actions">
          <button className="btn btn--secondary" onClick={onClose}>{t('dryrun.close')}</button>
          <button className="btn btn--primary" onClick={onExecute}>{t('dryrun.executeNow')}</button>
        </div>
      </div>
    </div>
  );
}
