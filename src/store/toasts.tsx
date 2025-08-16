import React from 'react';

export type Toast = { id: string; title: string; message?: string; progress?: { current: number; total: number }; kind?: 'info'|'success'|'error' };

type ToastCtx = {
  toasts: Toast[];
  show: (t: Omit<Toast, 'id'> & { id?: string }) => string;
  update: (id: string, patch: Partial<Toast>) => void;
  dismiss: (id: string) => void;
};

export const ToastContext = React.createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const show = React.useCallback((t: Omit<Toast, 'id'> & { id?: string }) => {
    const id = t.id || crypto.randomUUID();
    setToasts((prev) => [{ id, title: t.title, message: t.message, progress: t.progress, kind: t.kind }, ...prev]);
    return id;
  }, []);
  const update = React.useCallback((id: string, patch: Partial<Toast>) => {
    setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);
  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);
  return <ToastContext.Provider value={{ toasts, show, update, dismiss }}>{children}</ToastContext.Provider>;
}

export function useToasts() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToasts must be used within ToastProvider');
  return ctx;
}

