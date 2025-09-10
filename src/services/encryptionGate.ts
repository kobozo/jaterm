import { initEncryption, encryptionNeedsSetup } from '@/services/api/encryption_v2';

/**
 * Ensure encryption is initialized and ready for use.
 * - Returns true if ready without prompting.
 * - If not initialized, triggers the Master Key dialog via a window event
 *   and waits for either a successful unlock/setup (profiles-unlocked)
 *   or dialog close (master-key-dialog-closed).
 */
export async function ensureEncryptionReady(
  reason?: string,
  opts: { allowSetup?: boolean; timeoutMs?: number } = {}
): Promise<boolean> {
  try {
    const ok = await initEncryption();
    if (ok) return true;
  } catch {}

  const { allowSetup = true, timeoutMs = 120_000 } = opts;
  if (!allowSetup) return false;

  let needsSetup = false;
  try {
    needsSetup = await encryptionNeedsSetup();
  } catch {}

  // Ask App to open the Master Key dialog lazily
  try {
    const evt: any = new CustomEvent('open-master-key-dialog', {
      detail: { mode: needsSetup ? 'setup' : 'unlock', reason },
    });
    window.dispatchEvent(evt);
  } catch {}

  // Wait for unlock or cancellation
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const onUnlocked = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(true);
    };
    const onClosed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(false);
    };
    const onTimeout = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      window.removeEventListener('profiles-unlocked', onUnlocked as any);
      window.removeEventListener('master-key-dialog-closed', onClosed as any);
      clearTimeout(timer);
    };

    window.addEventListener('profiles-unlocked', onUnlocked as any, { once: true } as any);
    window.addEventListener('master-key-dialog-closed', onClosed as any, { once: true } as any);
    const timer = setTimeout(onTimeout, timeoutMs);
  });
}

/**
 * Check if encryption is currently initialized without prompting.
 */
export async function isEncryptionInitialized(): Promise<boolean> {
  try {
    return await initEncryption();
  } catch {
    return false;
  }
}
