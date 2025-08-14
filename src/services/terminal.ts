// High-level terminal session manager (frontend)
// This will bind to Tauri commands for open/write/resize and subscribe to PTY events.

export type SessionId = string;

export type TerminalSession = {
  id: SessionId;
};

export class TerminalManager {
  sessions = new Map<SessionId, TerminalSession>();

  create(): TerminalSession {
    const id = `s_${Date.now()}`;
    const sess = { id };
    this.sessions.set(id, sess);
    return sess;
  }

  dispose(id: SessionId) {
    this.sessions.delete(id);
  }
}

export const terminalManager = new TerminalManager();

