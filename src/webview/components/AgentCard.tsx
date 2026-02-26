import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Agent, Task, TaskState, OutputFormat, LLMModel, WorkflowConfig } from '../../types/index.js';

const LLM_MODELS: LLMModel[] = [
  'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo',
  'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5',
  'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash',
];

const OUTPUT_FORMATS: OutputFormat[] = ['Markdown', 'Mermaid', 'JSON', 'PlainText', 'Code'];

interface AgentCardProps {
  agent: Agent;
  task: Task;
  taskState?: TaskState;
  output?: string;
  config: WorkflowConfig;
  onUpdateAgent: (agent: Agent) => void;
  onUpdateTask: (task: Task) => void;
  onRetry: () => void;
  onDelete: () => void;
}

export function AgentCard({
  agent,
  task,
  taskState,
  output,
  config,
  onUpdateAgent,
  onUpdateTask,
  onRetry,
  onDelete,
}: AgentCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editingOutput, setEditingOutput] = useState(false);
  const [editedOutput, setEditedOutput] = useState(output ?? '');

  const status = taskState?.status ?? 'idle';

  const statusStyles: Record<string, string> = {
    idle: 'card--idle',
    running: 'card--running',
    validating: 'card--validating',
    retrying: 'card--retrying',
    paused: 'card--paused',
    completed: 'card--completed',
    error: 'card--error',
    skipped: 'card--skipped',
    aborted: 'card--aborted',
  };

  const statusIcon: Record<string, string> = {
    idle: '',
    running: '⟳',
    validating: '🔍',
    retrying: '🔄',
    paused: '⏸',
    completed: '✅',
    error: '⚠️',
    skipped: '⏭',
    aborted: '⏹',
  };

  const updateInstruction = (idx: number, value: string) => {
    const instructions = [...task.instructions];
    instructions[idx] = value;
    onUpdateTask({ ...task, instructions });
  };

  const addInstruction = () => {
    onUpdateTask({ ...task, instructions: [...task.instructions, ''] });
  };

  const removeInstruction = (idx: number) => {
    onUpdateTask({ ...task, instructions: task.instructions.filter((_, i) => i !== idx) });
  };

  const updateConstraint = (idx: number, value: string) => {
    const constraints = [...task.constraints];
    constraints[idx] = value;
    onUpdateTask({ ...task, constraints });
  };

  const addConstraint = () => {
    onUpdateTask({ ...task, constraints: [...task.constraints, ''] });
  };

  const removeConstraint = (idx: number) => {
    onUpdateTask({ ...task, constraints: task.constraints.filter((_, i) => i !== idx) });
  };

  return (
    <div className={`agent-card ${statusStyles[status] ?? ''}`}>
      {/* Card Header */}
      <div className="agent-card__header" onClick={() => setExpanded((e) => !e)}>
        <span className="agent-card__drag">⠿</span>
        <span className="agent-card__icon">🤖</span>
        <span className="agent-card__name">{agent.name}</span>
        <span className="agent-card__model-badge">{agent.model}</span>
        {statusIcon[status] && (
          <span className="agent-card__status-icon">{statusIcon[status]}</span>
        )}
        <span className="agent-card__status-label">{t(`card.status.${status}`)}</span>
        <button
          className="agent-card__delete"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
        >
          🗑️
        </button>
      </div>

      {/* Summary line (collapsed) */}
      {!expanded && (
        <div className="agent-card__summary">
          {task.task_name} — {task.output_format}
          {taskState?.input_tokens !== undefined && (
            <span className="agent-card__tokens">
              {' '}· {taskState.input_tokens + (taskState.output_tokens ?? 0)} tokens
            </span>
          )}
        </div>
      )}

      {/* Expanded Editor */}
      {expanded && (
        <div className="agent-card__editor">
          {/* Agent Name */}
          <label className="field-label">{t('card.name')}</label>
          <input
            className="field-input"
            value={agent.name}
            onChange={(e) => onUpdateAgent({ ...agent, name: e.target.value })}
          />

          {/* Persona */}
          <label className="field-label">{t('card.persona')}</label>
          <textarea
            className="field-textarea"
            rows={3}
            value={agent.persona}
            onChange={(e) => onUpdateAgent({ ...agent, persona: e.target.value })}
          />

          {/* Task Name */}
          <label className="field-label">Task Name</label>
          <input
            className="field-input"
            value={task.task_name}
            onChange={(e) => onUpdateTask({ ...task, task_name: e.target.value })}
          />

          {/* Instructions */}
          <label className="field-label">{t('card.instructions')}</label>
          {task.instructions.map((inst, idx) => (
            <div key={idx} className="field-list-row">
              <input
                className="field-input field-input--grow"
                value={inst}
                onChange={(e) => updateInstruction(idx, e.target.value)}
              />
              <button onClick={() => removeInstruction(idx)}>🗑️</button>
            </div>
          ))}
          <button className="btn-link" onClick={addInstruction}>{t('card.addInstruction')}</button>

          {/* Constraints */}
          <label className="field-label">{t('card.constraints')}</label>
          {task.constraints.map((c, idx) => (
            <div key={idx} className="field-list-row">
              <input
                className="field-input field-input--grow"
                value={c}
                onChange={(e) => updateConstraint(idx, e.target.value)}
              />
              <button onClick={() => removeConstraint(idx)}>✕</button>
            </div>
          ))}
          <button className="btn-link" onClick={addConstraint}>{t('card.addConstraint')}</button>

          {/* Output Key */}
          <label className="field-label">{t('card.outputKey')}</label>
          <input
            className="field-input"
            value={task.output_key}
            onChange={(e) => onUpdateTask({ ...task, output_key: e.target.value })}
          />

          {/* Output Format */}
          <label className="field-label">{t('card.outputFormat')}</label>
          <select
            className="field-select"
            value={task.output_format}
            onChange={(e) => onUpdateTask({ ...task, output_format: e.target.value as OutputFormat })}
          >
            {OUTPUT_FORMATS.map((fmt) => (
              <option key={fmt} value={fmt}>{fmt}</option>
            ))}
          </select>

          {/* Model */}
          <label className="field-label">{t('card.model')}</label>
          <select
            className="field-select"
            value={agent.model}
            onChange={(e) => onUpdateAgent({ ...agent, model: e.target.value as LLMModel })}
          >
            {LLM_MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {/* Handover Note */}
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={task.enable_handover_note}
              onChange={(e) => onUpdateTask({ ...task, enable_handover_note: e.target.checked })}
            />
            {' '}{t('card.handoverNote')}
          </label>

          {/* Completed: Output Preview */}
          {status === 'completed' && output && (
            <div className="agent-card__output">
              <div className="agent-card__output-header">
                <span>Output Preview</span>
                <button className="btn-link" onClick={() => setEditingOutput((v) => !v)}>
                  {editingOutput ? '✓ Done' : t('card.editOutput')}
                </button>
              </div>
              {editingOutput ? (
                <textarea
                  className="field-textarea field-textarea--output"
                  rows={8}
                  value={editedOutput}
                  onChange={(e) => setEditedOutput(e.target.value)}
                />
              ) : (
                <pre className="agent-card__output-preview">{output.slice(0, 300)}{output.length > 300 ? '…' : ''}</pre>
              )}

              {taskState?.validation_result && (
                <div className={`validation-badge validation-badge--${taskState.validation_result}`}>
                  {taskState.validation_result === 'pass' && '✅ Format OK'}
                  {taskState.validation_result === 'retried_pass' && '⚠️ Format fixed on retry'}
                  {taskState.validation_result === 'fail' && '❌ Format validation failed'}
                </div>
              )}

              {taskState?.input_tokens !== undefined && (
                <div className="agent-card__metrics">
                  Input: {taskState.input_tokens} / Output: {taskState.output_tokens} tokens
                  {taskState.duration_ms !== undefined && ` · ${(taskState.duration_ms / 1000).toFixed(1)}s`}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {status === 'error' && taskState?.error_message && (
            <div className="agent-card__error">{taskState.error_message}</div>
          )}

          {/* Action buttons */}
          <div className="agent-card__actions">
            {(status === 'completed' || status === 'error') && (
              <button className="btn btn--secondary" onClick={onRetry}>
                🔄 {t('card.retry')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
