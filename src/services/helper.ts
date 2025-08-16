import { onSshUploadProgress, sshExec, sshHomeDir, sshSftpMkdirs, sshSftpWrite } from '@/types/ipc';

export const HELPER_VERSION = '0.1.0';
export const HELPER_NAME = 'jaterm-agent';
export const HELPER_REL_DIR = '.jaterm-helper';

// POSIX shell helper with health command
export const HELPER_CONTENT = `#!/bin/sh

case "$1" in
  health)
    echo '{"ok":true,"version":"${HELPER_VERSION}"}'
    exit 0
    ;;
  *)
    echo "jaterm-agent: unknown command: $1" 1>&2
    exit 1
    ;;
esac
`;

export async function ensureHelper(
  sessionId: string,
  opts: { show: (t: any) => string; update: (id: string, patch: any) => void; dismiss: (id: string) => void }
) {
  const { show, update, dismiss } = opts;
  try {
    const home = await sshHomeDir(sessionId);
    const helperDir = home.replace(/\/+$/, '') + '/' + HELPER_REL_DIR;
    const helperPath = helperDir + '/' + HELPER_NAME;

    // Check existing helper
    try {
      const res = await sshExec(sessionId, `'${helperPath.replace(/'/g, "'\\''")}' health`);
      if (res.exit_code === 0) {
        try {
          const j = JSON.parse(res.stdout);
          if (j && j.ok && j.version === HELPER_VERSION) {
            return; // up to date
          }
        } catch {}
      }
    } catch {}

    // Need to (re)install
    await sshSftpMkdirs(sessionId, helperDir);
    const b64 = btoa(HELPER_CONTENT);
    const toastId = show({ title: 'Installing helper', message: helperPath, progress: { current: 0, total: HELPER_CONTENT.length }, kind: 'info' });
    const unlisten = await onSshUploadProgress((p) => {
      if (p.path === helperPath) update(toastId, { progress: { current: p.written, total: p.total } });
    });
    try {
      await sshSftpWrite(sessionId, helperPath, b64);
      await sshExec(sessionId, `chmod +x '${helperPath.replace(/'/g, "'\\''")}'`);
      const res = await sshExec(sessionId, `'${helperPath.replace(/'/g, "'\\''")}' health`);
      if (res.exit_code !== 0) throw new Error(res.stderr || 'health failed');
      update(toastId, { title: 'Helper ready', kind: 'success' });
      setTimeout(() => dismiss(toastId), 1500);
    } finally {
      unlisten();
    }
  } catch (e) {
    const id = opts.show({ title: 'Helper install failed', message: String(e), kind: 'error' });
    setTimeout(() => opts.dismiss(id), 2500);
  }
}

