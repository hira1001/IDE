import React from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowConfig, WorkflowStep, TaskState, Agent } from '../../types/index.js';
import { StepBlock } from './StepBlock.js';

interface PipelineViewProps {
  config: WorkflowConfig;
  taskStates: Record<string, TaskState>;
  outputStore: Record<string, string>;
  onChange: (config: WorkflowConfig) => void;
  onRetryTask: (taskId: string) => void;
}

export function PipelineView({
  config,
  taskStates,
  outputStore,
  onChange,
  onRetryTask,
}: PipelineViewProps) {
  const { t } = useTranslation();

  React.useEffect(() => {
    const handleUpdateAgent = (e: Event) => {
      const { agentId, updatedAgent } = (e as CustomEvent).detail as { agentId: string; updatedAgent: Agent };
      const agents = config.agents.map((a) => (a.id === agentId ? updatedAgent : a));
      onChange({ ...config, agents });
    };

    const handleAddAgent = (e: Event) => {
      const { agent } = (e as CustomEvent).detail as { agent: Agent };
      onChange({ ...config, agents: [...config.agents, agent] });
    };

    document.addEventListener('aao:update-agent', handleUpdateAgent);
    document.addEventListener('aao:add-agent', handleAddAgent);
    return () => {
      document.removeEventListener('aao:update-agent', handleUpdateAgent);
      document.removeEventListener('aao:add-agent', handleAddAgent);
    };
  }, [config, onChange]);

  const updateStep = (stepIndex: number, updatedStep: WorkflowStep) => {
    const workflow = config.workflow.map((s, i) => (i === stepIndex ? updatedStep : s));
    onChange({ ...config, workflow });
  };

  const deleteStep = (stepIndex: number) => {
    const workflow = config.workflow.filter((_, i) => i !== stepIndex);
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
            onUpdateStep={(updatedStep) => updateStep(idx, updatedStep)}
            onDeleteStep={() => deleteStep(idx)}
            onRetryTask={onRetryTask}
          />

          {/* Connector arrow */}
          {idx < config.workflow.length - 1 && (
            <div className="step-connector">
              <div className="step-connector__arrow">↓</div>
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
