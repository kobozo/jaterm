import React from 'react';

export type Toast = { 
  id: string; 
  title: string; 
  message?: string; 
  progress?: { current: number; total: number }; 
  kind?: 'info'|'success'|'error';
  actions?: { label: string; onClick: () => void }[];
  timeout?: number; // milliseconds, 0 or undefined = no auto-dismiss
};

type ToastCtx = {
  toasts: Toast[];
  show: (t: Omit<Toast, 'id'> & { id?: string }) => string;
  update: (id: string, patch: Partial<Toast>) => void;
  dismiss: (id: string) => void;
};

export const ToastContext = React.createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  
  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);
  
  const show = React.useCallback((t: Omit<Toast, 'id'> & { id?: string }) => {
    const id = t.id || crypto.randomUUID();
    const toast: Toast = { 
      id, 
      title: t.title, 
      message: t.message, 
      progress: t.progress, 
      kind: t.kind, 
      actions: t.actions,
      timeout: t.timeout
    };
    
    // Set default timeouts based on toast type if not specified
    if (toast.timeout === undefined) {
      if (toast.progress) {
        // Progress toasts don't auto-dismiss
        toast.timeout = 0;
      } else if (toast.actions?.length) {
        // Toasts with actions get a longer timeout
        toast.timeout = 15000; // 15 seconds for action toasts
      } else {
        // Regular toasts auto-dismiss based on kind
        if (toast.kind === 'error') {
          toast.timeout = 8000; // 8 seconds for errors
        } else if (toast.kind === 'success') {
          toast.timeout = 4000; // 4 seconds for success
        } else {
          toast.timeout = 6000; // 6 seconds for info
        }
      }
    }
    
    setToasts((prev) => [toast, ...prev]);
    
    // Set up auto-dismiss timer if timeout is specified
    if (toast.timeout && toast.timeout > 0) {
      setTimeout(() => {
        dismiss(id);
      }, toast.timeout);
    }
    
    return id;
  }, [dismiss]);
  
  const update = React.useCallback((id: string, patch: Partial<Toast>) => {
    setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);
  return <ToastContext.Provider value={{ toasts, show, update, dismiss }}>{children}</ToastContext.Provider>;
}

export function useToasts() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToasts must be used within ToastProvider');
  return ctx;
}

