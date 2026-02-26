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

export function StepBlock({
  step,
  stepIndex,
  config,
  taskStates,
  outputStore,
  onUpdateStep,
  onDeleteStep,
  onRetryTask,
}: StepBlockProps) {
  const { t } = useTranslation();

  const stepTypeLabel: Record<WorkflowStep['type'], string> = {
    parallel: t('step.parallel'),
    sequential: t('step.sequential'),
    conditional: t('step.conditional'),
  };

  const updateTask = (taskId: string, updatedTask: Task) => {
    const tasks = step.tasks.map((t) => (t.task_id === taskId ? updatedTask : t));
    onUpdateStep({ ...step, tasks });
  };

  const updateAgent = (agentId: string, updatedAgent: Agent) => {
    // Update agent in config at parent level — we emit a full step update
    // The parent (PipelineView) handles agent updates from the full config context
    // For simplicity, we trigger via a custom event on the step to signal parent
    const event = new CustomEvent('aao:update-agent', { detail: { agentId, updatedAgent }, bubbles: true });
    document.dispatchEvent(event);
  };

  const deleteTask = (taskId: string) => {
    const tasks = step.tasks.filter((t) => t.task_id !== taskId);
    onUpdateStep({ ...step, tasks });
  };

  const addTask = () => {
    const newAgentId = `agent_${uuidv4().slice(0, 6)}`;
    const newTaskId = `task_${uuidv4().slice(0, 6)}`;

    // Notify parent to add agent
    const event = new CustomEvent('aao:add-agent', {
      detail: {
        agent: {
          id: newAgentId,
          name: 'New Agent',
          persona: 'A helpful AI assistant.',
          model: 'gpt-4o',
        },
      },
      bubbles: true,
    });
    document.dispatchEvent(event);

    const newTask: Task = {
      task_id: newTaskId,
      agent_id: newAgentId,
      task_name: 'New Task',
      instructions: [''],
      constraints: [],
      output_format: 'Markdown',
      output_key: `output_${newTaskId}`,
      input_mapping: [{ from_step: 0, from_agent_id: '__source__', label: 'Source file' }],
      enable_handover_note: false,
    };

    onUpdateStep({ ...step, tasks: [...step.tasks, newTask] });
  };

  const isParallel = step.type === 'parallel';
  const stepHasError = step.tasks.some((t) => taskStates[t.task_id]?.status === 'error');

  return (
    <div className={`step-block step-block--${step.type} ${stepHasError ? 'step-block--error' : ''}`}>
      {/* Step Header */}
      <div className="step-block__header">
        <span className="step-block__number">Step {stepIndex + 1}</span>

        <select
          className="step-block__type-select"
          value={step.type}
          onChange={(e) => onUpdateStep({ ...step, type: e.target.value as WorkflowStep['type'] })}
        >
          <option value="parallel">{t('step.parallel')}</option>
          <option value="sequential">{t('step.sequential')}</option>
          <option value="conditional">{t('step.conditional')}</option>
        </select>

        <span className="step-block__type-badge">{stepTypeLabel[step.type]}</span>

        <label className="step-block__pause-toggle">
          <input
            type="checkbox"
            checked={step.pause_after}
            onChange={(e) => onUpdateStep({ ...step, pause_after: e.target.checked })}
          />
          {' '}⏸ {t('step.pauseAfter')}
        </label>

        {step.type === 'conditional' && step.condition && (
          <span className="step-block__condition-badge">
            ✓={step.condition.pass_keyword} ✗→Step{step.on_fail_goto}
          </span>
        )}

        <button className="step-block__delete" onClick={onDeleteStep} title={t('step.deleteStep')}>
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
              config={config}
              onUpdateAgent={(updatedAgent) => updateAgent(agent.id, updatedAgent)}
              onUpdateTask={(updatedTask) => updateTask(task.task_id, updatedTask)}
              onRetry={() => onRetryTask(task.task_id)}
              onDelete={() => deleteTask(task.task_id)}
            />
          );
        })}

        <button className="btn-add-card" onClick={addTask}>
          {t('step.addCard')}
        </button>
      </div>

      {/* Conditional goto indicator */}
      {step.then_goto !== undefined && (
        <div className="step-block__goto">
          ↩️ → Step {step.then_goto}
        </div>
      )}
    </div>
  );
}
