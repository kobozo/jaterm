#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod config_encrypted;
mod config_encrypted_v2;
mod shell;
mod events;
mod state;
mod utils;
mod menu;
mod encryption;
mod encryption_v2;

use tauri::Manager;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    // Enable in-app updates (multi-platform)
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(crate::state::app_state::AppState::default())
    .invoke_handler(tauri::generate_handler![
      commands::app::app_quit,
      config::get_config_dir,
      config::load_state,
      config::save_state,
      config::load_profiles,
      config::save_profiles,
      config::load_config,
      config::save_config,
      config_encrypted::load_profiles_encrypted,
      config_encrypted::save_profiles_encrypted,
      config_encrypted::check_profiles_need_migration,
      config_encrypted::migrate_profiles_to_encrypted,
      config::resolve_path_absolute,
      config::open_path_system,
      shell::install_zsh_osc7,
      shell::install_bash_osc7,
      shell::install_fish_osc7,
      commands::pty::get_available_shells,
      commands::pty::pty_open,
      commands::pty::pty_write,
      commands::pty::pty_resize,
      commands::pty::pty_kill,
      commands::ssh::ssh_connect,
      commands::ssh::ssh_disconnect,
      commands::keygen::generate_ssh_key,
      commands::keygen::deploy_public_key,
      commands::keygen::test_key_auth,
      commands::ssh::ssh_detect_ports,
      commands::ssh::ssh_open_shell,
      commands::ssh::ssh_write,
      commands::ssh::ssh_resize,
      commands::ssh::ssh_close_shell,
      commands::ssh::ssh_open_forward,
      commands::ssh::ssh_close_forward,
      commands::ssh::ssh_home_dir,
      commands::ssh::scan_ssh_keys,
      commands::ssh::ssh_sftp_list,
      commands::ssh::ssh_sftp_mkdirs,
      commands::ssh::ssh_sftp_read,
      commands::ssh::ssh_sftp_write,
      commands::ssh::ssh_deploy_helper,
      commands::ssh::ssh_sftp_download,
      commands::ssh::ssh_sftp_download_dir,
      commands::ssh::ssh_exec,
      commands::helper::helper_local_ensure,
      commands::helper::helper_local_exec,
      commands::helper::helper_get_version,
      commands::git::git_status,
      commands::watcher::watch_subscribe,
      commands::encryption::encryption_status,
      commands::encryption::set_master_key,
      commands::encryption::verify_master_key,
      commands::encryption::clear_master_key,
      commands::encryption::remove_master_key,
      commands::encryption::test_encryption,
      // New encryption v2 commands
      config_encrypted_v2::init_encryption,
      config_encrypted_v2::encryption_needs_setup,
      config_encrypted_v2::setup_encryption,
      config_encrypted_v2::verify_master_key_v2,
      config_encrypted_v2::recover_encryption,
      config_encrypted_v2::load_profiles_v2,
      config_encrypted_v2::save_profiles_v2,
      config_encrypted_v2::check_profiles_need_migration_v2,
      config_encrypted_v2::migrate_profiles_v2,
      config_encrypted_v2::export_encryption_key,
      config_encrypted_v2::import_encryption_key
    ])
    .setup(|app| {
      // Set up the menu
      let handle = app.handle().clone();
      let menu = menu::create_menu(&handle)?;
      app.set_menu(menu)?;
      
      // Handle menu events
      let handle_clone = handle.clone();
      app.on_menu_event(move |_app, event| {
        menu::handle_menu_event(&handle_clone, event.id().as_ref());
      });
      
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
