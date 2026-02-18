use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{
    webview::WebviewBuilder, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};

/// Chrome height in logical pixels (tab bar 38 + nav bar 42).
const CHROME_HEIGHT: f64 = 80.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabInfo {
    pub id: String,
    pub url: String,
    pub title: String,
}

pub struct TabState {
    pub tabs: HashMap<String, TabInfo>,
    pub active_tab: Option<String>,
}

impl TabState {
    pub fn new() -> Self {
        Self {
            tabs: HashMap::new(),
            active_tab: None,
        }
    }
}

/// Create a new content webview tab positioned below the chrome.
pub fn create_tab(
    app: &tauri::AppHandle,
    state: &mut TabState,
    url: &str,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let label = format!("tab-{}", id);

    let window = app
        .get_window("main")
        .ok_or("Main window not found")?;

    let inner_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
    let logical_width = inner_size.width as f64 / scale_factor;
    let logical_height = inner_size.height as f64 / scale_factor;

    let content_height = (logical_height - CHROME_HEIGHT).max(0.0);

    let webview_url = if url == "about:blank" || url.is_empty() {
        WebviewUrl::default()
    } else {
        let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;
        WebviewUrl::External(parsed)
    };

    let app_handle = app.clone();
    let tab_id = id.clone();
    let builder = WebviewBuilder::new(&label, webview_url)
        .auto_resize()
        .on_page_load(move |_webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                let url_str = payload.url().to_string();
                let _ = app_handle.emit(
                    "tab-loaded",
                    serde_json::json!({
                        "tabId": tab_id,
                        "url": url_str,
                    }),
                );
            }
        });

    let app_handle2 = app.clone();
    let tab_id2 = id.clone();
    let builder = builder.on_navigation(move |nav_url| {
        let url_str = nav_url.to_string();
        let _ = app_handle2.emit(
            "tab-navigated",
            serde_json::json!({
                "tabId": tab_id2,
                "url": url_str,
            }),
        );
        true // allow all navigations
    });

    // Hide all existing content webviews
    for existing_id in state.tabs.keys() {
        let existing_label = format!("tab-{}", existing_id);
        if let Some(webview) = app.get_webview(&existing_label) {
            let _ = webview.hide();
        }
    }

    // Add the new webview as a child of the main window
    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(0.0, CHROME_HEIGHT),
            LogicalSize::new(logical_width, content_height),
        )
        .map_err(|e| format!("Failed to create webview: {}", e))?;

    let _ = webview.set_focus();

    state.tabs.insert(
        id.clone(),
        TabInfo {
            id: id.clone(),
            url: url.to_string(),
            title: String::from("New Tab"),
        },
    );
    state.active_tab = Some(id.clone());

    Ok(id)
}

/// Close a content webview tab.
pub fn close_tab(
    app: &tauri::AppHandle,
    state: &mut TabState,
    tab_id: &str,
) -> Result<(), String> {
    let label = format!("tab-{}", tab_id);
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.close();
    }

    state.tabs.remove(tab_id);

    if state.active_tab.as_deref() == Some(tab_id) {
        // Activate the next available tab
        state.active_tab = state.tabs.keys().next().cloned();
        if let Some(ref new_active) = state.active_tab {
            let new_label = format!("tab-{}", new_active);
            if let Some(webview) = app.get_webview(&new_label) {
                let _ = webview.show();
                let _ = webview.set_focus();
            }
        }
    }

    Ok(())
}

/// Switch to a tab -- show the target webview, hide all others.
pub fn switch_tab(
    app: &tauri::AppHandle,
    state: &mut TabState,
    tab_id: &str,
) -> Result<(), String> {
    if !state.tabs.contains_key(tab_id) {
        return Err(format!("Tab {} not found", tab_id));
    }

    // Hide all content webviews
    for existing_id in state.tabs.keys() {
        let label = format!("tab-{}", existing_id);
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.hide();
        }
    }

    // Show the target webview
    let label = format!("tab-{}", tab_id);
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.show();
        let _ = webview.set_focus();
    }

    state.active_tab = Some(tab_id.to_string());
    Ok(())
}

/// Navigate a content webview to a new URL.
pub fn navigate_tab(
    app: &tauri::AppHandle,
    state: &mut TabState,
    tab_id: &str,
    url: &str,
) -> Result<(), String> {
    if let Some(tab) = state.tabs.get_mut(tab_id) {
        tab.url = url.to_string();
    } else {
        return Err(format!("Tab {} not found", tab_id));
    }

    let label = format!("tab-{}", tab_id);
    if let Some(webview) = app.get_webview(&label) {
        let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;
        webview
            .navigate(parsed)
            .map_err(|e| format!("Navigation failed: {}", e))?;
    }

    Ok(())
}

/// Execute JavaScript in a content webview (agent DOM access).
/// Uses the standard Tauri webview JS execution API -- the intended mechanism
/// for trusted agent code to interact with page content (form filling, extraction, etc.).
/// Only callable from the trusted sidecar process, never from untrusted user input.
pub fn run_js_in_tab(
    app: &tauri::AppHandle,
    tab_id: &str,
    code: &str,
) -> Result<(), String> {
    let label = format!("tab-{}", tab_id);
    if let Some(webview) = app.get_webview(&label) {
        webview
            .eval(code)
            .map_err(|e| format!("JS execution failed: {}", e))?;
        Ok(())
    } else {
        Err(format!("Tab {} not found", tab_id))
    }
}

/// Reposition all content webviews after a window resize.
pub fn reposition_webviews(
    app: &tauri::AppHandle,
    state: &TabState,
) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or("Main window not found")?;

    let inner_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
    let logical_width = inner_size.width as f64 / scale_factor;
    let logical_height = inner_size.height as f64 / scale_factor;
    let content_height = (logical_height - CHROME_HEIGHT).max(0.0);

    for tab_id in state.tabs.keys() {
        let label = format!("tab-{}", tab_id);
        if let Some(webview) = app.get_webview(&label) {
            let is_active = state.active_tab.as_deref() == Some(tab_id.as_str());
            if is_active {
                let _ = webview.set_position(LogicalPosition::new(0.0, CHROME_HEIGHT));
                let _ = webview.set_size(LogicalSize::new(logical_width, content_height));
            }
        }
    }

    Ok(())
}
