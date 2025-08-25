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
  os?: string; // auto-detected or user-selected OS
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

// Shell types
export interface ShellInfo {
  path: string;
  name: string;
}

// Commands
export async function getAvailableShells(): Promise<ShellInfo[]> {
  return invoke('get_available_shells');
}

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

export type JsSshAuth = { password?: string; key_path?: string; passphrase?: string; agent?: boolean };
export type JsSshProfile = { host: string; port?: number; user: string; auth?: JsSshAuth; timeout_ms?: number; trust_host?: boolean };

export async function sshConnect(profile: JsSshProfile): Promise<string> {
  // Normalize hostnames to lowercase
  const normalized = { ...profile, host: profile.host?.toLowerCase?.() ?? profile.host };
  return invoke('ssh_connect', { profile: normalized } as any);
}

// Helper to connect with host trust prompt
export async function sshConnectWithTrustPrompt(profile: JsSshProfile): Promise<string> {
  try {
    return await sshConnect({ ...profile, trust_host: profile.trust_host ?? false });
  } catch (e: any) {
    const msg = String(e || '');
    try {
      const j = JSON.parse(msg);
      if (j && j.error === 'KNOWN_HOSTS_PROMPT') {
        const accept = window.confirm(`First connect to ${j.host}:${j.port}\nKey: ${j.keyType}\nFingerprint (SHA256): ${j.fingerprintSHA256}\n\nTrust this host and continue?`);
        if (!accept) throw new Error('Host not trusted');
        return await sshConnect({ ...profile, trust_host: true });
      }
    } catch {}
    throw e;
  }
}

export function sshDisconnect(sessionId: string) {
  return invoke('ssh_disconnect', { sessionId } as any);
}

export function sshDetectPorts(sessionId: string): Promise<number[]> {
  return invoke('ssh_detect_ports', { sessionId } as any);
}

export async function sshOpenShell(args: { sessionId: string; cwd?: string; cols?: number; rows?: number }): Promise<string> {
  return invoke('ssh_open_shell', { sessionId: args.sessionId, cwd: args.cwd, cols: args.cols, rows: args.rows } as any);
}

export function sshWrite(args: { channelId: string; data: string }) {
  return invoke('ssh_write', { channelId: args.channelId, data: args.data } as any);
}

export function sshResize(args: { channelId: string; cols: number; rows: number }) {
  return invoke('ssh_resize', { channelId: args.channelId, cols: args.cols, rows: args.rows } as any);
}

