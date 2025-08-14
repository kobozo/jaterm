// Typed wrappers around Tauri's invoke and event APIs.
// Replace any with proper types or use codegen.
export async function invoke<T = any>(cmd: string, payload?: any): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, payload);
}

export async function listen<T = unknown>(event: string, handler: (e: { event: string; payload: T }) => void) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, handler);
}

export async function emit<T = unknown>(event: string, payload?: T) {
  const { emit } = await import('@tauri-apps/api/event');
  return emit(event, payload);
}
