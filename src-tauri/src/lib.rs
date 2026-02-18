use std::sync::Mutex;
use tauri::Manager;
mod tabs;
mod ipc;
mod sidecar;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(tabs::TabState::new()))
        .manage(Mutex::new(sidecar::SidecarState::new()))
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            println!("ClawBrowser started: {:?}", window.title());

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
            ipc::navigate_tab,
            ipc::run_js_in_tab,
            ipc::list_tabs,
            ipc::get_active_tab,
            ipc::reposition_tabs,
            sidecar::start_sidecar,
            sidecar::sidecar_send,
            sidecar::sidecar_receive,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClawBrowser");
}
