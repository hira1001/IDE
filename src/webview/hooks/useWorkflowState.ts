import { useState, useEffect, useCallback, useRef } from 'react';

const MAX_HISTORY = 20;
import {
  WorkflowConfig,
  SerializedExecutionState,
  SourceInput,
  WorkflowTemplate,
  DryRunResult,
} from '../../types/index.js';
import { useVSCode } from './useVSCode.js';

interface WorkflowState {
  config: WorkflowConfig | null;
  executionState: SerializedExecutionState | null;
  source: SourceInput | null;
  templates: WorkflowTemplate[];
  dryRunResult: DryRunResult | null;
  isGenerating: boolean;
  generationError: string | null;
}

const INITIAL_STATE: WorkflowState = {
  config: null,
  executionState: null,
  source: null,
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

  // Fetch source on mount
  useEffect(() => {
    postMessage({ type: 'source:get' });
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
      // Push current config to undo history before applying new one
      if (s.config) {
        const hist = historyRef.current;
        const idx = historyIndexRef.current;
        // Discard any redo entries past current index
        const newHist = hist.slice(0, idx + 1);
        newHist.push(s.config);
        if (newHist.length > MAX_HISTORY) newHist.shift();
        historyRef.current = newHist;
        historyIndexRef.current = newHist.length - 1;
        setHistorySize({ canUndo: newHist.length > 0, canRedo: false });
      }
      return { ...s, config };
    });
  }, []);

  const undo = useCallback(() => {
    const hist = historyRef.current;
    const idx = historyIndexRef.current;
    if (idx < 0 || hist.length === 0) return;
    setState((s) => {
      // Push current config to a "redo stack" by moving index back
      const prevConfig = hist[idx];
      // Move redo future: keep current config as a "redo" entry
      if (s.config && idx === hist.length - 1) {
        hist.push(s.config);
      }
      historyIndexRef.current = idx - 1;
      const canUndo = idx - 1 >= 0;
      const canRedo = true;
      setHistorySize({ canUndo, canRedo });
      return { ...s, config: prevConfig };
    });
  }, []);

  const redo = useCallback(() => {
    const hist = historyRef.current;
    const idx = historyIndexRef.current;
    if (idx >= hist.length - 1) return;
    const nextIdx = idx + 1;
    const nextConfig = hist[nextIdx];
    historyIndexRef.current = nextIdx;
    const canUndo = true;
    const canRedo = nextIdx < hist.length - 1;
    setHistorySize({ canUndo, canRedo });
    setState((s) => ({ ...s, config: nextConfig }));
  }, []);

  const clearDryRun = useCallback(() => {
    setState((s) => ({ ...s, dryRunResult: null }));
  }, []);

  return {
    ...state,
    generateWorkflow,
    executeWorkflow,
    abortWorkflow,
    retryTask,
    resumeFromPause,
    dryRun,
    manualEditOutput,
    loadTemplates,
    setConfig,
    clearDryRun,
    postMessage,
    undo,
    redo,
    canUndo: historySize.canUndo,
    canRedo: historySize.canRedo,
  };
}
