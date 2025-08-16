#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod shell;
mod events;
mod state;
mod utils;
use tauri::Manager;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(crate::state::app_state::AppState::default())
    .invoke_handler(tauri::generate_handler![
      commands::app::app_quit,
      config::get_config_dir,
      config::load_state,
      config::save_state,
      config::resolve_path_absolute,
      config::open_path_system,
      shell::install_zsh_osc7,
      shell::install_bash_osc7,
      shell::install_fish_osc7,
      commands::pty::pty_open,
      commands::pty::pty_write,
      commands::pty::pty_resize,
      commands::pty::pty_kill,
      commands::ssh::ssh_connect,
      commands::ssh::ssh_disconnect,
      commands::ssh::ssh_open_shell,
      commands::ssh::ssh_write,
      commands::ssh::ssh_resize,
      commands::ssh::ssh_close_shell,
      commands::ssh::ssh_open_tunnel,
      commands::ssh::ssh_close_tunnel,
      commands::ssh::ssh_home_dir,
      commands::ssh::ssh_sftp_list,
      commands::ssh::ssh_sftp_mkdirs,
      commands::ssh::ssh_sftp_write,
      commands::ssh::ssh_exec,
      commands::git::git_status,
      commands::watcher::watch_subscribe
    ])
    .setup(|app| {
      // Initialize shared state or services here.
      #[cfg(debug_assertions)]
      if let Some(main) = app.get_webview_window("main") {
        main.open_devtools();
        let _ = main.set_focus();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
