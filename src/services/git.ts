import { helperLocalExec, sshExec } from '@/types/ipc';

export type GitStatus = { branch: string; ahead: number; behind: number; staged: number; unstaged: number };

export async function gitStatusViaHelper(opts: { kind?: 'local' | 'ssh'; sessionId?: string; helperPath?: string | null }, cwd: string): Promise<GitStatus> {
  // Local: use helperLocalExec
  if (opts.kind !== 'ssh') {
    try {
      console.info('[git] helper local git-status cwd=', cwd);
      const res = await helperLocalExec('git-status', [cwd]);
      if (res.exit_code === 0 && res.stdout) {
        const j = JSON.parse(res.stdout);
        return normalize(j);
      }
    } catch {}
    // Fallback: conservative defaults
    return { branch: '-', ahead: 0, behind: 0, staged: 0, unstaged: 0 };
  }
  // SSH: require helperPath + sessionId
  if (!opts.sessionId || !opts.helperPath) {
    console.info('[git] helper ssh not ready; sessionId or helperPath missing', { cwd, sessionId: opts.sessionId, helperPath: opts.helperPath });
    return { branch: '-', ahead: 0, behind: 0, staged: 0, unstaged: 0 };
  }
  const esc = (s: string) => s.replace(/'/g, "'\\''");
  try {
    console.info('[git] helper ssh git-status cwd=', cwd);
    const cmd = `'${esc(opts.helperPath)}' git-status '${esc(cwd)}'`;
    const res = await sshExec(opts.sessionId, cmd);
    if (res.exit_code === 0 && res.stdout) {
      const j = JSON.parse(res.stdout);
      return normalize(j);
    }
  } catch {}
  return { branch: '-', ahead: 0, behind: 0, staged: 0, unstaged: 0 };
}

export type GitChange = { path: string; x: string; y: string; staged: boolean };

export async function gitListChanges(opts: { kind?: 'local' | 'ssh'; sessionId?: string; helperPath?: string | null }, cwd: string): Promise<GitChange[]> {
  if (opts.kind !== 'ssh') {
    try {
      const res = await helperLocalExec('git-changes', [cwd]);
      if (res.exit_code === 0 && res.stdout) return JSON.parse(res.stdout);
    } catch {}
    return [];
  }
  if (!opts.sessionId || !opts.helperPath) return [];
  const esc = (s: string) => s.replace(/'/g, "'\\''");
  try {
    const cmd = `'${esc(opts.helperPath)}' git-changes '${esc(cwd)}'`;
    const res = await sshExec(opts.sessionId, cmd);
    if (res.exit_code === 0 && res.stdout) return JSON.parse(res.stdout);
  } catch {}
  return [];
}

export async function gitDiffFile(opts: { kind?: 'local' | 'ssh'; sessionId?: string; helperPath?: string | null }, cwd: string, file: string, staged?: boolean): Promise<string> {
  const mode = staged ? 'staged' : 'work';
  if (opts.kind !== 'ssh') {
    try {
      const res = await helperLocalExec('git-diff', [cwd, file, mode]);
      if (res.exit_code === 0) return res.stdout;
    } catch {}
    return '';
  }
  if (!opts.sessionId || !opts.helperPath) return '';
  const esc = (s: string) => s.replace(/'/g, "'\\''");
  try {
    const cmd = `'${esc(opts.helperPath)}' git-diff '${esc(cwd)}' '${esc(file)}' '${esc(mode)}'`;
    const res = await sshExec(opts.sessionId, cmd);
    if (res.exit_code === 0) return res.stdout;
  } catch {}
  return '';
}

export async function gitCommit(opts: { kind?: 'local' | 'ssh'; sessionId?: string; helperPath?: string | null }, cwd: string, message: string): Promise<{ output: string }> {
  if (opts.kind !== 'ssh') {
    const res = await helperLocalExec('git-commit', [cwd, message]);
    return { output: (res.stdout || '') + (res.stderr || '') };
  }
  if (!opts.sessionId || !opts.helperPath) return { output: 'helper not ready' };
  const esc = (s: string) => s.replace(/'/g, "'\\''");
  const cmd = `'${esc(opts.helperPath)}' git-commit '${esc(cwd)}' '${esc(message)}'`;
  const res = await sshExec(opts.sessionId, cmd);
  return { output: (res.stdout || '') + (res.stderr || '') };
}

export async function gitSync(opts: { kind?: 'local' | 'ssh'; sessionId?: string; helperPath?: string | null }, cwd: string): Promise<{ output: string }> {
  if (opts.kind !== 'ssh') {
    const res = await helperLocalExec('git-sync', [cwd]);
    return { output: (res.stdout || '') + (res.stderr || '') };
  }
  if (!opts.sessionId || !opts.helperPath) return { output: 'helper not ready' };
  const esc = (s: string) => s.replace(/'/g, "'\\''");
  const cmd = `'${esc(opts.helperPath)}' git-sync '${esc(cwd)}'`;
  const res = await sshExec(opts.sessionId, cmd);
  return { output: (res.stdout || '') + (res.stderr || '') };
}

export async function gitStageFile(opts: { kind?: 'local' | 'ssh'; sessionId?: string; helperPath?: string | null }, cwd: string, file: string): Promise<{ output: string }> {
  if (opts.kind !== 'ssh') {
    const res = await helperLocalExec('git-stage', [cwd, file]);
    return { output: (res.stdout || '') + (res.stderr || '') };
  }
  if (!opts.sessionId || !opts.helperPath) return { output: 'helper not ready' };
  const esc = (s: string) => s.replace(/'/g, "'\\''");
  const cmd = `'${esc(opts.helperPath)}' git-stage '${esc(cwd)}' '${esc(file)}'`;
  const res = await sshExec(opts.sessionId, cmd);
  return { output: (res.stdout || '') + (res.stderr || '') };
}

export async function gitUnstageFile(opts: { kind?: 'local' | 'ssh'; sessionId?: string; helperPath?: string | null }, cwd: string, file: string): Promise<{ output: string }> {
  if (opts.kind !== 'ssh') {
    const res = await helperLocalExec('git-unstage', [cwd, file]);
    return { output: (res.stdout || '') + (res.stderr || '') };
  }
  if (!opts.sessionId || !opts.helperPath) return { output: 'helper not ready' };
  const esc = (s: string) => s.replace(/'/g, "'\\''");
  const cmd = `'${esc(opts.helperPath)}' git-unstage '${esc(cwd)}' '${esc(file)}'`;
  const res = await sshExec(opts.sessionId, cmd);
  return { output: (res.stdout || '') + (res.stderr || '') };
}

function normalize(j: any): GitStatus {
  return {
    branch: typeof j?.branch === 'string' ? j.branch : '- ',
    ahead: Number(j?.ahead) || 0,
    behind: Number(j?.behind) || 0,
    staged: Number(j?.staged) || 0,
    unstaged: Number(j?.unstaged) || 0,
  };
}
