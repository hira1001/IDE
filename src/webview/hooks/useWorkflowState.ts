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

export interface AvailableModels {
  openai: string[];
  anthropic: string[];
  google: string[];
  ollama: string[];
  vscodeLM: string[];
}

interface WorkflowState {
  config: WorkflowConfig | null;
  executionState: SerializedExecutionState | null;
  source: SourceInput | null;
  contextSummary: ProjectContextSummary | null;
  templates: WorkflowTemplate[];
  dryRunResult: DryRunResult | null;
  isGenerating: boolean;
  generationError: string | null;
  noApiKeys: boolean;
  availableModels: AvailableModels;
  /** Live streaming text per task_id. Cleared when task reaches 'completed'. */
  streamingChunks: Record<string, string>;
  /** Tool call events per task_id for agentic tasks. Cleared when task completes. */
  toolEvents: Record<string, Array<{ event_type: string; tool_name?: string; content?: string; iteration?: number }>>;
}

const EMPTY_AVAILABLE_MODELS: AvailableModels = {
  openai: [], anthropic: [], google: [], ollama: [], vscodeLM: [],
};

const INITIAL_STATE: WorkflowState = {
  config: null,
  executionState: null,
  source: null,
  contextSummary: null,
  templates: [],
  dryRunResult: null,
  isGenerating: false,
  generationError: null,
  noApiKeys: false,
  availableModels: EMPTY_AVAILABLE_MODELS,
  streamingChunks: {},
  toolEvents: {},
};

export function useWorkflowState() {
  const { postMessage } = useVSCode();
  const [state, setState] = useState<WorkflowState>(INITIAL_STATE);
  // Undo/redo history — stored in a ref to avoid triggering re-renders on history changes
  const historyRef = useRef<WorkflowConfig[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [historySize, setHistorySize] = useState({ canUndo: false, canRedo: false });
  // Tracks whether the in-flight generation should still be applied when it resolves.
  // Avoids stale-closure issues by reading ref.current instead of state.
  const generationActiveRef = useRef(false);

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

        case 'onboarding:no_api_keys': {
          setState((s) => ({ ...s, noApiKeys: true }));
          break;
        }

        case 'workflow:generate': {
          const p = message.payload as { status: string; config?: WorkflowConfig; error?: string };
          if (p.status === 'generating') {
            generationActiveRef.current = true;
            setState((s) => ({ ...s, isGenerating: true, generationError: null }));
          } else if (p.status === 'done' && p.config) {
            // Ignore if the user already cancelled this generation
            if (generationActiveRef.current) {
              generationActiveRef.current = false;
              setState((s) => ({ ...s, config: p.config!, isGenerating: false }));
            }
          } else if (p.status === 'error') {
            generationActiveRef.current = false;
            setState((s) => ({ ...s, isGenerating: false, generationError: p.error ?? 'Unknown error' }));
          }
          break;
        }

        case 'status:update': {
          const p = message.payload as { execution_state: SerializedExecutionState };
          setState((s) => {
            // Clear streaming chunks and tool events for any tasks that are now completed/error
            const completed = Object.entries(p.execution_state.task_states)
              .filter(([, ts]) => ts.status === 'completed' || ts.status === 'error' || ts.status === 'aborted')
              .map(([id]) => id);
            if (completed.length > 0) {
              const updatedChunks = { ...s.streamingChunks };
              const updatedToolEvents = { ...s.toolEvents };
              for (const id of completed) {
                delete updatedChunks[id];
                delete updatedToolEvents[id];
              }
              return { ...s, executionState: p.execution_state, streamingChunks: updatedChunks, toolEvents: updatedToolEvents };
            }
            return { ...s, executionState: p.execution_state };
          });
          break;
        }

        case 'task:stream_chunk': {
          const p = message.payload as { task_id: string; chunk: string };
          setState((s) => ({
            ...s,
            streamingChunks: {
              ...s.streamingChunks,
              [p.task_id]: (s.streamingChunks[p.task_id] ?? '') + p.chunk,
            },
          }));
          break;
        }

        case 'task:tool_event': {
          const p = message.payload as { task_id: string; event_type: string; tool_name?: string; content?: string; iteration?: number };
          setState((s) => ({
            ...s,
            toolEvents: {
              ...s.toolEvents,
              [p.task_id]: [
                ...(s.toolEvents[p.task_id] ?? []),
                { event_type: p.event_type, tool_name: p.tool_name, content: p.content, iteration: p.iteration },
              ],
            },
          }));
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

        case 'settings:current': {
          const p = message.payload as {
            availableModels?: AvailableModels;
            openai?: 'set' | 'unset';
            anthropic?: 'set' | 'unset';
            google?: 'set' | 'unset';
            vscodeLMCount?: number;
          };
          if (p.availableModels) {
            setState((s) => ({ ...s, availableModels: p.availableModels! }));
          }
          // If all keys are now set, dismiss the no-api-keys banner
          const hasAnyKey = p.openai === 'set' || p.anthropic === 'set' || p.google === 'set';
          const hasVscodeLM = (p.vscodeLMCount ?? 0) > 0;
          if (hasAnyKey || hasVscodeLM) {
            setState((s) => ({ ...s, noApiKeys: false }));
          }
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

  const dismissNoApiKeys = useCallback(() => {
    setState((s) => ({ ...s, noApiKeys: false }));
  }, []);

  const abortGenerate = useCallback(() => {
    generationActiveRef.current = false;
    setState((s) => ({ ...s, isGenerating: false, generationError: null }));
  }, []);

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

  const clearWorkflow = useCallback(() => {
    historyRef.current = [];
    historyIndexRef.current = -1;
    setHistorySize({ canUndo: false, canRedo: false });
    setState((s) => ({ ...s, config: null, executionState: null, dryRunResult: null }));
  }, []);

  return {
    ...state,
    generateWorkflow,
    dismissNoApiKeys,
    executeWorkflow,
    executeFromStep,
    abortWorkflow,
    abortGenerate,
    retryTask,
    resumeFromPause,
    dryRun,
    manualEditOutput,
    loadTemplates,
    setConfig,
    clearWorkflow,
    clearDryRun,
    setContextMode,
    refreshContext,
    postMessage,
    undo,
    redo,
    canUndo: historySize.canUndo,
    canRedo: historySize.canRedo,
    streamingChunks: state.streamingChunks,
    toolEvents: state.toolEvents,
    availableModels: state.availableModels,
  };
}
