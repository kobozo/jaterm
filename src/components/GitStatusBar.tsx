import React from 'react';

type Props = {
  cwd?: string | null;
  branch?: string;
  ahead?: number;
  behind?: number;
  staged?: number;
  unstaged?: number;
};

export default function GitStatusBar({ cwd, branch = '-', ahead = 0, behind = 0, staged = 0, unstaged = 0 }: Props) {
  // Hide entirely when not a git repo (branch reported as '-')
  if (!branch || branch === '-') return null;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span>{cwd ?? ''}</span>
      <span style={{ width: 1, height: 14, background: '#444', display: 'inline-block' }} />
      <span>Branch: {branch}</span>
      {(ahead > 0 || behind > 0) && <span>↑{ahead} ↓{behind}</span>}
      {staged > 0 && <span style={{ color: '#0dbc79' }}>●{staged}</span>}
      {unstaged > 0 && <span style={{ color: '#e5e510' }}>○{unstaged}</span>}
    </div>
  );
}
