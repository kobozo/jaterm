import React from 'react';

export default function BuildPanel() {
  return (
    <div>
      <strong>Build Output</strong>
      <div style={{ height: 200, border: '1px solid #333', marginTop: 8 }}>
        {/* Sub-terminal output goes here */}
      </div>
    </div>
  );
}

