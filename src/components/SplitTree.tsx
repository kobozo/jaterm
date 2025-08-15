import React, { useMemo, useRef, useState } from 'react';

export type LayoutLeaf = { type: 'leaf'; paneId: string };
export type LayoutSplit = { type: 'split'; direction: 'row' | 'column'; sizes?: number[]; children: LayoutNode[] };
export type LayoutNode = LayoutLeaf | LayoutSplit;

type Props = {
  node: LayoutNode;
  renderLeaf: (paneId: string) => React.ReactNode;
  onChange?: (next: LayoutNode) => void;
};

export default function SplitTree({ node, renderLeaf, onChange }: Props) {
  if (node.type === 'leaf') return <>{renderLeaf(node.paneId)}</>;
  return <SplitContainer node={node} renderLeaf={renderLeaf} onChange={onChange} />;
}

function SplitContainer({ node, renderLeaf, onChange }: { node: LayoutSplit; renderLeaf: (paneId: string) => React.ReactNode; onChange?: (n: LayoutNode) => void }) {
  const isRow = node.direction === 'row';
  const count = node.children.length;
  const initSizes = useMemo(() => {
    if (node.sizes && node.sizes.length === count) return node.sizes;
    return Array(count).fill(100 / count);
  }, [node.sizes, count]);

  const [sizes, setSizes] = useState<number[]>(initSizes);
  React.useEffect(() => { setSizes(initSizes); }, [initSizes.join(','), node.direction]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const startDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startPos = isRow ? e.clientX : e.clientY;
    const rect = containerRef.current?.getBoundingClientRect();
    const totalPx = isRow ? rect?.width || 0 : rect?.height || 0;
    const startSizes = [...sizes];
    const onMove = (ev: MouseEvent) => {
      const pos = isRow ? ev.clientX : ev.clientY;
      const deltaPx = pos - startPos;
      const deltaPct = (deltaPx / totalPx) * 100;
      const next = [...startSizes];
      next[index] = Math.max(5, Math.min(95, startSizes[index] + deltaPct));
      next[index + 1] = Math.max(5, Math.min(95, startSizes[index + 1] - deltaPct));
      const norm = normalize(next);
      setSizes(norm);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // propagate change
      onChange?.({ ...node, sizes: sizes.slice() });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: isRow ? 'row' : 'column', width: '100%', height: '100%' }}>
      {node.children.map((child, i) => (
        <React.Fragment key={i}>
          <div style={{ flexBasis: sizes[i] + '%', flexGrow: 0, flexShrink: 0, minWidth: 0, minHeight: 0 }}>
            {child.type === 'leaf' ? renderLeaf(child.paneId) : <SplitContainer node={child} renderLeaf={renderLeaf} onChange={(n) => onChange?.({ ...node, children: replaceAt(node.children, i, n) })} />}
          </div>
          {i < node.children.length - 1 && (
            <div
              onMouseDown={(e) => startDrag(i, e)}
              style={{
                cursor: isRow ? 'col-resize' : 'row-resize',
                background: 'transparent',
                flex: isRow ? '0 0 8px' : undefined,
                width: isRow ? 8 : '100%',
                height: isRow ? '100%' : 8,
                alignSelf: 'stretch',
                zIndex: 5,
                userSelect: 'none',
              }}
              onMouseEnter={(e) => ((e.currentTarget.style.background = '#3a3a3a'))}
              onMouseLeave={(e) => ((e.currentTarget.style.background = 'transparent'))}
              title="Drag to resize"
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function replaceAt<T>(arr: T[], index: number, value: T): T[] {
  const next = arr.slice();
  next[index] = value;
  return next;
}

function normalize(xs: number[]): number[] {
  const sum = xs.reduce((a, b) => a + b, 0) || 1;
  return xs.map((v) => (v / sum) * 100);
}
