// Subscribe to backend file watch events
import { Channels } from './api/channels';

export async function subscribe(handler: (payload: unknown) => void) {
  const { listen } = await import('./api/tauri');
  return listen(Channels.WATCH_EVENT, ({ payload }) => handler(payload));
}

