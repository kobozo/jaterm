import React, { useMemo, useRef, useState } from 'react';

type Props = { 
  children: React.ReactNode;
  direction?: 'row' | 'column';
  size?: number; // Initial size percentage for first pane
  minSize?: number; // Minimum size in pixels
  maxSize?: number; // Maximum size in pixels
};

// Resizable split for N children with simple drag handles.
export default function SplitView({ children, direction = 'column', size = 50, minSize, maxSize }: Props) {
  const items = useMemo(() => React.Children.toArray(children), [children]);
  const [sizes, setSizes] = useState<number[]>(() => {
    const n = Math.max(1, items.length);
    if (n === 2 && size !== 50) {
      // Use provided size for first pane when there are 2 children
      return [size, 100 - size];
    }
    const each = 100 / n;
    return new Array(n).fill(each);
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ index: number; startPos: number; startSizes: number[] } | null>(null);
  const isHorizontal = direction === 'row';

  const startDrag = (index: number, e: React.MouseEvent) => {
    const startPos = isHorizontal ? e.clientX : e.clientY;
    dragRef.current = { index, startPos, startSizes: [...sizes] };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  };

  const onMove = (e: MouseEvent) => {
    const d = dragRef.current;
    if (!d || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const totalPx = isHorizontal ? rect.width : rect.height;
    const currentPos = isHorizontal ? e.clientX : e.clientY;
    const deltaPx = currentPos - d.startPos;
    const deltaPct = (deltaPx / totalPx) * 100;
    const i = d.index;
    const next = [...d.startSizes];
    
    // Calculate new sizes with constraints
    let newSize1 = d.startSizes[i] + deltaPct;
    let newSize2 = d.startSizes[i + 1] - deltaPct;
    
    // Apply min/max constraints in pixels if provided
    if (minSize !== undefined && i === 0) {
      const minPct = (minSize / totalPx) * 100;
      newSize1 = Math.max(minPct, newSize1);
      newSize2 = 100 - newSize1;
    }
    if (maxSize !== undefined && i === 0) {
      const maxPct = (maxSize / totalPx) * 100;
      newSize1 = Math.min(maxPct, newSize1);
      newSize2 = 100 - newSize1;
    }
    
    // Ensure minimum 5% for visibility
    next[i] = Math.max(5, Math.min(95, newSize1));
    next[i + 1] = Math.max(5, Math.min(95, newSize2));
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
    <div ref={containerRef} style={{ 
      height: '100%', 
      width: '100%',
      display: 'flex', 
      flexDirection: isHorizontal ? 'row' : 'column' 
    }}>
      {items.map((child, i) => (
        <React.Fragment key={(child as any)?.key ?? i}>
          <div style={{ 
            flexBasis: `${sizes[i]}%`, 
            flexGrow: 0, 
            flexShrink: 0, 
            [isHorizontal ? 'minWidth' : 'minHeight']: 0,
            position: 'relative',
            overflow: 'auto'
          }}>
            {child}
          </div>
          {i < items.length - 1 && (
            <div
              onMouseDown={(e) => startDrag(i, e)}
              style={{ 
                [isHorizontal ? 'width' : 'height']: 6, 
                [isHorizontal ? 'height' : 'width']: '100%',
                cursor: isHorizontal ? 'col-resize' : 'row-resize', 
                background: '#333',
                flexShrink: 0,
                '&:hover': { background: '#555' }
              }}
              title="Drag to resize"
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
