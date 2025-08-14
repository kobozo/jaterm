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
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span>{cwd ?? ''}</span>
      <span>Branch: {branch}</span>
      <span>Ahead/Behind: {ahead}/{behind}</span>
      <span>Staged/Unstaged: {staged}/{unstaged}</span>
    </div>
  );
}
