import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Agent, Task, TaskState, OutputFormat, LLMModel, WorkflowConfig, InputSource } from '../../types/index.js';
import { useVSCode } from '../hooks/useVSCode.js';

const LLM_MODEL_GROUPS: { label: string; models: LLMModel[] }[] = [
  {
    label: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  },
  {
    label: 'Anthropic',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
  },
  {
    label: 'Google',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  },
  {
    label: 'Local (Ollama)',
    models: ['ollama:llama3.2', 'ollama:llama3.1', 'ollama:mistral', 'ollama:deepseek-coder', 'ollama:qwen2.5', 'ollama:gemma2'],
  },
];
const OUTPUT_FORMATS: OutputFormat[] = ['Markdown', 'Mermaid', 'JSON', 'PlainText', 'Code'];

const STATUS_FALLBACK: Record<string, string> = {
  idle: 'Idle', running: 'Running', validating: 'Validating',
  retrying: 'Retrying', paused: 'Paused', completed: 'Done',
  error: 'Error', skipped: 'Skipped', aborted: 'Aborted',
};
const STATUS_ICON: Record<string, string> = {
  validating: '🔍', retrying: '🔄', paused: '⏸',
  completed: '✅', error: '⚠️', skipped: '⏭', aborted: '⏹',
};

interface AgentCardProps {
  agent: Agent;
  task: Task;
  taskState?: TaskState;
  output?: string;
  config?: WorkflowConfig;
  onUpdateAgent: (agent: Agent) => void;
  onUpdateTask: (task: Task) => void;
  onRetry: () => void;
  onDelete: () => void;
  // Drag & drop
  taskIndex?: number;
  isDragOver?: boolean;
  onDragStart?: (index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDrop?: (e: React.DragEvent, index: number) => void;
  onDragEnd?: () => void;
  // Toast callback for clipboard feedback
  onToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function AgentCard({
  agent, task, taskState, output, config,
  onUpdateAgent, onUpdateTask, onRetry, onDelete,
  taskIndex, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd,
  onToast,
}: AgentCardProps) {
  const { t } = useTranslation();
  const { postMessage } = useVSCode();
  const [expanded, setExpanded] = useState(false);
  const [editingOutput, setEditingOutput] = useState(false);
  const [editedOutput, setEditedOutput] = useState(output ?? '');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const status = taskState?.status ?? 'idle';
  const isActive = status === 'running' || status === 'validating' || status === 'retrying';

  // Elapsed timer during active execution
  useEffect(() => {
    if (isActive) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isActive]);

  useEffect(() => { setEditedOutput(output ?? ''); }, [output]);

  // Auto-expand when task enters error state
  useEffect(() => {
    if (status === 'error') setExpanded(true);
  }, [status]);

  const updateInstruction = (idx: number, val: string) => {
    const instructions = [...task.instructions]; instructions[idx] = val;
    onUpdateTask({ ...task, instructions });
  };
  const addInstruction = () => onUpdateTask({ ...task, instructions: [...task.instructions, ''] });
  const removeInstruction = (idx: number) => onUpdateTask({ ...task, instructions: task.instructions.filter((_, i) => i !== idx) });

  const updateConstraint = (idx: number, val: string) => {
    const constraints = [...task.constraints]; constraints[idx] = val;
    onUpdateTask({ ...task, constraints });
  };
  const addConstraint = () => onUpdateTask({ ...task, constraints: [...task.constraints, ''] });
  const removeConstraint = (idx: number) => onUpdateTask({ ...task, constraints: task.constraints.filter((_, i) => i !== idx) });

  const updateMapping = (idx: number, updated: InputSource) => {
    const mappings = [...task.input_mapping];
    mappings[idx] = updated;
    onUpdateTask({ ...task, input_mapping: mappings });
  };
  const addMapping = () => {
    const newMapping: InputSource = { from_step: 0, from_agent_id: '__source__', label: 'Source file' };
    onUpdateTask({ ...task, input_mapping: [...task.input_mapping, newMapping] });
  };
  const removeMapping = (idx: number) =>
    onUpdateTask({ ...task, input_mapping: task.input_mapping.filter((_, i) => i !== idx) });

  // Build available output sources from config (all other tasks)
  const availableSources: Array<{ value: string; label: string; from_step: number; from_agent_id: string }> = [
    { value: '__source__', label: 'Source File', from_step: 0, from_agent_id: '__source__' },
  ];
  if (config) {
    for (const step of config.workflow) {
      for (const t of step.tasks) {
        if (t.task_id === task.task_id) continue;
        const a = config.agents.find((ag) => ag.id === t.agent_id);
        availableSources.push({
          value: t.agent_id,
          label: `${a?.name ?? t.agent_id} → ${t.output_key}`,
          from_step: step.step,
          from_agent_id: t.agent_id,
        });
      }
    }
  }

  const initial = agent.name ? agent.name[0].toUpperCase() : '?';

  const handleCopyOutput = () => {
    if (!output) return;
    navigator.clipboard.writeText(output).then(() => {
      onToast?.('Output copied to clipboard', 'success');
    }).catch(() => {
      // Fallback: delegate to extension host clipboard API
      postMessage({ type: 'clipboard:write', payload: { text: output } });
      onToast?.('Output copied to clipboard', 'success');
    });
  };

  const handleSaveOutput = () => {
    if (!output) return;
    postMessage({ type: 'output:save', payload: { output_key: task.output_key, content: output, filename: `${agent.name}_${task.output_key}` } });
  };

  return (
    <div
      className={`agent-card card--${status}${isDragOver ? ' agent-card--drag-over' : ''}`}
      draggable
      onDragStart={() => onDragStart?.(taskIndex ?? 0)}
      onDragOver={(e) => onDragOver?.(e, taskIndex ?? 0)}
      onDrop={(e) => onDrop?.(e, taskIndex ?? 0)}
      onDragEnd={onDragEnd}
    >

      {/* ── Header ── */}
      <button
        type="button"
        className="agent-card__header"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={`${agent.name}: ${task.task_name}`}
      >
        <span className="agent-card__drag" title="Drag to reorder">⠿</span>
        <div className="agent-card__avatar">{initial}</div>

        <div className="agent-card__info">
          <div className="agent-card__name">{agent.name}</div>
          <div className="agent-card__task">{task.task_name}</div>
        </div>

        <div className="agent-card__model">{agent.model}</div>
        <div className="agent-card__status-dot" />

        {isActive && <div className="spinner" />}
        {STATUS_ICON[status] && !isActive && (
          <span style={{ fontSize: 12 }}>{STATUS_ICON[status]}</span>
        )}

        <span className={`agent-card__chevron ${expanded ? 'agent-card__chevron--open' : ''}`}>▼</span>

        {/* Mini action buttons — stop propagation so they don't toggle expand */}
        <div className="agent-card__mini-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {(status === 'completed' || status === 'error') && (
            <button className="card-mini-btn" onClick={onRetry} title={t('card.retry')} aria-label={t('card.retry')}>🔄</button>
          )}
          <button className="card-mini-btn card-mini-btn--danger" onClick={onDelete} title="Delete" aria-label="Delete agent">✕</button>
        </div>
      </button>

      {/* ── Status Strip ── */}
      {status !== 'idle' && (
        <div className="agent-card__status-strip">
          {isActive && <div className="spinner" />}
          <span>{t(`card.status.${status}`, STATUS_FALLBACK[status])}</span>
          {isActive && elapsed > 0 && (
            <span className="agent-card__elapsed">{elapsed}s</span>
          )}
          {!isActive && taskState?.input_tokens !== undefined && (
            <span className="agent-card__elapsed">
              {((taskState.input_tokens ?? 0) + (taskState.output_tokens ?? 0)).toLocaleString()} tok
              {taskState.duration_ms !== undefined && ` · ${(taskState.duration_ms / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>
      )}

      {/* ── Expanded Body ── */}
      {expanded && (
        <div className="agent-card__body">
          <div className="agent-card__editor">

            {/* Agent Name */}
            <div className="field-group">
              <label className="field-label">{t('card.name')}</label>
              <input className="field-input" value={agent.name}
                onChange={(e) => onUpdateAgent({ ...agent, name: e.target.value })} />
            </div>

            {/* Persona */}
            <div className="field-group">
              <label className="field-label">{t('card.persona')}</label>
              <textarea className="field-textarea" rows={2} value={agent.persona}
                onChange={(e) => onUpdateAgent({ ...agent, persona: e.target.value })} />
            </div>

            {/* Task Name */}
            <div className="field-group">
              <label className="field-label">Task</label>
              <input className="field-input" value={task.task_name}
                onChange={(e) => onUpdateTask({ ...task, task_name: e.target.value })} />
            </div>

            {/* Instructions */}
            <div className="field-group">
              <label className="field-label">{t('card.instructions')}</label>
              {task.instructions.map((inst, idx) => (
                <div key={idx} className="field-row" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--aao-muted)', minWidth: 14, textAlign: 'right' }}>{idx + 1}.</span>
                  <input className="field-input field-input--grow" value={inst}
                    onChange={(e) => updateInstruction(idx, e.target.value)} />
                  <button className="card-mini-btn card-mini-btn--danger" onClick={() => removeInstruction(idx)}>✕</button>
                </div>
              ))}
              <button className="btn-link" onClick={addInstruction}>＋ {t('card.addInstruction')}</button>
            </div>

            {/* Constraints */}
            <div className="field-group">
              <label className="field-label">{t('card.constraints')}</label>
              {task.constraints.map((c, idx) => (
                <div key={idx} className="field-row" style={{ marginBottom: 4 }}>
                  <input className="field-input field-input--grow" value={c}
                    onChange={(e) => updateConstraint(idx, e.target.value)} />
                  <button className="card-mini-btn card-mini-btn--danger" onClick={() => removeConstraint(idx)}>✕</button>
                </div>
              ))}
              <button className="btn-link" onClick={addConstraint}>＋ {t('card.addConstraint')}</button>
            </div>

            {/* Input Mapping */}
            <div className="field-group">
              <label className="field-label">{t('card.inputMapping', 'Input Sources')}</label>
              {task.input_mapping.map((mapping, idx) => (
                <div key={idx} className="input-mapping-row">
                  <select
                    className="field-input input-mapping-row__source"
                    value={mapping.from_agent_id}
                    onChange={(e) => {
                      const src = availableSources.find((s) => s.value === e.target.value);
                      if (src) {
                        updateMapping(idx, {
                          ...mapping,
                          from_agent_id: src.from_agent_id,
                          from_step: src.from_step,
                        });
                      }
                    }}
                  >
                    {availableSources.map((src) => (
                      <option key={src.value} value={src.value}>{src.label}</option>
                    ))}
                  </select>
                  <input
                    className="field-input input-mapping-row__label"
                    placeholder="label"
                    value={mapping.label}
                    onChange={(e) => updateMapping(idx, { ...mapping, label: e.target.value })}
                  />
                  <button
                    className="card-mini-btn card-mini-btn--danger"
                    onClick={() => removeMapping(idx)}
                    title="Remove"
                  >✕</button>
                </div>
              ))}
              <button className="btn-link" onClick={addMapping}>
                ＋ {t('card.addInput', 'Add input source')}
              </button>
            </div>

            {/* Output Key + Format (2-col) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="field-group">
                <label className="field-label">{t('card.outputKey')}</label>
                <input className="field-input" value={task.output_key}
                  onChange={(e) => onUpdateTask({ ...task, output_key: e.target.value })} />
              </div>
              <div className="field-group">
                <label className="field-label">{t('card.outputFormat')}</label>
                <select className="field-select" value={task.output_format}
                  onChange={(e) => onUpdateTask({ ...task, output_format: e.target.value as OutputFormat })}>
                  {OUTPUT_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>

            {/* Model */}
            <div className="field-group">
              <label className="field-label">{t('card.model')}</label>
              <select className="field-select" value={agent.model}
                onChange={(e) => onUpdateAgent({ ...agent, model: e.target.value as LLMModel })}>
                {LLM_MODEL_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Handover toggle */}
            <label className="field-checkbox">
              <input type="checkbox" checked={task.enable_handover_note}
                onChange={(e) => onUpdateTask({ ...task, enable_handover_note: e.target.checked })} />
              {t('card.handoverNote')}
            </label>
          </div>

          {/* ── Output preview ── */}
          {status === 'completed' && output && (
            <div className="agent-card__output-section">
              <div className="agent-card__output-header">
                <span className="agent-card__output-title">Output</span>
                <button className="btn btn--ghost btn--xs"
                  onClick={handleCopyOutput}
                  title="Copy output to clipboard"
                  aria-label="Copy output to clipboard">
                  📋
                </button>
                <button className="btn btn--ghost btn--xs"
                  onClick={handleSaveOutput}
                  title="Save output to file"
                  aria-label="Save output to file">
                  💾
                </button>
                <button className="btn btn--ghost btn--xs"
                  onClick={() => setEditingOutput((v) => !v)}>
                  {editingOutput ? '✓ Done' : '✏️ Edit'}
                </button>
              </div>

              {editingOutput
                ? <textarea className="field-textarea field-textarea--mono" rows={7}
                    value={editedOutput} onChange={(e) => setEditedOutput(e.target.value)} />
                : <div className="agent-card__output-preview">{output}</div>
              }

              {taskState?.validation_result && (
                <div className={`vbadge vbadge--${taskState.validation_result}`}>
                  {taskState.validation_result === 'pass' && '✅ Format OK'}
                  {taskState.validation_result === 'retried_pass' && '⚠️ Fixed on retry'}
                  {taskState.validation_result === 'fail' && '❌ Format failed'}
                </div>
              )}

              {taskState?.input_tokens !== undefined && (
                <div className="agent-card__metrics">
                  <span>↑ {taskState.input_tokens?.toLocaleString()}</span>
                  <span>↓ {taskState.output_tokens?.toLocaleString()}</span>
                  {taskState.duration_ms && <span>⏱ {(taskState.duration_ms / 1000).toFixed(1)}s</span>}
                </div>
              )}
            </div>
          )}

          {/* ── Error detail ── */}
          {status === 'error' && taskState?.error_message && (
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--aao-border)' }}>
              <div className="agent-card__error-msg">{taskState.error_message}</div>
            </div>
          )}

          {/* ── Card action row ── */}
          {(status === 'completed' || status === 'error') && (
            <div className="agent-card__card-actions">
              <button className="btn btn--secondary btn--sm" onClick={onRetry}>
                🔄 {t('card.retry')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
