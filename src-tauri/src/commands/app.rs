#[tauri::command]
pub async fn app_quit(app: tauri::AppHandle) {
    // graceful exit; Tauri will close the window and stop the event loop
    app.exit(0);
}
