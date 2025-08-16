import React from 'react';

type Props = {
  cwd?: string | null;
  branch?: string;
  ahead?: number;
  behind?: number;
};

export default function GitStatusBar({ cwd, branch = '-', ahead = 0, behind = 0 }: Props) {
  // Hide entirely when not a git repo (branch reported as '-')
  if (!branch || branch === '-') return null;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span>{cwd ?? ''}</span>
      <span>Branch: {branch}</span>
      <span>Ahead/Behind: {ahead}/{behind}</span>
    </div>
  );
}
