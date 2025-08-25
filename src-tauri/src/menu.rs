use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, Wry,
};

pub fn create_menu(app: &AppHandle<Wry>) -> Result<Menu<Wry>, Box<dyn std::error::Error>> {
    // File menu items
    let new_tab = MenuItemBuilder::new("New Tab")
        .id("new_tab")
        .accelerator("CmdOrCtrl+T")
        .build(app)?;

    let new_window = MenuItemBuilder::new("New Window")
        .id("new_window")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    let close_tab = MenuItemBuilder::new("Close Tab")
        .id("close_tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let close_window = MenuItemBuilder::new("Close Window")
        .id("close_window")
        .accelerator("CmdOrCtrl+Shift+W")
        .build(app)?;

    let open_ssh = MenuItemBuilder::new("Open SSH Connection...")
        .id("open_ssh")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;

    let settings = MenuItemBuilder::new("Settings...")
        .id("settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    // Edit menu items
    let clear_terminal = MenuItemBuilder::new("Clear Terminal")
        .id("clear_terminal")
        .accelerator("CmdOrCtrl+L")
        .build(app)?;

    let find = MenuItemBuilder::new("Find...")
        .id("find")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;

    // View menu items
    let toggle_fullscreen = MenuItemBuilder::new("Toggle Full Screen")
        .id("toggle_fullscreen")
        .accelerator("F11")
        .build(app)?;

    let zoom_in = MenuItemBuilder::new("Zoom In")
        .id("zoom_in")
        .accelerator("CmdOrCtrl+Plus")
        .build(app)?;

    let zoom_out = MenuItemBuilder::new("Zoom Out")
        .id("zoom_out")
        .accelerator("CmdOrCtrl+Minus")
        .build(app)?;

    let reset_zoom = MenuItemBuilder::new("Reset Zoom")
        .id("reset_zoom")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;

    let toggle_git = MenuItemBuilder::new("Toggle Git Panel")
        .id("toggle_git")
        .accelerator("CmdOrCtrl+G")
        .build(app)?;

    let toggle_sftp = MenuItemBuilder::new("Toggle SFTP Panel")
        .id("toggle_sftp")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;

    let toggle_ports = MenuItemBuilder::new("Toggle Ports Panel")
        .id("toggle_ports")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;

    #[cfg(debug_assertions)]
    let toggle_devtools = MenuItemBuilder::new("Toggle Developer Tools")
        .id("toggle_devtools")
        .accelerator("F12")
        .build(app)?;

    // Window menu items
    let split_horizontal = MenuItemBuilder::new("Split Horizontally")
        .id("split_horizontal")
        .accelerator("CmdOrCtrl+Shift+H")
        .build(app)?;

    let split_vertical = MenuItemBuilder::new("Split Vertically")
        .id("split_vertical")
        .accelerator("CmdOrCtrl+Shift+V")
        .build(app)?;

    let next_tab = MenuItemBuilder::new("Next Tab")
        .id("next_tab")
        .accelerator("Ctrl+Tab")
        .build(app)?;

    let prev_tab = MenuItemBuilder::new("Previous Tab")
        .id("prev_tab")
        .accelerator("Ctrl+Shift+Tab")
        .build(app)?;

    let next_pane = MenuItemBuilder::new("Next Pane")
        .id("next_pane")
        .accelerator("CmdOrCtrl+Alt+Right")
        .build(app)?;

    let prev_pane = MenuItemBuilder::new("Previous Pane")
        .id("prev_pane")
        .accelerator("CmdOrCtrl+Alt+Left")
        .build(app)?;

    // Help menu items
    let documentation = MenuItemBuilder::new("Documentation")
        .id("documentation")
        .build(app)?;

    let report_issue = MenuItemBuilder::new("Report Issue")
        .id("report_issue")
        .build(app)?;

    let check_updates = MenuItemBuilder::new("Check for Updates...")
        .id("check_updates")
        .build(app)?;

    let release_notes = MenuItemBuilder::new("View Release Notes")
        .id("release_notes")
        .build(app)?;

    // About will be handled differently on macOS (in app menu) vs other platforms

    // Build submenus
    #[cfg(target_os = "macos")]
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_tab)
        .item(&new_window)
        .separator()
        .item(&close_tab)
        .item(&close_window)
        .separator()
        .item(&open_ssh)
        .build()?;

    #[cfg(not(target_os = "macos"))]
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_tab)
        .item(&new_window)
        .separator()
        .item(&close_tab)
        .item(&close_window)
        .separator()
        .item(&open_ssh)
        .separator()
        .item(&settings)
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .item(&clear_terminal)
        .build()?;

    let mut view_menu_builder = SubmenuBuilder::new(app, "View")
        .item(&toggle_fullscreen)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&reset_zoom)
        .separator()
        .item(&toggle_git)
        .item(&toggle_sftp)
        .item(&toggle_ports);

    #[cfg(debug_assertions)]
    {
        view_menu_builder = view_menu_builder.separator().item(&toggle_devtools);
    }

    let view_menu = view_menu_builder.build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&split_horizontal)
        .item(&split_vertical)
        .separator()
        .item(&next_tab)
        .item(&prev_tab)
        .separator()
        .item(&next_pane)
        .item(&prev_pane)
        .separator()
        .minimize()
        .maximize()
        .build()?;

    #[cfg(target_os = "macos")]
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&documentation)
        .item(&report_issue)
        .separator()
        .item(&check_updates)
        .item(&release_notes)
        .build()?;

    #[cfg(not(target_os = "macos"))]
    let help_menu = {
        let about_item = MenuItemBuilder::new("About JaTerm")
            .id("about")
            .build(app)?;

        SubmenuBuilder::new(app, "Help")
            .item(&documentation)
            .item(&report_issue)
            .separator()
            .item(&check_updates)
            .item(&release_notes)
            .separator()
            .item(&about_item)
            .build()?
    };

    // Build the complete menu
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::AboutMetadata;

        // On macOS, create app menu with native about dialog
        let app_menu = SubmenuBuilder::new(app, "JaTerm")
            .about(Some(AboutMetadata {
                name: Some("JaTerm".to_string()),
                version: Some("1.4.0".to_string()),
                copyright: Some("© 2025 Kobozo. All rights reserved.".to_string()),
                ..Default::default()
            }))
            .separator()
            .item(&settings)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;

        MenuBuilder::new(app)
            .item(&app_menu)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&view_menu)
            .item(&window_menu)
            .item(&help_menu)
            .build()
            .map_err(|e| e.into())
    }

    #[cfg(not(target_os = "macos"))]
    {
        MenuBuilder::new(app)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&view_menu)
            .item(&window_menu)
            .item(&help_menu)
            .build()
            .map_err(|e| e.into())
    }
}

