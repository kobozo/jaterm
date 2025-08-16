// Centralized backend event names to keep parity with frontend
pub const PTY_OUTPUT: &str = "PTY_OUTPUT";
pub const PTY_EXIT: &str = "PTY_EXIT";
#[allow(dead_code)]
pub const GIT_STATUS: &str = "GIT_STATUS";
#[allow(dead_code)]
pub const WATCH_EVENT: &str = "WATCH_EVENT";
// SSH channel events
pub const SSH_OUTPUT: &str = "SSH_OUTPUT";
pub const SSH_EXIT: &str = "SSH_EXIT";
pub const SSH_UPLOAD_PROGRESS: &str = "SSH_UPLOAD_PROGRESS";
pub const SSH_OPENED: &str = "SSH_OPENED";
