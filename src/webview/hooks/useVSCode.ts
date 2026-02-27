import { useRef, useCallback } from 'react';
import { WebviewMessage } from '../../types/index.js';

interface VSCodeAPI {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

let _vscode: VSCodeAPI | undefined;

function getVSCodeAPI(): VSCodeAPI {
  if (!_vscode) {
    try {
      _vscode = acquireVsCodeApi();
    } catch {
      // Running outside VS Code (tests / storybook)
      _vscode = {
        // eslint-disable-next-line no-console
        postMessage: (msg) => console.log('[mock vscode] postMessage', msg),
        getState: () => ({}),
        setState: () => {},
      };
    }
  }
  return _vscode;
}

export function useVSCode() {
  const vscodeRef = useRef<VSCodeAPI>(getVSCodeAPI());

  const postMessage = useCallback((message: WebviewMessage) => {
    vscodeRef.current.postMessage(message);
  }, []);

  return { postMessage };
}
