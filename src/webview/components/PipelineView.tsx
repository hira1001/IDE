import React from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowConfig, WorkflowStep, TaskState, Agent, Task } from '../../types/index.js';
import { StepBlock } from './StepBlock.js';
import { AvailableModels } from '../hooks/useWorkflowState.js';

interface PipelineViewProps {
  config: WorkflowConfig;
  taskStates: Record<string, TaskState>;
  outputStore: Record<string, string>;
  streamingChunks?: Record<string, string>;
  toolEvents?: Record<string, Array<{ event_type: string; tool_name?: string; content?: string; iteration?: number }>>;
  availableModels?: AvailableModels;
  defaultModel: string;
  onChange: (config: WorkflowConfig) => void;
  onRetryTask: (taskId: string) => void;
  onToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  onOpenSettings?: () => void;
}

export function PipelineView({
  config,
  taskStates,
  outputStore,
  streamingChunks,
  toolEvents,
  availableModels,
  defaultModel,
  onChange,
  onRetryTask,
  onToast,
  onOpenSettings,
}: PipelineViewProps) {
  const { t } = useTranslation();

  const handleUpdateAgent = (updatedAgent: Agent) => {
    const agents = config.agents.map((a) => (a.id === updatedAgent.id ? updatedAgent : a));
    onChange({ ...config, agents });
  };

  const handleAddAgentAndTask = (stepIndex: number, newTask: Task, newAgent: Agent) => {
    const workflow = config.workflow.map((s, i) => (i === stepIndex ? { ...s, tasks: [...s.tasks, newTask] } : s));
    onChange({ ...config, workflow, agents: [...config.agents, newAgent] });
  };

  const updateStep = (stepIndex: number, updatedStep: WorkflowStep) => {
    const workflow = config.workflow.map((s, i) => (i === stepIndex ? updatedStep : s));
    onChange({ ...config, workflow });
  };

  const deleteStep = (stepIndex: number) => {
    const workflow = config.workflow.filter((_, i) => i !== stepIndex);
    onChange({ ...config, workflow });
  };

  const handleMoveTask = (sourceStepIndex: number, sourceTaskIndex: number, targetStepIndex: number, targetTaskIndex: number) => {
    const workflow = [...config.workflow];
    const sourceStep = { ...workflow[sourceStepIndex], tasks: [...workflow[sourceStepIndex].tasks] };
    const targetStep = sourceStepIndex === targetStepIndex ? sourceStep : { ...workflow[targetStepIndex], tasks: [...workflow[targetStepIndex].tasks] };

    const [movedTask] = sourceStep.tasks.splice(sourceTaskIndex, 1);
    targetStep.tasks.splice(targetTaskIndex, 0, movedTask);

    if (sourceStepIndex !== targetStepIndex) {
      // Fix input mappings that might reference the old step. This is a best effort cleanup.
      // Usually users will just configure it again, but this helps.
    }

    workflow[sourceStepIndex] = sourceStep;
    workflow[targetStepIndex] = targetStep;

    onChange({ ...config, workflow });
  };

  const addStep = () => {
    const maxStep = config.workflow.reduce((max, s) => Math.max(max, s.step), 0);
    const newStep: WorkflowStep = {
      step: maxStep + 1,
      type: 'sequential',
      pause_after: false,
      tasks: [],
    };
    onChange({ ...config, workflow: [...config.workflow, newStep] });
  };

  return (
    <div className="pipeline-view">
      {config.workflow.map((step, idx) => (
        <React.Fragment key={step.step}>
          <StepBlock
            step={step}
            stepIndex={idx}
            config={config}
            taskStates={taskStates}
            outputStore={outputStore}
            streamingChunks={streamingChunks}
            toolEvents={toolEvents}
            availableModels={availableModels}
            defaultModel={defaultModel}
            onUpdateStep={(updatedStep) => updateStep(idx, updatedStep)}
            onUpdateAgent={handleUpdateAgent}
            onAddAgentAndTask={(t: Task, a: Agent) => handleAddAgentAndTask(idx, t, a)}
            onDeleteStep={() => deleteStep(idx)}
            onRetryTask={onRetryTask}
            onMoveTask={handleMoveTask}
            onToast={onToast}
            onOpenSettings={onOpenSettings}
          />

          {/* Connector arrow */}
          {idx < config.workflow.length - 1 && (
            <div className="step-connector">
              <svg className="step-connector__svg" width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden="true">
                <line x1="8" y1="0" x2="8" y2="14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
                <path d="M4 11l4 6 4-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </div>
          )}
        </React.Fragment>
      ))}

      <button className="btn btn--add-step" onClick={addStep}>
        {t('app.addStep')}
      </button>
    </div>
  );
}
