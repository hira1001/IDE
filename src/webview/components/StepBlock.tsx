import React from 'react';
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
  onUpdateStep: (step: WorkflowStep) => void;
  onDeleteStep: () => void;
  onRetryTask: (taskId: string) => void;
}

const STEP_TYPE_LABELS: Record<WorkflowStep['type'], string> = {
  parallel: 'Parallel', sequential: 'Sequential', conditional: 'Conditional',
};

export function StepBlock({
  step, stepIndex, config, taskStates, outputStore,
  onUpdateStep, onDeleteStep, onRetryTask,
}: StepBlockProps) {
  const { t } = useTranslation();

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
          onChange={(e) => onUpdateStep({ ...step, type: e.target.value as WorkflowStep['type'] })}
        >
          <option value="parallel">Parallel</option>
          <option value="sequential">Sequential</option>
          <option value="conditional">Conditional</option>
        </select>

        {step.type === 'conditional' && step.condition && (
          <span className="step-block__cond-badge">
            ✓ {step.condition.pass_keyword} / ✗→Step{step.on_fail_goto ?? '?'}
          </span>
        )}

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

      {/* Cards */}
      <div className={`step-block__cards ${isParallel ? 'step-block__cards--parallel' : ''}`}>
        {step.tasks.map((task) => {
          const agent = config.agents.find((a) => a.id === task.agent_id);
          if (!agent) return null;
          return (
            <AgentCard
              key={task.task_id}
              agent={agent}
              task={task}
              taskState={taskStates[task.task_id]}
              output={outputStore[task.output_key]}
              onUpdateAgent={(a) => updateAgent(agent.id, a)}
              onUpdateTask={(t) => updateTask(task.task_id, t)}
              onRetry={() => onRetryTask(task.task_id)}
              onDelete={() => deleteTask(task.task_id)}
            />
          );
        })}

        <button className="btn-add-card" onClick={addTask}>＋ {t('step.addCard')}</button>
      </div>

      {/* Loop goto hint */}
      {step.then_goto !== undefined && (
        <div className="step-block__goto-hint">
          ↩️ On pass → Step {step.then_goto}
        </div>
      )}
    </div>
  );
}
