// Frontend Git helpers that call into Rust
export type GitStatus = {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
};

export async function fetchStatus(path: string): Promise<GitStatus> {
  const { invoke } = await import('./api/tauri');
  return invoke<GitStatus>('git_status', { path });
}

