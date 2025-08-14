#[tauri::command]
pub async fn ssh_open_tunnel(_opts: serde_json::Value) -> Result<String, String> {
    // TODO: call services::ssh
    Ok("ssh_tunnel_stub".into())
}

#[tauri::command]
pub async fn ssh_close_tunnel(_id: String) -> Result<(), String> {
    Ok(())
}

