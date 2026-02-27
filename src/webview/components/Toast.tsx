import React, { useEffect } from 'react';

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastEntry key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastEntry({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  const icon = toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ';

  return (
    <div className={`toast toast--${toast.type}`} role="status">
      <span className="toast__icon" aria-hidden="true">{icon}</span>
      <span className="toast__message">{toast.message}</span>
      <button className="toast__close" onClick={() => onRemove(toast.id)} aria-label="Dismiss notification">✕</button>
    </div>
  );
}
