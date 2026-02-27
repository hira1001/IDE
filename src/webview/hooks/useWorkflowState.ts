import { useState, useEffect, useCallback, useRef } from 'react';

const MAX_HISTORY = 20;
import {
  WorkflowConfig,
  SerializedExecutionState,
  SourceInput,
  WorkflowTemplate,
  DryRunResult,
  ProjectContextSummary,
} from '../../types/index.js';
import { useVSCode } from './useVSCode.js';

interface WorkflowState {
  config: WorkflowConfig | null;
  executionState: SerializedExecutionState | null;
  source: SourceInput | null;
  contextSummary: ProjectContextSummary | null;
  templates: WorkflowTemplate[];
  dryRunResult: DryRunResult | null;
  isGenerating: boolean;
  generationError: string | null;
}

const INITIAL_STATE: WorkflowState = {
  config: null,
  executionState: null,
  source: null,
  contextSummary: null,
  templates: [],
  dryRunResult: null,
  isGenerating: false,
  generationError: null,
};

export function useWorkflowState() {
  const { postMessage } = useVSCode();
  const [state, setState] = useState<WorkflowState>(INITIAL_STATE);
  // Undo/redo history — stored in a ref to avoid triggering re-renders on history changes
  const historyRef = useRef<WorkflowConfig[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [historySize, setHistorySize] = useState({ canUndo: false, canRedo: false });

  // Listen for messages from Extension Host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as { type: string; payload?: unknown };

      switch (message.type) {
        case 'source:get': {
          const p = message.payload as { source: SourceInput | null };
          setState((s) => ({ ...s, source: p.source }));
          break;
        }

        case 'context:get': {
          const p = message.payload as { summary: ProjectContextSummary };
          setState((s) => ({ ...s, contextSummary: p.summary }));
          break;
        }

        case 'workflow:generate': {
          const p = message.payload as { status: string; config?: WorkflowConfig; error?: string };
          if (p.status === 'generating') {
            setState((s) => ({ ...s, isGenerating: true, generationError: null }));
          } else if (p.status === 'done' && p.config) {
            setState((s) => ({ ...s, config: p.config!, isGenerating: false }));
          } else if (p.status === 'error') {
            setState((s) => ({ ...s, isGenerating: false, generationError: p.error ?? 'Unknown error' }));
          }
          break;
        }

        case 'status:update': {
          const p = message.payload as { execution_state: SerializedExecutionState };
          setState((s) => ({ ...s, executionState: p.execution_state }));
          break;
        }

        case 'template:list': {
          const p = message.payload as { templates: WorkflowTemplate[] };
          setState((s) => ({ ...s, templates: p.templates }));
          break;
        }

        case 'workflow:dryrun': {
          const p = message.payload as { result: DryRunResult };
          setState((s) => ({ ...s, dryRunResult: p.result }));
          break;
        }

        case 'template:open_selector': {
          // Request template list and show selector
          postMessage({ type: 'template:list' });
          break;
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [postMessage]);

  // On mount: signal readiness to the extension host (triggers saved-state restoration),
  // then request context data.
  useEffect(() => {
    postMessage({ type: 'webview:ready' });
    postMessage({ type: 'context:get' });
    postMessage({ type: 'source:get' }); // legacy — kept for backward compat
  }, [postMessage]);

  const generateWorkflow = useCallback(
    (instruction: string) => {
      postMessage({ type: 'workflow:generate', payload: { instruction, source: state.source } });
    },
    [postMessage, state.source]
  );

  const executeWorkflow = useCallback(
    (config: WorkflowConfig) => {
      postMessage({ type: 'workflow:execute', payload: { config } });
    },
    [postMessage]
  );

  const abortWorkflow = useCallback(() => {
    postMessage({ type: 'workflow:abort' });
  }, [postMessage]);

  const retryTask = useCallback(
    (taskId: string, config: WorkflowConfig) => {
      postMessage({ type: 'workflow:retry', payload: { task_id: taskId, config } });
    },
    [postMessage]
  );

  const resumeFromPause = useCallback(() => {
    postMessage({ type: 'workflow:pause_resume' });
  }, [postMessage]);

  const executeFromStep = useCallback(
    (config: WorkflowConfig, fromStep: number) => {
      postMessage({ type: 'workflow:execute_from', payload: { config, fromStep } });
    },
    [postMessage]
  );

  const dryRun = useCallback(
    (config: WorkflowConfig) => {
      postMessage({ type: 'workflow:dryrun', payload: { config } });
    },
    [postMessage]
  );

  const manualEditOutput = useCallback(
    (outputKey: string, content: string, step: number) => {
      postMessage({ type: 'workflow:manual_edit', payload: { output_key: outputKey, content, step } });
    },
    [postMessage]
  );

  const loadTemplates = useCallback(() => {
    postMessage({ type: 'template:list' });
  }, [postMessage]);

  const setConfig = useCallback((config: WorkflowConfig) => {
    setState((s) => {
      const hist = historyRef.current;
      const idx = historyIndexRef.current;

      if (idx === -1) {
        // No history yet. Bootstrap with [prevConfig?, newConfig].
        const newHist: WorkflowConfig[] = s.config ? [s.config, config] : [config];
        historyRef.current = newHist;
        historyIndexRef.current = newHist.length - 1;
        setHistorySize({ canUndo: newHist.length > 1, canRedo: false });
      } else {
        // Normal edit: discard redo future, append new state.
        const newHist = hist.slice(0, idx + 1);
        newHist.push(config);
        if (newHist.length > MAX_HISTORY) newHist.shift();
        historyRef.current = newHist;
        historyIndexRef.current = newHist.length - 1;
        setHistorySize({ canUndo: newHist.length > 1, canRedo: false });
      }

      return { ...s, config };
    });
  }, []);

  const undo = useCallback(() => {
    const hist = historyRef.current;
    const idx = historyIndexRef.current;
    if (idx <= 0 || hist.length === 0) return;
    const newIdx = idx - 1;
    const prevConfig = hist[newIdx];
    historyIndexRef.current = newIdx;
    setHistorySize({ canUndo: newIdx > 0, canRedo: true });
    setState((s) => ({ ...s, config: prevConfig }));
  }, []);

  const redo = useCallback(() => {
    const hist = historyRef.current;
    const idx = historyIndexRef.current;
    if (idx >= hist.length - 1) return;
    const newIdx = idx + 1;
    const nextConfig = hist[newIdx];
    historyIndexRef.current = newIdx;
    setHistorySize({ canUndo: true, canRedo: newIdx < hist.length - 1 });
    setState((s) => ({ ...s, config: nextConfig }));
  }, []);

  const clearDryRun = useCallback(() => {
    setState((s) => ({ ...s, dryRunResult: null }));
  }, []);

  const setContextMode = useCallback(
    (mode: 'file' | 'project') => {
      postMessage({ type: 'context:set_mode', payload: { mode } });
    },
    [postMessage]
  );

  const refreshContext = useCallback(() => {
    postMessage({ type: 'context:get' });
  }, [postMessage]);

  return {
    ...state,
    generateWorkflow,
    executeWorkflow,
    executeFromStep,
    abortWorkflow,
    retryTask,
    resumeFromPause,
    dryRun,
    manualEditOutput,
    loadTemplates,
    setConfig,
    clearDryRun,
    setContextMode,
    refreshContext,
    postMessage,
    undo,
    redo,
    canUndo: historySize.canUndo,
    canRedo: historySize.canRedo,
  };
}
