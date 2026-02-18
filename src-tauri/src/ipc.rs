use std::sync::Mutex;
use tauri::State;
use crate::tabs::{TabInfo, TabState};

#[tauri::command]
pub fn create_tab(
    _app: tauri::AppHandle,
    _state: State<'_, Mutex<TabState>>,
    url: String,
) -> Result<String, String> {
    // Stub — full implementation in Task 0.2
    let id = uuid::Uuid::new_v4().to_string();
    let mut state = _state.lock().map_err(|e| e.to_string())?;
    state.tabs.insert(
        id.clone(),
        TabInfo {
            id: id.clone(),
            url,
            title: String::from("New Tab"),
        },
    );
    state.active_tab = Some(id.clone());
    Ok(id)
}

#[tauri::command]
pub fn close_tab(
    _app: tauri::AppHandle,
    state: State<'_, Mutex<TabState>>,
    tab_id: String,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.tabs.remove(&tab_id);
    if state.active_tab.as_deref() == Some(&tab_id) {
        state.active_tab = state.tabs.keys().next().cloned();
    }
    Ok(())
}

#[tauri::command]
pub fn switch_tab(
    _app: tauri::AppHandle,
    state: State<'_, Mutex<TabState>>,
    tab_id: String,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    if state.tabs.contains_key(&tab_id) {
        state.active_tab = Some(tab_id);
        Ok(())
    } else {
        Err(format!("Tab {} not found", tab_id))
    }
}

#[tauri::command]
pub fn navigate_tab(
    _app: tauri::AppHandle,
    state: State<'_, Mutex<TabState>>,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    if let Some(tab) = state.tabs.get_mut(&tab_id) {
        tab.url = url;
        Ok(())
    } else {
        Err(format!("Tab {} not found", tab_id))
    }
}

#[tauri::command]
pub fn run_js_in_tab(
    _app: tauri::AppHandle,
    _tab_id: String,
    _code: String,
) -> Result<String, String> {
    // Stub — full webview JS execution in Task 0.2
    Ok(String::new())
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
