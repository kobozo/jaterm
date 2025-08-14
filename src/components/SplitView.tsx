import React from 'react';

type Props = { children: React.ReactNode };

// Simple placeholder for pane layout. Replace with resizable splitter.
export default function SplitView({ children }: Props) {
  return (
    <div style={{ height: '100%' }}>
      {children}
    </div>
  );
}

