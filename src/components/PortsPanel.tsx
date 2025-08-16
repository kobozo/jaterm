import React from 'react';

type Forward = { id?: string; type: 'L'|'R'; srcHost: string; srcPort: number; dstHost: string; dstPort: number; status?: 'starting'|'active'|'error'|'closed' };

export default function PortsPanel({ forwards, onAdd, onStop }: { forwards: Forward[]; onAdd: (f: Forward) => void; onStop: (id: string) => void }) {
  const [form, setForm] = React.useState<Forward>({ type: 'L', srcHost: '127.0.0.1', srcPort: 3000, dstHost: '127.0.0.1', dstPort: 3000 });
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 8, boxSizing: 'border-box', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: (e.target.value as any) })}>
          <option value="L">Local → Remote</option>
          <option value="R">Remote → Local</option>
        </select>
        <input style={{ width: 140 }} placeholder="src host" value={form.srcHost} onChange={(e) => setForm({ ...form, srcHost: e.target.value })} />
        <input style={{ width: 80 }} placeholder="src port" type="number" value={form.srcPort} onChange={(e) => setForm({ ...form, srcPort: Number(e.target.value) || 0 })} />
        <span>→</span>
        <input style={{ width: 140 }} placeholder="dst host" value={form.dstHost} onChange={(e) => setForm({ ...form, dstHost: e.target.value })} />
        <input style={{ width: 80 }} placeholder="dst port" type="number" value={form.dstPort} onChange={(e) => setForm({ ...form, dstPort: Number(e.target.value) || 0 })} />
        <button onClick={() => onAdd(form)}>Add</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', borderTop: '1px solid #333', paddingTop: 8 }}>
        {forwards.length === 0 && <div style={{ opacity: 0.7 }}>No forwards yet.</div>}
        {forwards.map((f) => (
          <div key={f.id || `${f.type}-${f.srcHost}:${f.srcPort}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px', borderBottom: '1px solid #222' }}>
            <div>
              <strong>{f.type}</strong> {f.srcHost}:{f.srcPort} → {f.dstHost}:{f.dstPort}
              <span style={{ marginLeft: 8, fontSize: 12, color: f.status === 'active' ? '#8fe18f' : f.status === 'error' ? '#f0a1a1' : '#bbb' }}>({f.status || 'starting'})</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {f.id && <button onClick={() => onStop(f.id!)}>Stop</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

