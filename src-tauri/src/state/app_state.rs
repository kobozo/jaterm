use std::collections::HashMap;
use std::io::Write as IoWrite;
use std::sync::{Arc, Mutex};

use portable_pty::{Child, MasterPty, PtySize};

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
}

impl Default for AppState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Inner { sessions: HashMap::new() })))
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