export function sshCloseShell(channelId: string) {
  return invoke('ssh_close_shell', { channelId } as any);
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

export interface SshKeyInfo {
  path: string;
  name: string;
  key_type: string;
}

export function scanSshKeys(): Promise<SshKeyInfo[]> {
  return invoke('scan_ssh_keys');
}

export function gitStatus(cwd: string): Promise<GitStatus> {
  return invoke('git_status', { path: cwd } as any);
}

// ----- SSH Key Generation -----
export interface GeneratedKey {
  private_key_path: string;
  public_key_path: string;
  public_key_string: string;
  fingerprint: string;
}

export const generateSshKey = (algorithm: 'ed25519' | 'rsa', passphrase: string | null, profileName: string): Promise<GeneratedKey> =>
  invoke('generate_ssh_key', { algorithm, passphrase, profileName });

export const deployPublicKey = (sessionId: string, publicKey: string): Promise<void> =>
  invoke('deploy_public_key', { sessionId, publicKey });

export const testKeyAuth = (host: string, port: number, user: string, keyPath: string, passphrase: string | null): Promise<boolean> =>
  invoke('test_key_auth', { host, port, user, keyPath, passphrase });

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

export type SshOutputEvent = { channelId: string; dataBytes?: string; data?: string };
export type SshExitEvent = { channelId: string };
export type SshOpenedEvent = { channelId: string };

export function onSshOutput(handler: (e: SshOutputEvent) => void): Promise<UnlistenFn> {
  return listen<SshOutputEvent>('SSH_OUTPUT', (ev) => handler(ev.payload));
}

export function onSshExit(handler: (e: SshExitEvent) => void): Promise<UnlistenFn> {
  return listen<SshExitEvent>('SSH_EXIT', (ev) => handler(ev.payload));
}

export function onSshOpened(handler: (e: SshOpenedEvent) => void): Promise<UnlistenFn> {
  return listen<SshOpenedEvent>('SSH_OPENED', (ev) => handler(ev.payload));
}

export function sshHomeDir(sessionId: string): Promise<string> {
  return invoke('ssh_home_dir', { sessionId } as any);
}

export type SftpEntry = { name: string; path: string; is_dir: boolean };
export function sshSftpList(sessionId: string, path: string): Promise<SftpEntry[]> {
  return invoke('ssh_sftp_list', { sessionId, path } as any);
}

export function sshSftpMkdirs(sessionId: string, path: string): Promise<void> {
  return invoke('ssh_sftp_mkdirs', { sessionId, path } as any);
}

export function sshSftpWrite(sessionId: string, remotePath: string, dataBase64: string): Promise<void> {
  // Tauri maps snake_case param `data_b64` to camelCase `dataB64` in JS
  return invoke('ssh_sftp_write', { sessionId, remotePath, dataB64: dataBase64 } as any);
}

export function sshDeployHelper(sessionId: string, remotePath: string): Promise<void> {
  return invoke('ssh_deploy_helper', { sessionId, remotePath } as any);
}

export function sshSftpRead(sessionId: string, remotePath: string): Promise<string> {
  return invoke('ssh_sftp_read', { sessionId, remotePath } as any);
}

export function sshSftpDownload(sessionId: string, remotePath: string, localPath: string): Promise<void> {
  return invoke('ssh_sftp_download', { sessionId, remotePath, localPath } as any);
}

export function sshSftpDownloadDir(sessionId: string, remoteDir: string, localDir: string): Promise<void> {
  return invoke('ssh_sftp_download_dir', { sessionId, remoteDir, localDir } as any);
}

export type SshUploadProgress = { path: string; written: number; total: number };
export function onSshUploadProgress(handler: (e: SshUploadProgress) => void): Promise<UnlistenFn> {
  return listen<SshUploadProgress>('SSH_UPLOAD_PROGRESS', (ev) => handler(ev.payload));
}

export type ExecResult = { stdout: string; stderr: string; exit_code: number };
export function sshExec(sessionId: string, command: string): Promise<ExecResult> {
  return invoke('ssh_exec', { sessionId, command } as any);
}

// App controls
export function appQuit(): Promise<void> {
  return invoke('app_quit');
}

// Encryption
export type EncryptionStatus = {
  has_master_key: boolean;
  hardware_security_available: boolean;
};

export type EncryptedData = {
  nonce: string;
  ciphertext: string;
  salt: string;
  version: number;
};

export function encryptionStatus(): Promise<EncryptionStatus> {
  return invoke('encryption_status');
}

export function setMasterKey(password: string): Promise<void> {
  return invoke('set_master_key', { password } as any);
}

export function verifyMasterKey(password: string): Promise<boolean> {
  return invoke('verify_master_key', { password } as any);
}

export function clearMasterKey(): Promise<void> {
  return invoke('clear_master_key');
}

export function removeMasterKey(): Promise<void> {
  return invoke('remove_master_key');
}

export function loadProfilesEncrypted(appName?: string): Promise<any> {
  return invoke('load_profiles_encrypted', { appName } as any);
}

export function saveProfilesEncrypted(profiles: any, appName?: string): Promise<void> {
  return invoke('save_profiles_encrypted', { appName, profiles } as any);
}

export function checkProfilesNeedMigration(appName?: string): Promise<boolean> {
  return invoke('check_profiles_need_migration', { appName } as any);
}

export function migrateProfilesToEncrypted(password: string, appName?: string): Promise<void> {
  return invoke('migrate_profiles_to_encrypted', { appName, password } as any);
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

// Split persistence files
export function loadProfiles(appName?: string): Promise<any> {
  return invoke('load_profiles', { appName } as any);
}
export function saveProfiles(profiles: any, appName?: string): Promise<void> {
  return invoke('save_profiles', { appName, profiles } as any);
}
export function loadConfig(appName?: string): Promise<any> {
  return invoke('load_config', { appName } as any);
}
export function saveConfig(config: any, appName?: string): Promise<void> {
  return invoke('save_config', { appName, config } as any);
}

// Shell helpers
export function installZshOsc7(): Promise<boolean> {
  return invoke('install_zsh_osc7');
}

export function resolvePathAbsolute(path: string): Promise<string> {
  return invoke('resolve_path_absolute', { path } as any);
}

export function installBashOsc7(): Promise<boolean> {
  return invoke('install_bash_osc7');
}

export function installFishOsc7(): Promise<boolean> {
  return invoke('install_fish_osc7');
}

export function openPathSystem(path?: string): Promise<void> {
  return invoke('open_path_system', { path } as any);
}

// Local helper (for parity with SSH helper)
export type HelperStatus = { ok: boolean; version?: string; path?: string };
export function helperLocalEnsure(): Promise<HelperStatus> {
  return invoke('helper_local_ensure');
}
export function helperGetVersion(): Promise<string> {
  return invoke('helper_get_version');
}
export type HelperExecResult = { stdout: string; stderr: string; exit_code: number };
export function helperLocalExec(command: string, args?: string[]): Promise<HelperExecResult> {
  return invoke('helper_local_exec', { command, args } as any);
}
