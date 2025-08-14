// Typed command & event interface for Tauri IPC
// Frontend should import from here to keep parity with the backend.

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// Core models
export type Session = {
  id: string;
  cwd?: string;
  env?: Record<string, string>;
  shell?: string;
  ptyId?: string;
};

export type SshAuth =
  | { type: 'keyPath'; path: string; passphrase?: string }
  | { type: 'agent' }
  | { type: 'password'; password: string };

export type SshProfile = {
  id: string;
  host: string;
  port?: number;
  user?: string;
  auth?: SshAuth;
  jump?: string; // profile id
};

export type ForwardType = 'L' | 'R' | 'D'; // Local, Remote, Dynamic (SOCKS)

export type PortForward = {
  id: string;
  type: ForwardType;
  srcHost: string;
  srcPort: number;
  dstHost: string;
  dstPort: number;
  status?: 'starting' | 'active' | 'error' | 'closed';
};

export type GitStatus = {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  conflicted?: number;
};

// Commands
export async function ptyOpen(args: {
  cwd?: string;
  env?: Record<string, string>;
  shell?: string;
  cols?: number;
  rows?: number;
}): Promise<{ ptyId: string } | string> {
  // Current backend returns a string stub; normalize when implemented
  return invoke('pty_open', args as any);
}

export function ptyWrite(args: { ptyId: string; data: string }) {
  // Tauri v2 maps snake_case <-> camelCase automatically; the macro expects `ptyId` here.
  return invoke('pty_write', { ptyId: args.ptyId, data: args.data } as any);
}

export function ptyResize(args: { ptyId: string; cols: number; rows: number }) {
  return invoke('pty_resize', { ptyId: args.ptyId, cols: args.cols, rows: args.rows } as any);
}

export function ptyKill(args: { ptyId: string }) {
  return invoke('pty_kill', { ptyId: args.ptyId } as any);
}

export async function sshConnect(profileId: string): Promise<{ sessionId: string } | string> {
  return invoke('ssh_connect', { profileId } as any);
}

export function sshDisconnect(sessionId: string) {
  return invoke('ssh_disconnect', { sessionId } as any);
}

export async function sshOpenForward(args: {
  sessionId: string;
  forward: PortForward;
}): Promise<{ forwardId: string } | string> {
  return invoke('ssh_open_forward', args as any);
}

export function sshCloseForward(forwardId: string) {
  return invoke('ssh_close_forward', { forwardId } as any);
}

export function gitStatus(cwd: string): Promise<GitStatus> {
  return invoke('git_status', { path: cwd } as any);
}

export function watchSubscribe(paths: string[]): Promise<{ subscriptionId: string } | void> {
  return invoke('watch_subscribe', { paths } as any);
}

export function watchUnsubscribe(subscriptionId: string) {
  return invoke('watch_unsubscribe', { subscriptionId } as any);
}

// Events
export type PtyOutputEvent = { ptyId: string; data: string };
export type PtyExitEvent = { ptyId: string; code?: number; signal?: number };
export type GitStatusEvent = { cwd: string; status: GitStatus };
export type WatchEvent = { path: string; kind: string };
export type TunnelStateEvent = { forwardId: string; status: NonNullable<PortForward['status']> };

export function onPtyOutput(handler: (e: PtyOutputEvent) => void): Promise<UnlistenFn> {
  return listen<PtyOutputEvent>('PTY_OUTPUT', (ev) => handler(ev.payload));
}

export function onPtyExit(handler: (e: PtyExitEvent) => void): Promise<UnlistenFn> {
  return listen<PtyExitEvent>('PTY_EXIT', (ev) => handler(ev.payload));
}

export function onGitStatus(handler: (e: GitStatusEvent) => void): Promise<UnlistenFn> {
  return listen<GitStatusEvent>('GIT_STATUS', (ev) => handler(ev.payload));
}

export function onWatchEvent(handler: (e: WatchEvent) => void): Promise<UnlistenFn> {
  return listen<WatchEvent>('WATCH_EVENT', (ev) => handler(ev.payload));
}

export function onTunnelState(handler: (e: TunnelStateEvent) => void): Promise<UnlistenFn> {
  return listen<TunnelStateEvent>('SSH_TUNNEL_STATE', (ev) => handler(ev.payload));
}

// App controls
export function appQuit(): Promise<void> {
  return invoke('app_quit');
}

// Config / State persistence
export function getConfigDir(appName?: string): Promise<string> {
  return invoke('get_config_dir', { appName } as any);
}

export function loadState(appName?: string): Promise<any> {
  return invoke('load_state', { appName } as any);
}

export function saveState(state: any, appName?: string): Promise<void> {
  return invoke('save_state', { appName, state } as any);
}

// Shell helpers
export function installZshOsc7(): Promise<boolean> {
  return invoke('install_zsh_osc7');
}
