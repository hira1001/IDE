import React, { useEffect, useState } from 'react';

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
  const [leaving, setLeaving] = useState(false);

  // Begin exit animation 200ms before removal
  useEffect(() => {
    const leaveTimer = setTimeout(() => setLeaving(true), 2800);
    const removeTimer = setTimeout(() => onRemove(toast.id), 3200);
    return () => { clearTimeout(leaveTimer); clearTimeout(removeTimer); };
  }, [toast.id, onRemove]);

  const handleDismiss = () => {
    setLeaving(true);
    setTimeout(() => onRemove(toast.id), 200);
  };

  const icon = toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ';

  return (
    <div className={`toast toast--${toast.type}${leaving ? ' toast--leaving' : ''}`} role="status">
      <span className="toast__icon" aria-hidden="true">{icon}</span>
      <span className="toast__message">{toast.message}</span>
      <button className="toast__close" onClick={handleDismiss} aria-label="Dismiss notification">✕</button>
    </div>
  );
}
