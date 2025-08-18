import React from 'react';

type Forward = { 
  id?: string; 
  type: 'L'|'R'; 
  srcHost: string; 
  srcPort: number; 
  dstHost: string; 
  dstPort: number; 
  status?: 'starting'|'active'|'error'|'closed'|'detected'|'suggested';
  auto?: boolean; // Auto-detected or suggested port
};

interface PortsPanelProps {
  forwards: Forward[];
  onAdd: (f: Forward) => void;
  onStop: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string, f: Forward) => void;
  onActivate?: (f: Forward) => void;
  detectedPorts?: number[]; // Ports detected as open on remote
  suggestedPorts?: number[]; // Common dev ports to suggest
}

// Common development ports
const COMMON_DEV_PORTS = [
  { port: 3000, name: 'React/Node' },
  { port: 3001, name: 'React Alt' },
  { port: 4000, name: 'Phoenix' },
  { port: 4200, name: 'Angular' },
  { port: 5173, name: 'Vite' },
  { port: 5174, name: 'Vite Alt' },
  { port: 8000, name: 'Django/Python' },
  { port: 8080, name: 'Tomcat/HTTP' },
  { port: 8081, name: 'HTTP Alt' },
  { port: 8888, name: 'Jupyter' },
  { port: 9000, name: 'PHP' },
  { port: 5432, name: 'PostgreSQL' },
  { port: 3306, name: 'MySQL' },
  { port: 6379, name: 'Redis' },
  { port: 27017, name: 'MongoDB' },
];

