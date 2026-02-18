use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
mod tabs;
mod ipc;
mod sidecar;
mod devtools;
mod logger;

pub fn run() {
    logger::init_system_logger();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(tabs::TabState::new()))
        .manage(Mutex::new(sidecar::SidecarState::new()))
        .menu(|app| {
            let handle = app.app_handle();
            let pkg_info = app.package_info();
            let config = app.config();
            let about_metadata = AboutMetadata {
                name: Some(pkg_info.name.clone()),
                version: Some(pkg_info.version.to_string()),
                copyright: config.bundle.copyright.clone(),
                authors: config.bundle.publisher.clone().map(|p| vec![p]),
                ..Default::default()
            };

            let close_tab = MenuItem::with_id(handle, "close_tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;

            let file_menu = Submenu::with_items(
                handle,
                "File",
                true,
                &[
                    &close_tab,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::close_window(handle, None)?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::quit(handle, None)?,
                ],
            )?;

            let edit_menu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, None)?,
                    &PredefinedMenuItem::redo(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?;

            #[cfg(target_os = "macos")]
            let view_menu = Submenu::with_items(
                handle,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(handle, None)?],
            )?;

            let window_menu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, None)?,
                    &PredefinedMenuItem::maximize(handle, None)?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::close_window(handle, None)?,
                ],
            )?;

            let help_menu = Submenu::with_items(
                handle,
                "Help",
                true,
                &[
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::about(handle, None, Some(about_metadata.clone()))?,
                ],
            )?;

            let menu = Menu::with_items(
                handle,
                &[
                    #[cfg(target_os = "macos")]
                    &Submenu::with_items(
                        handle,
                        pkg_info.name.clone(),
                        true,
                        &[
                            &PredefinedMenuItem::about(handle, None, Some(about_metadata))?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::services(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::hide(handle, None)?,
                            &PredefinedMenuItem::hide_others(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::quit(handle, None)?,
                        ],
                    )?,
                    &file_menu,
                    &edit_menu,
                    #[cfg(target_os = "macos")]
                    &view_menu,
                    &window_menu,
                    &help_menu,
                ],
            )?;

            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id() == "close_tab" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("close-active-tab", ());
                }
            }
        })
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            println!("ClawBrowser started: {:?}", window.title());
            devtools::watch_webview_devtools(app.handle().clone(), "main".to_string());

            // Listen for window resize to reposition content webviews
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Resized(_) = event {
                    let state_mutex = app_handle.state::<Mutex<tabs::TabState>>();
                    let guard = state_mutex.lock();
                    if let Ok(state) = guard {
                        let _ = tabs::reposition_webviews(&app_handle, &state);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::create_tab,
            ipc::close_tab,
            ipc::switch_tab,
            ipc::hide_all_tabs,
            ipc::navigate_tab,
            ipc::run_js_in_tab,
            ipc::list_tabs,
            ipc::get_active_tab,
            ipc::reposition_tabs,
            ipc::set_content_bounds,
            sidecar::start_sidecar,
            sidecar::sidecar_send,
            sidecar::sidecar_receive,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClawBrowser");
}