pub fn handle_menu_event(app: &AppHandle<Wry>, event_id: &str) {
    match event_id {
        "new_tab" => {
            let _ = app.emit("menu:new_tab", ());
        }
        "new_window" => {
            // Create a new window
            if let Ok(window) = tauri::WebviewWindowBuilder::new(
                app,
                format!("main-{}", nanoid::nanoid!()),
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("JaTerm")
            .inner_size(1024.0, 768.0)
            .build()
            {
                let _ = window.show();
            }
        }
        "close_tab" => {
            let _ = app.emit("menu:close_tab", ());
        }
        "close_window" => {
            // Close the first window (usually the main window)
            if let Some((_, window)) = app.webview_windows().iter().next() {
                let _ = window.close();
            }
        }
        "open_ssh" => {
            let _ = app.emit("menu:open_ssh", ());
        }
        "settings" => {
            let _ = app.emit("menu:settings", ());
        }
        "clear_terminal" => {
            let _ = app.emit("menu:clear_terminal", ());
        }
        "find" => {
            let _ = app.emit("menu:find", ());
        }
        "toggle_fullscreen" => {
            if let Some((_, window)) = app.webview_windows().iter().next() {
                let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
            }
        }
        "zoom_in" => {
            let _ = app.emit("menu:zoom_in", ());
        }
        "zoom_out" => {
            let _ = app.emit("menu:zoom_out", ());
        }
        "reset_zoom" => {
            let _ = app.emit("menu:reset_zoom", ());
        }
        "toggle_git" => {
            let _ = app.emit("menu:toggle_git", ());
        }
        "toggle_sftp" => {
            let _ = app.emit("menu:toggle_sftp", ());
        }
        "toggle_ports" => {
            let _ = app.emit("menu:toggle_ports", ());
        }
        #[cfg(debug_assertions)]
        "toggle_devtools" => {
            if let Some((_, window)) = app.webview_windows().iter().next() {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        "split_horizontal" => {
            let _ = app.emit("menu:split_horizontal", ());
        }
        "split_vertical" => {
            let _ = app.emit("menu:split_vertical", ());
        }
        "next_tab" => {
            let _ = app.emit("menu:next_tab", ());
        }
        "prev_tab" => {
            let _ = app.emit("menu:prev_tab", ());
        }
        "next_pane" => {
            let _ = app.emit("menu:next_pane", ());
        }
        "prev_pane" => {
            let _ = app.emit("menu:prev_pane", ());
        }
        "documentation" => {
            // Emit event to frontend to open URL
            let _ = app.emit("menu:open_url", "https://github.com/Kobozo/JaTerm/wiki");
        }
        "report_issue" => {
            // Emit event to frontend to open URL
            let _ = app.emit(
                "menu:open_url",
                "https://github.com/Kobozo/JaTerm/issues/new",
            );
        }
        "check_updates" => {
            // Emit event to frontend to check for updates
            let _ = app.emit("menu:check_updates", ());
        }
        "release_notes" => {
            // Emit event to frontend to open release notes
            let _ = app.emit("menu:open_url", "https://github.com/Kobozo/JaTerm/releases");
        }
        #[cfg(not(target_os = "macos"))]
        "about" => {
            // Only emit about event on non-macOS platforms
            // macOS uses native AboutMetadata in the app menu
            let _ = app.emit("menu:about", ());
        }
        #[cfg(target_os = "macos")]
        "about" => {
            // On macOS, the about dialog is handled natively via AboutMetadata
            // Do nothing here as it's already configured in the app menu
        }
        _ => {}
    }
}
