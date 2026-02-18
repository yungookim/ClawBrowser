use std::sync::Mutex;
use tauri::Manager;
mod tabs;
mod ipc;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(tabs::TabState::new()))
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            println!("ClawBrowser started: {:?}", window.title());
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClawBrowser");
}
