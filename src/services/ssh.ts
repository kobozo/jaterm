// Frontend SSH wrappers that call into Rust commands
export async function openTunnel(opts: { local: number; remoteHost: string; remote: number }) {
  const { invoke } = await import('./api/tauri');
  return invoke('ssh_open_tunnel', { opts });
}

export async function closeTunnel(id: string) {
  const { invoke } = await import('./api/tauri');
  return invoke('ssh_close_tunnel', { id });
}

