import React from 'react';
import { useToasts } from '@/store/toasts';

export default function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div style={{ position: 'fixed', right: 12, bottom: 12, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 1000 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{ background: '#222', color: '#eee', border: '1px solid #444', borderRadius: 6, padding: 10, minWidth: 260, boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{t.title}</strong>
            <button onClick={() => dismiss(t.id)} style={{ background: 'transparent', color: '#aaa', border: 'none', cursor: 'pointer' }}>×</button>
          </div>
          {t.message && <div style={{ marginTop: 6, fontSize: 12 }}>{t.message}</div>}
          {t.progress && (
            <div style={{ marginTop: 8 }}>
              {(() => {
                const pct = Math.max(0, Math.min(100, Math.floor((t.progress.current / Math.max(1, t.progress.total)) * 100)));
                return (
                  <>
                    <div style={{ height: 6, background: '#333', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: '#4aa3ff' }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>{pct}%</div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
