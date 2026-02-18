use std::sync::Mutex;
use tauri::State;
use crate::tabs::{self, TabInfo, TabState};

#[tauri::command]
pub fn create_tab(
    app: tauri::AppHandle,
    state: State<'_, Mutex<TabState>>,
    url: String,
) -> Result<String, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    tabs::create_tab(&app, &mut state, &url)
}

#[tauri::command]
pub fn close_tab(
    app: tauri::AppHandle,
    state: State<'_, Mutex<TabState>>,
    tab_id: String,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    tabs::close_tab(&app, &mut state, &tab_id)
}

#[tauri::command]
pub fn switch_tab(
    app: tauri::AppHandle,
    state: State<'_, Mutex<TabState>>,
    tab_id: String,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    tabs::switch_tab(&app, &mut state, &tab_id)
}

#[tauri::command]
pub fn navigate_tab(
    app: tauri::AppHandle,
    state: State<'_, Mutex<TabState>>,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    tabs::navigate_tab(&app, &mut state, &tab_id, &url)
}

#[tauri::command]
pub fn run_js_in_tab(
    app: tauri::AppHandle,
    tab_id: String,
    code: String,
) -> Result<(), String> {
    tabs::run_js_in_tab(&app, &tab_id, &code)
}

#[tauri::command]
pub fn list_tabs(
    state: State<'_, Mutex<TabState>>,
) -> Result<Vec<TabInfo>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.tabs.values().cloned().collect())
}

#[tauri::command]
pub fn get_active_tab(
    state: State<'_, Mutex<TabState>>,
) -> Result<Option<String>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.active_tab.clone())
}

#[tauri::command]
pub fn reposition_tabs(
    app: tauri::AppHandle,
    state: State<'_, Mutex<TabState>>,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    tabs::reposition_webviews(&app, &state)
}