export default function PortsPanel({ 
  forwards, 
  onAdd, 
  onStop, 
  onDelete, 
  onEdit,
  onActivate,
  detectedPorts = [],
  suggestedPorts = []
}: PortsPanelProps) {
  const [form, setForm] = React.useState<Forward>({ 
    type: 'L', 
    srcHost: '127.0.0.1', 
    srcPort: 3000, 
    dstHost: '127.0.0.1', 
    dstPort: 3000 
  });
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<Forward | null>(null);
  const [showSuggestions, setShowSuggestions] = React.useState(true);

  // Create suggested forwards for common ports
  const suggestedForwards = React.useMemo(() => {
    const existingPorts = new Set(forwards.map(f => f.dstPort));
    const suggested: Forward[] = [];
    
    // Add detected ports (that are actually running on remote)
    detectedPorts.forEach(port => {
      if (!existingPorts.has(port)) {
        const portInfo = COMMON_DEV_PORTS.find(p => p.port === port);
        suggested.push({
          type: 'L',
          srcHost: '127.0.0.1',
          srcPort: port,
          dstHost: '127.0.0.1', 
          dstPort: port,
          status: 'detected',
          auto: true
        });
      }
    });
    
    // Add common dev ports as suggestions (may or may not be running)
    suggestedPorts.forEach(port => {
      if (!existingPorts.has(port) && !detectedPorts.includes(port)) {
        suggested.push({
          type: 'L',
          srcHost: '127.0.0.1',
          srcPort: port,
          dstHost: '127.0.0.1',
          dstPort: port,
          status: 'suggested',
          auto: true
        });
      }
    });
    
    return suggested;
  }, [forwards, detectedPorts, suggestedPorts]);

  const handleEdit = (f: Forward) => {
    setEditingId(f.id || null);
    setEditForm({ ...f });
  };

  const saveEdit = () => {
    if (editingId && editForm && onEdit) {
      onEdit(editingId, editForm);
      setEditingId(null);
      setEditForm(null);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const getPortName = (port: number) => {
    const info = COMMON_DEV_PORTS.find(p => p.port === port);
    return info ? info.name : '';
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 8, boxSizing: 'border-box', gap: 8 }}>
      {/* Add new forward form */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: (e.target.value as any) })}>
          <option value="L">Local → Remote</option>
          <option value="R">Remote → Local</option>
        </select>
        <input 
          style={{ width: 140 }} 
          placeholder="src host" 
          value={form.srcHost} 
          onChange={(e) => setForm({ ...form, srcHost: e.target.value })} 
        />
        <input 
          style={{ width: 80 }} 
          placeholder="src port" 
          type="number" 
          value={form.srcPort} 
          onChange={(e) => setForm({ ...form, srcPort: Number(e.target.value) || 0 })} 
        />
        <span>→</span>
        <input 
          style={{ width: 140 }} 
          placeholder="dst host" 
          value={form.dstHost} 
          onChange={(e) => setForm({ ...form, dstHost: e.target.value })} 
        />
        <input 
          style={{ width: 80 }} 
          placeholder="dst port" 
          type="number" 
          value={form.dstPort} 
          onChange={(e) => setForm({ ...form, dstPort: Number(e.target.value) || 0 })} 
        />
        <button onClick={() => {
          const f = { ...form };
          // Normalize common mistakes
          const isNumHost = /^\d+$/.test(f.dstHost.trim());
          if (isNumHost) {
            if (!f.dstPort || f.dstPort === 0) {
              f.dstPort = Number(f.dstHost.trim()) || f.dstPort;
              f.dstHost = '127.0.0.1';
            } else {
              alert('Destination host looks like a port. Please place the port into the port field.');
              return;
            }
          }
          if (!f.srcHost) f.srcHost = '127.0.0.1';
          if (!f.dstHost) f.dstHost = '127.0.0.1';
          if (!f.srcPort || !f.dstPort) { 
            alert('Please provide valid source/destination ports'); 
            return; 
          }
          onAdd(f);
        }}>Add</button>
      </div>

      {/* Toggle suggestions */}
      {suggestedForwards.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button 
            style={{ fontSize: 12, padding: '2px 8px' }}
            onClick={() => setShowSuggestions(!showSuggestions)}
          >
            {showSuggestions ? '▼' : '▶'} Suggestions ({suggestedForwards.length})
          </button>
        </div>
      )}

      {/* Forwards list */}
      <div style={{ flex: 1, overflow: 'auto', borderTop: '1px solid #333', paddingTop: 8 }}>
        {/* Show suggestions first */}
        {showSuggestions && suggestedForwards.map((f, idx) => (
          <div 
            key={`suggest-${f.dstPort}`} 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              padding: '6px 4px', 
              borderBottom: '1px solid #222',
              opacity: 0.7
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ 
                width: 8, 
                height: 8, 
                borderRadius: '50%', 
                background: f.status === 'detected' ? '#4a9f4a' : '#888',
                marginRight: 8,
                flexShrink: 0
              }} title={f.status === 'detected' ? 'Port is open on remote' : 'Port not detected'} />
              <div>
                <strong>{f.type}</strong> {f.srcHost}:{f.srcPort} → {f.dstHost}:{f.dstPort}
                <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>
                  {getPortName(f.dstPort)}
                </span>
                <span style={{ 
                  marginLeft: 8, 
                  fontSize: 11, 
                  padding: '1px 4px', 
                  borderRadius: 3,
                  background: f.status === 'detected' ? '#4a5f3a' : '#3a4f5f',
                  color: '#fff'
                }}>
                  {f.status === 'detected' ? 'Open' : 'Common'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button 
                style={{ fontSize: 12 }}
                onClick={() => onActivate ? onActivate(f) : onAdd(f)}
              >
                Activate
              </button>
            </div>
          </div>
        ))}

        {/* Active forwards */}
        {forwards.length === 0 && suggestedForwards.length === 0 && (
          <div style={{ opacity: 0.7 }}>No forwards yet.</div>
        )}
        
        {forwards.map((f) => (
          <div 
            key={f.id || `${f.type}-${f.srcHost}:${f.srcPort}`} 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              padding: '6px 4px', 
              borderBottom: '1px solid #222' 
            }}
          >
            {editingId === f.id && editForm ? (
              // Edit mode
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1 }}>
                <select 
                  value={editForm.type} 
                  onChange={(e) => setEditForm({ ...editForm, type: e.target.value as any })}
                >
                  <option value="L">L</option>
                  <option value="R">R</option>
                </select>
                <input 
                  style={{ width: 100 }} 
                  value={editForm.srcHost} 
                  onChange={(e) => setEditForm({ ...editForm, srcHost: e.target.value })} 
                />
                <input 
                  style={{ width: 60 }} 
                  type="number" 
                  value={editForm.srcPort} 
                  onChange={(e) => setEditForm({ ...editForm, srcPort: Number(e.target.value) || 0 })} 
                />
                <span>→</span>
                <input 
                  style={{ width: 100 }} 
                  value={editForm.dstHost} 
                  onChange={(e) => setEditForm({ ...editForm, dstHost: e.target.value })} 
                />
                <input 
                  style={{ width: 60 }} 
                  type="number" 
                  value={editForm.dstPort} 
                  onChange={(e) => setEditForm({ ...editForm, dstPort: Number(e.target.value) || 0 })} 
                />
                <button onClick={saveEdit} style={{ fontSize: 12 }}>Save</button>
                <button onClick={cancelEdit} style={{ fontSize: 12 }}>Cancel</button>
              </div>
            ) : (
              // Display mode
              <>
                <div>
                  <strong>{f.type}</strong> {f.srcHost}:{f.srcPort} → {f.dstHost}:{f.dstPort}
                  {getPortName(f.dstPort) && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>
                      {getPortName(f.dstPort)}
                    </span>
                  )}
                  <span style={{ 
                    marginLeft: 8, 
                    fontSize: 12, 
                    color: f.status === 'active' ? '#8fe18f' : 
                           f.status === 'error' ? '#f0a1a1' : 
                           f.status === 'closed' ? '#888' : '#bbb' 
                  }}>
                    ({f.status || 'starting'})
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {f.id && (f.status === 'active' || f.status === 'starting') && f.type === 'L' && (
                    <button 
                      onClick={async () => {
                        const url = `http://${f.srcHost}:${f.srcPort}`;
                        try {
                          const { open } = await import('@tauri-apps/plugin-shell');
                          await open(url);
                        } catch (e) {
                          console.error('Failed to open browser:', e);
                        }
                      }} 
                      style={{ fontSize: 12 }}
                      title="Open in browser"
                    >
                      🌐
                    </button>
                  )}
                  {f.id && f.status !== 'closed' && (
                    <>
                      <button 
                        onClick={() => handleEdit(f)} 
                        style={{ fontSize: 12 }}
                        title="Edit forward"
                      >
                        ✏️
                      </button>
                      <button 
                        onClick={() => onStop(f.id!)} 
                        style={{ fontSize: 12 }}
                        title="Stop forward"
                      >
                        ⏹
                      </button>
                    </>
                  )}
                  {f.id && (f.status === 'closed' || f.status === 'error') && (
                    <button 
                      onClick={() => onDelete?.(f.id!)} 
                      style={{ fontSize: 12 }}
                      title="Delete forward"
                    >
                      🗑
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}