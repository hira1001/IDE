import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '32px 24px',
          fontFamily: 'var(--vscode-font-family, sans-serif)',
          color: 'var(--vscode-foreground)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 32 }}>⚠</div>
          <div style={{ fontWeight: 600 }}>Something went wrong</div>
          <pre style={{
            background: 'var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2))',
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 11,
            maxWidth: 400,
            overflow: 'auto',
            textAlign: 'left',
            color: 'var(--vscode-errorForeground, #f48771)',
          }}>
            {this.state.error?.message}
          </pre>
          <button
            style={{
              padding: '6px 16px',
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
