import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Agent, Task, TaskState, OutputFormat, LLMModel, WorkflowConfig, InputSource } from '../../types/index.js';
import { useVSCode } from '../hooks/useVSCode.js';
import { useAutoResize } from '../hooks/useAutoResize.js';
import { ToolCallLog, ToolEvent } from './ToolCallLog.js';
import { AvailableModels, EMPTY_AVAILABLE_MODELS } from '../hooks/useWorkflowState.js';

const ALL_AGENT_TOOLS = [
  'read_file', 'write_file', 'edit_file', 'list_files',
  'search_code', 'get_diagnostics', 'get_definition', 'find_references', 'run_terminal',
] as const;
const OUTPUT_FORMATS: OutputFormat[] = ['Markdown', 'Mermaid', 'JSON', 'PlainText', 'Code'];

const STATUS_FALLBACK: Record<string, string> = {
  idle: 'Idle', running: 'Running', validating: 'Validating',
  retrying: 'Retrying', paused: 'Paused', completed: 'Done',
  error: 'Error', skipped: 'Skipped', aborted: 'Aborted',
  tool_calling: 'Using Tools',
};
const STATUS_ICON: Record<string, string> = {
  validating: '🔍', retrying: '🔄', paused: '⏸',
  completed: '✅', error: '⚠️', skipped: '⏭', aborted: '⏹',
  tool_calling: '🔧',
};

interface AgentCardProps {
  agent: Agent;
  task: Task;
  taskState?: TaskState;
  output?: string;
  /** Live streaming text chunk accumulation (shown while status === 'running'). */
  streamingOutput?: string;
  /** Tool call events for agentic tasks (shown while status === 'tool_calling'). */
  toolEvents?: ToolEvent[];
  config?: WorkflowConfig;
  availableModels?: AvailableModels;
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
  // Settings callback
  onOpenSettings?: () => void;
}

