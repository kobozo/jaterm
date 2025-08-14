import React from 'react';

type Tab = { id: string; title: string; isWelcome?: boolean };

type Props = {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
};

export default function TabsBar({ tabs, activeId, onSelect, onClose, onAdd }: Props) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 6px',
      borderBottom: '1px solid #333',
      height: 36,
      minHeight: 36,
    }}>
      {tabs.map((t) => (
        <div
          key={t.id}
          onClick={() => onSelect(t.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            borderRadius: 4,
            cursor: 'pointer',
            background: t.id === activeId ? '#1f1f1f' : 'transparent',
            border: t.id === activeId ? '1px solid #444' : '1px solid transparent',
          }}
          title={t.title}
        >
          <span style={{ maxWidth: 180, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {t.title}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
            style={{ fontSize: 12 }}
            title="Close tab"
          >
            ×
          </button>
        </div>
      ))}
      <button onClick={onAdd} title="New tab" style={{ marginLeft: 6 }}>＋</button>
    </div>
  );
}
