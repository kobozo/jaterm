import { onSshUploadProgress, sshExec, sshHomeDir, sshSftpMkdirs, sshSftpWrite, helperLocalEnsure } from '@/types/ipc';
import { HELPER_VERSION, HELPER_NAME, HELPER_REL_DIR } from '@/shared/helper-constants';
// @ts-ignore - importing raw text
import helperScriptRaw from '@/shared/helper-script.sh?raw';

// Replace placeholder with actual version
export const HELPER_CONTENT = helperScriptRaw.replace('HELPER_VERSION_PLACEHOLDER', HELPER_VERSION);

export type HelperStatus = { ok: boolean; version?: string; path?: string };

export async function ensureHelper(
  sessionId: string,
  opts: { show: (t: any) => string; update: (id: string, patch: any) => void; dismiss: (id: string) => void }
): Promise<HelperStatus> {
  const { show, update, dismiss } = opts;
  try {
    console.info('[helper] ensureHelper: start', { sessionId });
    const home = await sshHomeDir(sessionId);
    console.info('[helper] home', home);
    const helperDir = home.replace(/\/+$/, '') + '/' + HELPER_REL_DIR;
    const helperPath = helperDir + '/' + HELPER_NAME;

    // Check existing helper
    try {
      const res = await sshExec(sessionId, `'${helperPath.replace(/'/g, "'\\''")}' health`);
      console.info('[helper] health check (existing)', { exit: res.exit_code, stdout: res.stdout, stderr: res.stderr });
      if (res.exit_code === 0) {
        try {
          const j = JSON.parse(res.stdout);
          if (j && j.ok && j.version === HELPER_VERSION) {
            console.info('[helper] up to date', j.version);
            return { ok: true, version: j.version, path: helperPath };
          }
        } catch {}
      }
    } catch {}

    // Need to (re)install
    console.info('[helper] mkdirs', helperDir);
    await sshSftpMkdirs(sessionId, helperDir);
    const b64 = btoa(HELPER_CONTENT);
    const toastId = show({ title: 'Installing helper', message: helperPath, progress: { current: 0, total: HELPER_CONTENT.length }, kind: 'info' });
    const unlisten = await onSshUploadProgress((p) => {
      if (p.path === helperPath) update(toastId, { progress: { current: p.written, total: p.total } });
    });
    try {
      console.info('[helper] upload start', helperPath);
      await sshSftpWrite(sessionId, helperPath, b64);
      console.info('[helper] chmod +x', helperPath);
      const ch = await sshExec(sessionId, `chmod +x '${helperPath.replace(/'/g, "'\\''")}'`);
      console.info('[helper] chmod result', { exit: ch.exit_code, stdout: ch.stdout, stderr: ch.stderr });
      const res = await sshExec(sessionId, `'${helperPath.replace(/'/g, "'\\''")}' health`);
      console.info('[helper] health after install', { exit: res.exit_code, stdout: res.stdout, stderr: res.stderr });
      if (res.exit_code !== 0) throw new Error(res.stderr || 'health failed');
      update(toastId, { title: 'Helper ready', kind: 'success' });
      setTimeout(() => dismiss(toastId), 1500);
      try {
        const j = JSON.parse(res.stdout);
        return { ok: !!j?.ok, version: j?.version, path: helperPath };
      } catch {
        return { ok: true, version: HELPER_VERSION, path: helperPath };
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

// Ensure local helper for local sessions; mirrors SSH ensure but simpler
export async function ensureLocalHelper(): Promise<HelperStatus> {
  try {
    const res = await helperLocalEnsure();
    return { ok: !!res?.ok, version: res?.version, path: res?.path };
  } catch (e) {
    console.error('[helper] local ensure error', e);
    return { ok: false };
  }
}
