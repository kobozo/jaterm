use std::collections::HashMap;
use std::io::Write as IoWrite;
use std::sync::{Arc, Mutex};

use portable_pty::{Child, MasterPty, PtySize};
use ssh2::{Session as SshSessionInner, Channel};
use std::net::TcpStream;
use std::sync::Mutex as StdMutex;

pub struct PtySession {
    pub id: String,
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send>,
    pub writer: Mutex<Box<dyn IoWrite + Send>>, // single writer taken once
}

pub type Shared<T> = Arc<Mutex<T>>;

pub struct AppState(pub Shared<Inner>);

pub struct Inner {
    pub sessions: HashMap<String, PtySession>,
    pub ssh: HashMap<String, SshSession>,
    pub ssh_channels: HashMap<String, SshChannel>,
    pub forwards: HashMap<String, SshForward>,
}

impl Default for AppState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Inner { sessions: HashMap::new(), ssh: HashMap::new(), ssh_channels: HashMap::new(), forwards: HashMap::new() })))
    }
}

impl Inner {
    pub fn insert(&mut self, s: PtySession) {
        self.sessions.insert(s.id.clone(), s);
    }
    pub fn get(&mut self, id: &str) -> Option<&mut PtySession> {
        self.sessions.get_mut(id)
    }
    pub fn remove(&mut self, id: &str) -> Option<PtySession> {
        self.sessions.remove(id)
    }
    pub fn resize(&mut self, id: &str, cols: u16, rows: u16) {
        if let Some(s) = self.sessions.get_mut(id) {
            let _ = s.master.resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }
}

pub struct SshSession {
    pub id: String,
    pub tcp: TcpStream,
    pub sess: SshSessionInner,
}

pub struct SshChannel {
    pub id: String,
    pub session_id: String,
    pub chan: Arc<StdMutex<Channel>>,
}

pub enum ForwardType { Local, Remote }

pub struct SshForward {
    pub id: String,
    pub session_id: String,
    pub ftype: ForwardType,
    pub src_host: String,
    pub src_port: u16,
    pub dst_host: String,
    pub dst_port: u16,
    pub shutdown: Arc<std::sync::atomic::AtomicBool>,
    pub thread: Option<std::thread::JoinHandle<()>>,
}