export function AgentCard({
  agent, task, taskState, output, streamingOutput, toolEvents, config,
  availableModels,
  onUpdateAgent, onUpdateTask, onRetry, onDelete,
  taskIndex, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd,
  onToast, onOpenSettings,
}: AgentCardProps) {
  const { t } = useTranslation();
  const { postMessage } = useVSCode();
  const [expanded, setExpanded] = useState(false);
  const [editingOutput, setEditingOutput] = useState(false);
  const [editedOutput, setEditedOutput] = useState(output ?? '');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamingRef = useRef<HTMLDivElement>(null);
  // Start in custom-input mode if current model isn't in any known group
  const [useCustomModel, setUseCustomModel] = useState(() => {
    const m = availableModels ?? EMPTY_AVAILABLE_MODELS;
    const known = [...m.openai, ...m.anthropic, ...m.google, ...m.ollama, ...m.vscodeLM];
    return known.length > 0 && !known.includes(agent.model);
  });

  // Fullscreen instruction modal
  const [showInstructionModal, setShowInstructionModal] = useState(false);
  // Full output viewer modal
  const [showOutputModal, setShowOutputModal] = useState(false);

  // "Draft with AI" panel state
  const [showDraftPanel, setShowDraftPanel] = useState(false);
  const [draftBrief, setDraftBrief] = useState('');
  const [isDraftLoading, setIsDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Auto-resize refs — computed inline to keep hooks at the top level
  const instructionRef = useAutoResize(task.instructions.join('\n\n'), 5);
  const personaRef = useAutoResize(agent.persona, 3);
  const draftBriefRef = useAutoResize(draftBrief, 3);

  const status = taskState?.status ?? 'idle';
  const isActive = status === 'running' || status === 'validating' || status === 'retrying' || status === 'tool_calling';

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

  // Auto-scroll streaming output to bottom
  useEffect(() => {
    if (streamingOutput && streamingRef.current) {
      streamingRef.current.scrollTop = streamingRef.current.scrollHeight;
    }
  }, [streamingOutput]);

  useEffect(() => {
    if (!editingOutput) setEditedOutput(output ?? '');
  }, [output, editingOutput]);

  // Close modals on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showOutputModal) { setShowOutputModal(false); return; }
      if (showInstructionModal) { setShowInstructionModal(false); return; }
      if (showDraftPanel) { setShowDraftPanel(false); }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showOutputModal, showInstructionModal, showDraftPanel]);

  // Resolve effective available models (from props or fallback to empty)
  const effectiveAvailableModels = availableModels ?? EMPTY_AVAILABLE_MODELS;

  // Build grouped model list from available models prop
  const groupedModels = useMemo(() => {
    const m = effectiveAvailableModels;
    const groups: { label: string; models: string[] }[] = [];
    if (m.openai.length)    groups.push({ label: 'OpenAI',       models: m.openai });
    if (m.anthropic.length) groups.push({ label: 'Anthropic',    models: m.anthropic });
    if (m.google.length)    groups.push({ label: 'Google AI',    models: m.google });
    if (m.ollama.length)    groups.push({ label: 'Local (Ollama)', models: m.ollama });
    if (m.vscodeLM.length)  groups.push({ label: 'VS Code LM',   models: m.vscodeLM });
    return groups;
  }, [effectiveAvailableModels]);

  // Detect duplicate output_key within the workflow
  const isDuplicateOutputKey = useMemo(() => {
    if (!config || !task.output_key) return false;
    const allKeys = config.workflow.flatMap((s) => s.tasks.map((t) => t.output_key));
    const count = allKeys.filter((k) => k === task.output_key).length;
    return count > 1;
  }, [config, task.output_key]);

  // Auto-expand when task enters error state
  useEffect(() => {
    if (status === 'error') setExpanded(true);
  }, [status]);

  // Listen for "Draft with AI" response from the extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type: string; payload?: unknown };
      if (msg.type !== 'agent:instruction_drafted') return;
      const p = msg.payload as { task_id: string; instruction?: string; error?: string };
      if (p.task_id !== task.task_id) return;
      setIsDraftLoading(false);
      if (p.error) {
        setDraftError(p.error);
      } else if (p.instruction) {
        onUpdateTask({ ...task, instructions: [p.instruction] });
        setShowDraftPanel(false);
        setDraftBrief('');
        setDraftError(null);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [task, onUpdateTask]);

  const handleDraftInstruction = () => {
    if (!draftBrief.trim() || isDraftLoading) return;
    setIsDraftLoading(true);
    setDraftError(null);
    postMessage({
      type: 'agent:draft_instruction',
      payload: {
        task_id: task.task_id,
        brief: draftBrief,
        agent_name: agent.name,
        persona: agent.persona,
        task_name: task.task_name,
      },
    });
  };

  // Instructions are stored as string[] but edited as a single unified markdown document
  const instructionText = task.instructions.join('\n\n');

  const updateInstructions = (val: string) =>
    onUpdateTask({ ...task, instructions: val ? [val] : [] });

  const updateMapping = (idx: number, updated: InputSource) => {
    const mappings = [...task.input_mapping];
    mappings[idx] = updated;
    onUpdateTask({ ...task, input_mapping: mappings });
  };
  const addMapping = () => {
    const newMapping: InputSource = { from_step: 0, from_agent_id: '__project__', label: 'Project context' };
    onUpdateTask({ ...task, input_mapping: [...task.input_mapping, newMapping] });
  };
  const removeMapping = (idx: number) =>
    onUpdateTask({ ...task, input_mapping: task.input_mapping.filter((_, i) => i !== idx) });

  // Build available output sources from config (all other tasks)
  const availableSources: Array<{ value: string; label: string; from_step: number; from_agent_id: string }> = [
    { value: '__source__', label: 'Active File', from_step: 0, from_agent_id: '__source__' },
    { value: '__project__', label: 'Project Context (tree + files)', from_step: 0, from_agent_id: '__project__' },
    { value: '__tree__', label: 'File Tree Only', from_step: 0, from_agent_id: '__tree__' },
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
    const msg = t('app.copied', 'Copied to clipboard');
    navigator.clipboard.writeText(output).then(() => {
      onToast?.(msg, 'success');
    }).catch(() => {
      // Fallback: delegate to extension host clipboard API
      postMessage({ type: 'clipboard:write', payload: { text: output } });
      onToast?.(msg, 'success');
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
          {!expanded && instructionText && (
            <div className="agent-card__hint">
              {(instructionText.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') ?? '').slice(0, 72)}
              {instructionText.length > 72 ? '…' : ''}
            </div>
          )}
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
              <textarea
                ref={personaRef}
                className="field-textarea field-textarea--autoresize"
                rows={3}
                value={agent.persona}
                placeholder="Describe this agent's role, expertise, tone, and perspective. E.g.: 'You are a senior TypeScript engineer focused on clean, testable code. You prefer explicit types over inference and always consider edge cases.'"
                onChange={(e) => onUpdateAgent({ ...agent, persona: e.target.value })}
              />
            </div>

            {/* Task Name */}
            <div className="field-group">
              <label className="field-label">Task</label>
              <input className="field-input" value={task.task_name}
                onChange={(e) => onUpdateTask({ ...task, task_name: e.target.value })} />
            </div>

            {/* Instructions — single unified markdown document */}
            <div className="field-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label className="field-label" style={{ marginBottom: 0 }}>{t('card.instructions')}</label>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button
                    className="btn btn--ghost btn--xs"
                    onClick={() => setShowInstructionModal(true)}
                    title="Open fullscreen editor"
                    aria-label="Open fullscreen instruction editor"
                    style={{ fontSize: 11 }}
                  >⛶ Expand</button>
                  <button
                    className="btn btn--ghost btn--xs"
                    onClick={() => { setShowDraftPanel((v) => !v); setDraftError(null); }}
                    title="Let AI draft detailed instructions from your brief description"
                    style={{ fontSize: 11, gap: 3 }}
                  >
                    ✨ {showDraftPanel ? 'Close Draft' : 'Draft with AI'}
                  </button>
                </div>
              </div>

              {/* "Draft with AI" inline panel */}
              {showDraftPanel && (
                <div style={{
                  background: 'var(--vscode-editor-inactiveSelectionBackground)',
                  border: '1px solid var(--aao-border)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  marginBottom: 8,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--aao-muted)', marginBottom: 6 }}>
                    Describe what you want this agent to do in plain language. The AI will expand it into a full structured instruction document.
                  </div>
                  <textarea
                    ref={draftBriefRef}
                    className="field-textarea field-textarea--autoresize"
                    rows={3}
                    value={draftBrief}
                    placeholder={`E.g.: "Review the TypeScript file for type safety issues, performance anti-patterns, and missing error handling. For each issue found, provide the line number, severity (critical/major/minor), a clear explanation, and a concrete code fix suggestion. Prioritize critical issues first."`}
                    onChange={(e) => setDraftBrief(e.target.value)}
                    disabled={isDraftLoading}
                    style={{ marginBottom: 6 }}
                  />
                  {draftError && (
                    <div style={{ fontSize: 11, color: 'var(--vscode-errorForeground)', marginBottom: 6 }}>
                      ⚠ {draftError}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={handleDraftInstruction}
                      disabled={!draftBrief.trim() || isDraftLoading}
                    >
                      {isDraftLoading ? '⏳ Generating…' : '✨ Generate Instructions'}
                    </button>
                    {isDraftLoading && (
                      <span style={{ fontSize: 11, color: 'var(--aao-muted)' }}>
                        AI is writing detailed instructions…
                      </span>
                    )}
                  </div>
                </div>
              )}

              <textarea
                ref={instructionRef}
                className="field-textarea field-textarea--autoresize"
                rows={5}
                value={instructionText}
                placeholder={
                  `Write the full task specification here. Markdown is supported.\n\n` +
                  `## Objective\nWhat the agent should accomplish.\n\n` +
                  `## Step-by-step Process\n1. First step\n2. Second step\n\n` +
                  `## Output Requirements\nFormat, structure, and quality expected.\n\n` +
                  `Tip: click "Draft with AI" to generate this from a brief description.`
                }
                onChange={(e) => updateInstructions(e.target.value)}
                style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)', fontSize: 12 }}
              />
              <div style={{ fontSize: 10, color: 'var(--aao-muted)', textAlign: 'right', marginTop: 2 }}>
                {instructionText.length} chars · ~{Math.ceil(instructionText.length / 4)} tokens
              </div>
            </div>

            {/* Constraints */}
            <div className="field-group">
              <label className="field-label">{t('card.constraints')}</label>
              {task.constraints.map((c, idx) => (
                <div key={idx} className="field-row" style={{ marginBottom: 4, alignItems: 'flex-start' }}>
                  <textarea className="field-textarea field-input--grow" rows={2} value={c}
                    placeholder="Add a constraint or requirement. E.g.: 'Output must be valid JSON', 'Do not modify existing tests', 'Keep changes minimal'."
                    onChange={(e) => {
                      const constraints = [...task.constraints]; constraints[idx] = e.target.value;
                      onUpdateTask({ ...task, constraints });
                    }} />
                  <button className="card-mini-btn card-mini-btn--danger" style={{ marginTop: 2 }}
                    onClick={() => onUpdateTask({ ...task, constraints: task.constraints.filter((_, i) => i !== idx) })}>✕</button>
                </div>
              ))}
              <button className="btn-link" onClick={() => onUpdateTask({ ...task, constraints: [...task.constraints, ''] })}>
                ＋ {t('card.addConstraint')}
              </button>
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
                <label className="field-label">
                  {t('card.outputKey')}
                  {isDuplicateOutputKey && (
                    <span
                      className="field-label__warning"
                      title="Duplicate output key — two tasks share this key, later results will overwrite earlier ones"
                      aria-label="Duplicate output key warning"
                    >⚠</span>
                  )}
                </label>
                <input
                  className={`field-input${isDuplicateOutputKey ? ' field-input--warning' : ''}`}
                  value={task.output_key}
                  onChange={(e) => onUpdateTask({ ...task, output_key: e.target.value })}
                />
              </div>
              <div className="field-group">
                <label className="field-label">{t('card.outputFormat')}</label>
                <select className="field-select" value={task.output_format}
                  onChange={(e) => onUpdateTask({ ...task, output_format: e.target.value as OutputFormat })}>
                  {OUTPUT_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>

            {/* Model — dynamic grouped select or custom text input */}
            <div className="field-group">
              <label className="field-label">{t('card.model')}</label>
              {useCustomModel ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    className="field-input"
                    style={{ flex: 1 }}
                    value={agent.model}
                    onChange={(e) => onUpdateAgent({ ...agent, model: e.target.value })}
                    placeholder="e.g. ollama:llama3.2, vscode:gpt-4o"
                    autoFocus
                  />
                  <button
                    className="btn btn--ghost btn--xs"
                    onClick={() => setUseCustomModel(false)}
                    title="Back to list"
                  >← List</button>
                </div>
              ) : groupedModels.length > 0 ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <select
                    className="field-select"
                    style={{ flex: 1 }}
                    value={groupedModels.some((g) => g.models.includes(agent.model)) ? agent.model : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setUseCustomModel(true);
                        return;
                      }
                      onUpdateAgent({ ...agent, model: e.target.value as LLMModel });
                    }}
                  >
                    {groupedModels.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.models.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="__custom__">Custom model name…</option>
                  </select>
                </div>
              ) : (
                <div>
                  <input
                    className="field-input field-input--disabled"
                    value=""
                    disabled
                    placeholder="No models available — configure API keys"
                  />
                  <div className="field-warning">
                    ⚠ No models configured.{' '}
                    {onOpenSettings ? (
                      <button className="btn-link" onClick={onOpenSettings}>
                        Open ⚙ Settings to add API keys
                      </button>
                    ) : (
                      'Open Settings to add API keys.'
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Handover toggle */}
            <label className="field-checkbox">
              <input type="checkbox" checked={task.enable_handover_note}
                onChange={(e) => onUpdateTask({ ...task, enable_handover_note: e.target.checked })} />
              {t('card.handoverNote')}
            </label>

            {/* Agent Mode toggle */}
            <label className="field-checkbox">
              <input type="checkbox" checked={task.use_tools ?? false}
                onChange={(e) => onUpdateTask({ ...task, use_tools: e.target.checked })} />
              {t('card.agentMode', 'Agent Mode (ReAct loop with tools)')}
            </label>

            {/* Agent Mode options — shown only when use_tools is enabled */}
            {task.use_tools && (
              <div style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="field-checkbox">
                  <input type="checkbox" checked={task.auto_apply_edits ?? true}
                    onChange={(e) => onUpdateTask({ ...task, auto_apply_edits: e.target.checked })} />
                  {t('card.autoApplyEdits', 'Auto-apply file edits')}
                </label>
                <div className="field-group" style={{ marginBottom: 0 }}>
                  <label className="field-label">{t('card.maxToolIterations', 'Max tool iterations')}</label>
                  <input
                    type="number"
                    className="field-input"
                    style={{ width: 80 }}
                    min={1}
                    max={50}
                    value={task.max_tool_iterations ?? 10}
                    onChange={(e) => onUpdateTask({ ...task, max_tool_iterations: Number(e.target.value) })}
                  />
                </div>
                <div className="field-group" style={{ marginBottom: 0 }}>
                  <label className="field-label">{t('card.allowedTools', 'Allowed tools (all if none selected)')}</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                    {ALL_AGENT_TOOLS.map((tool) => {
                      const allowed = task.allowed_tools;
                      const isChecked = !allowed || allowed.length === 0 || allowed.includes(tool);
                      return (
                        <label key={tool} className="field-checkbox" style={{ fontSize: 11, marginBottom: 0 }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const current = allowed && allowed.length > 0
                                ? [...allowed]
                                : [...ALL_AGENT_TOOLS];
                              const updated = e.target.checked
                                ? [...new Set([...current, tool])]
                                : current.filter((t) => t !== tool);
                              // If all are selected, store as empty (meaning 'all')
                              const next = updated.length === ALL_AGENT_TOOLS.length ? [] : updated;
                              onUpdateTask({ ...task, allowed_tools: next });
                            }}
                          />
                          {tool}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Tool call log (while tool_calling) ── */}
          {status === 'tool_calling' && toolEvents && toolEvents.length > 0 && (
            <ToolCallLog events={toolEvents} />
          )}

          {/* ── Live streaming output (while running) ── */}
          {isActive && streamingOutput && status !== 'tool_calling' && (
            <div className="agent-card__streaming-section">
              <div className="agent-card__output-header">
                <span className="agent-card__output-title agent-card__output-title--streaming">
                  <span className="agent-card__stream-dot" />
                  Live Output
                </span>
                <span style={{ fontSize: 10, color: 'var(--aao-muted)', fontFamily: 'var(--aao-font-mono)' }}>
                  {streamingOutput.length} chars
                </span>
              </div>
              <div ref={streamingRef} className="agent-card__output-preview agent-card__output-preview--streaming">
                {streamingOutput}
              </div>
            </div>
          )}

          {/* ── Output preview ── */}
          {status === 'completed' && output && (
            <div className="agent-card__output-section">
              <div className="agent-card__output-header">
                <span className="agent-card__output-title">Output</span>
                <button className="btn btn--ghost btn--xs"
                  onClick={() => setShowOutputModal(true)}
                  title={t('card.viewFullOutput')}
                  aria-label={t('card.viewFullOutput')}>
                  ⛶ {t('card.viewFullOutput')}
                </button>
                <button className="btn btn--ghost btn--xs"
                  onClick={handleCopyOutput}
                  title={t('card.copyOutput', 'Copy')}
                  aria-label={t('card.copyOutput', 'Copy')}>
                  📋
                </button>
                <button className="btn btn--ghost btn--xs"
                  onClick={handleSaveOutput}
                  title="Save output to file"
                  aria-label="Save output to file">
                  💾
                </button>
                <button className="btn btn--ghost btn--xs"
                  onClick={() => postMessage({ type: 'output:apply', payload: { content: output } })}
                  title="Apply output as diff in editor"
                  aria-label="Apply output as diff in editor">
                  ⚡ Apply
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

      {/* ── Full output viewer modal ── */}
      {showOutputModal && output && (
        <div
          className="instruction-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowOutputModal(false); }}
        >
          <div className="instruction-modal">
            <div className="instruction-modal__header">
              <div>
                <div className="instruction-modal__title">{agent.name} — Output</div>
                <div className="instruction-modal__subtitle">
                  {task.task_name} · {output.length.toLocaleString()} chars · ~{Math.ceil(output.length / 4).toLocaleString()} tokens
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={handleCopyOutput}
                  aria-label={t('card.copyOutput', 'Copy')}
                >📋 {t('card.copyOutput', 'Copy')}</button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setShowOutputModal(false)}
                  aria-label={t('card.closeOutputModal', 'Close')}
                >✕ {t('card.closeOutputModal', 'Close')}</button>
              </div>
            </div>
            <div className="instruction-modal__output-body">
              {output}
            </div>
          </div>
        </div>
      )}

      {/* ── Fullscreen instruction modal ── */}
      {showInstructionModal && (
        <div
          className="instruction-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowInstructionModal(false); }}
        >
          <div className="instruction-modal">
            <div className="instruction-modal__header">
              <div>
                <div className="instruction-modal__title">{agent.name} — {t('card.instructions')}</div>
                <div className="instruction-modal__subtitle">{task.task_name}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--aao-muted)', fontFamily: 'var(--aao-font-mono)' }}>
                  {instructionText.length} chars · ~{Math.ceil(instructionText.length / 4)} tokens
                </span>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setShowInstructionModal(false)}
                  aria-label="Close fullscreen editor"
                >✕ Close</button>
              </div>
            </div>
            <textarea
              className="instruction-modal__textarea"
              value={instructionText}
              placeholder="Write the full task specification here. Markdown is supported."
              onChange={(e) => updateInstructions(e.target.value)}
              autoFocus
            />
          </div>
        </div>
      )}
    </div>
  );
}
