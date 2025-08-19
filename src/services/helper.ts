import { onSshUploadProgress, sshExec, sshHomeDir, sshSftpMkdirs, sshSftpWrite, helperLocalEnsure, helperGetVersion } from '@/types/ipc';

export type HelperStatus = { ok: boolean; version?: string; path?: string };

// Helper deployment for SSH sessions
export async function ensureHelper(
  sessionId: string,
  opts: { show: (t: any) => string; update: (id: string, patch: any) => void; dismiss: (id: string) => void }
): Promise<HelperStatus> {
  const { show, update, dismiss } = opts;
  try {
    console.info('[helper] ensureHelper: start', { sessionId });
    
    // Get the helper version from backend
    const requiredVersion = await helperGetVersion();
    console.info('[helper] required version:', requiredVersion);
    
    const home = await sshHomeDir(sessionId);
    console.info('[helper] home', home);
    const helperDir = home.replace(/\/+$/, '') + '/.jaterm-helper';
    const helperPath = helperDir + '/jaterm-agent';

    // Check existing helper
    try {
      const res = await sshExec(sessionId, `'${helperPath.replace(/'/g, "'\\''")}'  health`);
      console.info('[helper] health check (existing)', { exit: res.exit_code, stdout: res.stdout, stderr: res.stderr });
      if (res.exit_code === 0) {
        try {
          const j = JSON.parse(res.stdout);
          if (j && j.ok && j.version === requiredVersion) {
            console.info('[helper] up to date', j.version);
            return { ok: true, version: j.version, path: helperPath };
          }
        } catch {}
      }
    } catch {}

    // Need to (re)install - get binary from backend
    console.info('[helper] mkdirs', helperDir);
    await sshSftpMkdirs(sessionId, helperDir);
    
    // Get the helper binary from the backend
    const toastId = show({ title: 'Installing helper', message: helperPath, progress: { current: 0, total: 100 }, kind: 'info' });
    
    const unlisten = await onSshUploadProgress((p) => {
      if (p.path === helperPath) {
        const percent = Math.round((p.written / p.total) * 100);
        update(toastId, { progress: { current: percent, total: 100 } });
      }
    });
    
    try {
      console.info('[helper] upload start', helperPath);
      // The backend will provide the binary directly
      await sshSftpWrite(sessionId, helperPath, 'BINARY_PLACEHOLDER');
      
      console.info('[helper] chmod +x', helperPath);
      const ch = await sshExec(sessionId, `chmod +x '${helperPath.replace(/'/g, "'\\''")}'`);
      console.info('[helper] chmod result', { exit: ch.exit_code, stdout: ch.stdout, stderr: ch.stderr });
      
      const res = await sshExec(sessionId, `'${helperPath.replace(/'/g, "'\\''")}'  health`);
      console.info('[helper] health after install', { exit: res.exit_code, stdout: res.stdout, stderr: res.stderr });
      
      if (res.exit_code !== 0) throw new Error(res.stderr || 'health failed');
      
      update(toastId, { title: 'Helper ready', kind: 'success' });
      setTimeout(() => dismiss(toastId), 1500);
      
      try {
        const j = JSON.parse(res.stdout);
        return { ok: !!j?.ok, version: j?.version, path: helperPath };
      } catch {
        return { ok: true, version: requiredVersion, path: helperPath };
      }
    } finally {
      unlisten();
    }
  } catch (e) {
    console.error('[helper] ensure error', e);
    // Try to close any existing install toast if present by updating/dismissing
    try {
      // We don't hold the id here reliably; rely on a new error toast and let any stale progress toast be dismissed by timeout
      const id = opts.show({ title: 'Helper install failed', message: String(e), kind: 'error' });
      setTimeout(() => opts.dismiss(id), 3000);
    } catch {}
    return { ok: false };
  }
}

// Ensure local helper for local sessions
export async function ensureLocalHelper(): Promise<HelperStatus> {
  try {
    const res = await helperLocalEnsure();
    return { ok: !!res?.ok, version: res?.version, path: res?.path };
  } catch (e) {
    console.error('[helper] local ensure error', e);
    return { ok: false };
  }
}