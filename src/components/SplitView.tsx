import React, { useMemo, useRef, useState } from 'react';

type Props = { children: React.ReactNode };

// Vertical resizable split for N children with simple drag handles.
export default function SplitView({ children }: Props) {
  const items = useMemo(() => React.Children.toArray(children), [children]);
  const [sizes, setSizes] = useState<number[]>(() => {
    const n = Math.max(1, items.length);
    const each = 100 / n;
    return new Array(n).fill(each);
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ index: number; startY: number; startSizes: number[] } | null>(null);

  const startDrag = (index: number, e: React.MouseEvent) => {
    dragRef.current = { index, startY: e.clientY, startSizes: [...sizes] };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  };

  const onMove = (e: MouseEvent) => {
    const d = dragRef.current;
    if (!d || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const totalPx = rect.height;
    const deltaPx = e.clientY - d.startY;
    const deltaPct = (deltaPx / totalPx) * 100;
    const i = d.index;
    const next = [...d.startSizes];
    // Adjust size of pane i and i+1
    next[i] = Math.max(5, Math.min(95, d.startSizes[i] + deltaPct));
    next[i + 1] = Math.max(5, Math.min(95, d.startSizes[i + 1] - deltaPct));
    setSizes(next);
  };

  const endDrag = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', endDrag);
    dragRef.current = null;
    // Notify panes to refit
    window.dispatchEvent(new CustomEvent('jaterm:panes-resized'));
  };

  return (
    <div ref={containerRef} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {items.map((child, i) => (
        <React.Fragment key={(child as any)?.key ?? i}>
          <div style={{ flexBasis: `${sizes[i]}%`, flexGrow: 0, flexShrink: 0, minHeight: 0, position: 'relative' }}>
            {child}
          </div>
          {i < items.length - 1 && (
            <div
              onMouseDown={(e) => startDrag(i, e)}
              style={{ height: 6, cursor: 'row-resize', background: 'transparent' }}
              title="Drag to resize"
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
