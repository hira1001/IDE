import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowStep, WorkflowConfig, TaskState, Agent, Task } from '../../types/index.js';
import { AgentCard } from './AgentCard.js';

interface StepBlockProps {
  step: WorkflowStep;
  stepIndex: number;
  config: WorkflowConfig;
  taskStates: Record<string, TaskState>;
  outputStore: Record<string, string>;
  /** Live streaming chunks per task_id. */
  streamingChunks?: Record<string, string>;
  /** Tool call events per task_id for agentic tasks. */
  toolEvents?: Record<string, Array<{ event_type: string; tool_name?: string; content?: string; iteration?: number }>>;
  onUpdateStep: (step: WorkflowStep) => void;
  onDeleteStep: () => void;
  onRetryTask: (taskId: string) => void;
  onToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

const STEP_TYPE_LABELS: Record<WorkflowStep['type'], string> = {
  parallel: 'Parallel', sequential: 'Sequential', conditional: 'Conditional',
};

export function StepBlock({
  step, stepIndex, config, taskStates, outputStore, streamingChunks, toolEvents,
  onUpdateStep, onDeleteStep, onRetryTask, onToast,
}: StepBlockProps) {
  const { t } = useTranslation();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };
  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== dropIndex) {
      const newTasks = [...step.tasks];
      const [removed] = newTasks.splice(dragIndex, 1);
      newTasks.splice(dropIndex, 0, removed);
      onUpdateStep({ ...step, tasks: newTasks });
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // Compute aggregate step status for styling
  const tasks = step.tasks;
  const allDone = tasks.length > 0 && tasks.every((t) => taskStates[t.task_id]?.status === 'completed');
  const anyRunning = tasks.some((t) => ['running','validating','retrying'].includes(taskStates[t.task_id]?.status ?? ''));
  const anyError = tasks.some((t) => taskStates[t.task_id]?.status === 'error');

  const stepClass = allDone ? 'step-block--done' : anyError ? 'step-block--error' : anyRunning ? 'step-block--active' : '';

  const updateTask = (taskId: string, updatedTask: Task) => {
    onUpdateStep({ ...step, tasks: step.tasks.map((t) => (t.task_id === taskId ? updatedTask : t)) });
  };

  const updateAgent = (agentId: string, updatedAgent: Agent) => {
    const event = new CustomEvent('aao:update-agent', { detail: { agentId, updatedAgent }, bubbles: true });
    document.dispatchEvent(event);
  };

  const deleteTask = (taskId: string) => {
    onUpdateStep({ ...step, tasks: step.tasks.filter((t) => t.task_id !== taskId) });
  };

  const addTask = () => {
    const newAgentId = `agent_${uuidv4().slice(0, 6)}`;
    const newTaskId  = `task_${uuidv4().slice(0, 6)}`;
    document.dispatchEvent(new CustomEvent('aao:add-agent', {
      detail: { agent: { id: newAgentId, name: 'New Agent', persona: 'A helpful AI assistant.', model: 'gpt-4o' } },
      bubbles: true,
    }));
    const newTask: Task = {
      task_id: newTaskId, agent_id: newAgentId, task_name: 'New Task',
      instructions: [''], constraints: [], output_format: 'Markdown',
      output_key: `out_${newTaskId}`,
      input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source file' }],
      enable_handover_note: false,
    };
    onUpdateStep({ ...step, tasks: [...step.tasks, newTask] });
  };

  const isParallel = step.type === 'parallel';
  const typeLabel = t(`step.${step.type}`, STEP_TYPE_LABELS[step.type]);
  const pauseActive = step.pause_after;

  return (
    <div className={`step-block step-block--${step.type} ${stepClass}`}>
      {/* Header */}
      <div className="step-block__header">
        <span className="step-block__number">Step {stepIndex + 1}</span>

        <div className={`step-block__type-pill`}>{typeLabel}</div>

        <select
          className="step-block__type-select"
          value={step.type}
          onChange={(e) => {
            const newType = e.target.value as WorkflowStep['type'];
            const updates: Partial<WorkflowStep> = { type: newType };
            if (newType === 'conditional' && !step.condition) {
              updates.condition = {
                evaluator_agent_id: step.tasks[0]?.agent_id ?? '',
                pass_keyword: 'PASS',
                fail_keyword: 'FAIL',
                max_loops: 3,
              };
            }
            onUpdateStep({ ...step, ...updates });
          }}
        >
          <option value="parallel">Parallel</option>
          <option value="sequential">Sequential</option>
          <option value="conditional">Conditional</option>
        </select>

        <label className={`step-block__pause-toggle ${pauseActive ? 'step-block__pause-toggle--active' : ''}`}>
          <input
            type="checkbox"
            checked={pauseActive}
            onChange={(e) => onUpdateStep({ ...step, pause_after: e.target.checked })}
            style={{ marginRight: 4 }}
          />
          ⏸ {t('step.pauseAfter')}
        </label>

        <button className="step-block__btn-delete" onClick={onDeleteStep} title={t('step.deleteStep')}>
          🗑️
        </button>
      </div>

      {/* Conditional configuration */}
      {step.type === 'conditional' && (
        <div className="step-block__cond-config">
          <div className="cond-config__title">{t('step.conditionalConfig', 'Conditional Configuration')}</div>
          <div className="cond-config__grid">
            <label className="cond-config__field">
              <span className="cond-config__label">{t('step.evaluatorAgent', 'Evaluator Agent')}</span>
              <select
                className="field-input cond-config__select"
                value={step.condition?.evaluator_agent_id ?? ''}
                onChange={(e) =>
                  onUpdateStep({
                    ...step,
                    condition: { ...step.condition!, evaluator_agent_id: e.target.value },
                  })
                }
              >
                <option value="">{t('step.selectAgent', '— select agent —')}</option>
                {config.agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>

            <label className="cond-config__field">
              <span className="cond-config__label">
                <span className="cond-keyword cond-keyword--pass">✓</span>
                {t('step.passKeyword', 'Pass Keyword')}
              </span>
              <input
                className="field-input"
                type="text"
                value={step.condition?.pass_keyword ?? ''}
                placeholder="PASS"
                onChange={(e) =>
                  onUpdateStep({
                    ...step,
                    condition: { ...step.condition!, pass_keyword: e.target.value },
                  })
                }
              />
            </label>

            <label className="cond-config__field">
              <span className="cond-config__label">
                <span className="cond-keyword cond-keyword--fail">✗</span>
                {t('step.failKeyword', 'Fail Keyword')}
              </span>
              <input
                className="field-input"
                type="text"
                value={step.condition?.fail_keyword ?? ''}
                placeholder="FAIL"
                onChange={(e) =>
                  onUpdateStep({
                    ...step,
                    condition: { ...step.condition!, fail_keyword: e.target.value },
                  })
                }
              />
            </label>

            <label className="cond-config__field">
              <span className="cond-config__label">{t('step.maxLoops', 'Max Loops')}</span>
              <input
                className="field-input cond-config__number"
                type="number"
                min={1}
                max={10}
                value={step.condition?.max_loops ?? 3}
                onChange={(e) =>
                  onUpdateStep({
                    ...step,
                    condition: { ...step.condition!, max_loops: parseInt(e.target.value, 10) || 1 },
                  })
                }
              />
            </label>

            <label className="cond-config__field">
              <span className="cond-config__label">{t('step.onFailGoto', 'On Fail → Step')}</span>
              <input
                className="field-input cond-config__number"
                type="number"
                min={1}
                value={step.on_fail_goto ?? ''}
                placeholder="—"
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  onUpdateStep({ ...step, on_fail_goto: isNaN(v) ? undefined : v });
                }}
              />
            </label>

            <label className="cond-config__field">
              <span className="cond-config__label">{t('step.thenGoto', 'On Pass → Step')}</span>
              <input
                className="field-input cond-config__number"
                type="number"
                min={1}
                value={step.then_goto ?? ''}
                placeholder="—"
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  onUpdateStep({ ...step, then_goto: isNaN(v) ? undefined : v });
                }}
              />
            </label>
          </div>
        </div>
      )}

      {/* Cards */}
      <div className={`step-block__cards ${isParallel ? 'step-block__cards--parallel' : ''}`}>
        {step.tasks.map((task, taskIndex) => {
          const agent = config.agents.find((a) => a.id === task.agent_id);
          if (!agent) return null;
          return (
            <AgentCard
              key={task.task_id}
              agent={agent}
              task={task}
              taskState={taskStates[task.task_id]}
              output={outputStore[task.output_key]}
              streamingOutput={streamingChunks?.[task.task_id]}
              toolEvents={toolEvents?.[task.task_id]}
              config={config}
              onUpdateAgent={(a) => updateAgent(agent.id, a)}
              onUpdateTask={(t) => updateTask(task.task_id, t)}
              onRetry={() => onRetryTask(task.task_id)}
              onDelete={() => deleteTask(task.task_id)}
              onToast={onToast}
              taskIndex={taskIndex}
              isDragOver={dragOverIndex === taskIndex}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            />
          );
        })}

        <button className="btn-add-card" onClick={addTask}>＋ {t('step.addCard')}</button>
      </div>

    </div>
  );
}
