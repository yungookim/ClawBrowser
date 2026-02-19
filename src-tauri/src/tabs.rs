use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    Emitter, Manager, PhysicalPosition, PhysicalSize, Webview, WebviewUrl, Window,
};
use crate::devtools;

/// Layout constants in logical pixels. Used as a fallback before UI reports its true bounds.
const AGENT_PANEL_WIDTH: f64 = 320.0;
const TAB_LIST_WIDTH: f64 = 200.0;
const NAV_BAR_HEIGHT: f64 = 56.0;
const BLANK_PAGE_PATH: &str = "blank.html";

#[cfg(target_os = "macos")]
fn user_agent_override() -> Option<&'static str> {
    Some("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15")
}

#[cfg(target_os = "windows")]
fn user_agent_override() -> Option<&'static str> {
    Some("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0")
}

#[cfg(target_os = "linux")]
fn user_agent_override() -> Option<&'static str> {
    Some("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn user_agent_override() -> Option<&'static str> {
    None
}

const DEBUG_INIT_SCRIPT: &str = r#"
(() => {
  if (window.__CLAW_DEBUG_CAPTURE__) return;
  window.__CLAW_DEBUG_CAPTURE__ = true;

  const TAB_ID = __TAB_ID__;
  const MAX_MESSAGE = 1200;
  const MAX_TEXT = 1600;

  const emit = (type, payload) => {
    try {
      const api = window.__TAURI__ && window.__TAURI__.event;
      if (!api || typeof api.emit !== 'function') return;
      api.emit('claw-debug', Object.assign({ type, tabId: TAB_ID }, payload));
    } catch {
      // Ignore emit failures.
    }
  };

  const normalizeWhitespace = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  const truncate = (text, max) => {
    if (!text) return '';
    return text.length > max ? text.slice(0, max) + '...' : text;
  };

  const safeStringify = (value) => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && value.name && value.message) {
      return normalizeWhitespace(`${value.name}: ${value.message} ${value.stack || ''}`);
    }
    try {
      return JSON.stringify(value);
    } catch {
      try {
        return String(value);
      } catch {
        return '[Unserializable]';
      }
    }
  };

  const wrapConsole = (level) => {
    const original = console[level];
    console[level] = (...args) => {
      try {
        const message = truncate(normalizeWhitespace(args.map(safeStringify).join(' ')), MAX_MESSAGE);
        emit('console', {
          level,
          message,
          url: location.href,
          title: document.title,
        });
      } catch {
        // Ignore console capture failures.
      }
      if (original) {
        original.apply(console, args);
      }
    };
  };

  ['log', 'info', 'warn', 'error', 'debug'].forEach(wrapConsole);

  window.addEventListener('error', (event) => {
    emit('error', {
      message: normalizeWhitespace(event.message || 'Script error'),
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error && event.error.stack ? normalizeWhitespace(event.error.stack) : undefined,
      url: location.href,
      title: document.title,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    emit('unhandledrejection', {
      reason: truncate(normalizeWhitespace(safeStringify(event.reason)), MAX_MESSAGE),
      url: location.href,
      title: document.title,
    });
  });

  const sendRender = () => {
    let textSample = '';
    try {
      if (document.body) {
        textSample = truncate(normalizeWhitespace(document.body.innerText || ''), MAX_TEXT);
      }
    } catch {
      // Ignore render capture failures.
    }
    emit('render', {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      scroll: { x: window.scrollX || 0, y: window.scrollY || 0 },
      textSample,
    });
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(sendRender, 0);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(sendRender, 0), { once: true });
  }
})();
"#;

const LINK_INTERCEPT_SCRIPT: &str = r#"
(() => {
  if (window.__CLAW_LINK_INTERCEPT__) return;
  window.__CLAW_LINK_INTERCEPT__ = true;

  const TAB_ID = __TAB_ID__;

  const emit = (url, reason) => {
    try {
      const api = window.__TAURI__ && window.__TAURI__.event;
      if (!api || typeof api.emit !== 'function') return false;
      api.emit('tab-open-request', { tabId: TAB_ID, url, reason });
      return true;
    } catch {
      return false;
    }
  };

  const resolveUrl = (href) => {
    try {
      return new URL(href, document.baseURI).toString();
    } catch {
      return null;
    }
  };

  const isMac = (() => {
    const platform = navigator.platform || '';
    const userAgent = navigator.userAgent || '';
    return /Mac|iPhone|iPad|iPod/.test(platform) || /Macintosh|Mac OS X/.test(userAgent);
  })();

  const handler = (event) => {
    if (!event) return;
    const wantsNewTab = event.shiftKey || (isMac && event.metaKey);
    if (!wantsNewTab) return;
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;

    const url = resolveUrl(href);
    if (!url) return;

    if (!emit(url, 'shift-click')) return;

    event.preventDefault();
    event.stopPropagation();
  };

  document.addEventListener('click', handler, true);
})();
"#;

fn debug_capture_enabled() -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    match std::env::var("CLAW_DEBUG_CAPTURE") {
        Ok(value) => {
            let normalized = value.trim().to_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes"
        }
        Err(_) => false,
    }
}

fn debug_init_script(tab_id: &str) -> Option<String> {
    if !debug_capture_enabled() {
        return None;
    }
    let tab_id_literal = serde_json::to_string(tab_id).unwrap_or_else(|_| "\"unknown\"".to_string());
    Some(DEBUG_INIT_SCRIPT.replace("__TAB_ID__", &tab_id_literal))
}

fn link_intercept_script(tab_id: &str) -> String {
    let tab_id_literal = serde_json::to_string(tab_id).unwrap_or_else(|_| "\"unknown\"".to_string());
    LINK_INTERCEPT_SCRIPT.replace("__TAB_ID__", &tab_id_literal)
}

fn normalize_tab_url(url: &url::Url) -> String {
    if url.path().ends_with(BLANK_PAGE_PATH) {
        "about:blank".to_string()
    } else {
        url.to_string()
    }
}

/// JS reports bounds relative to the webview viewport. On macOS the
/// window `inner_size()` includes the title bar region but the viewport
/// only covers below the title bar. `chrome_y_offset` is the physical-pixel
/// gap between the two coordinate systems, stored once the JS first reports.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ContentBounds {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

/// Compute physical bounds for child webviews.
///
/// Uses the stored JS layout (`left`, `top` from viewport) combined with the
/// current `inner_size` so that width/height stay correct even when the Rust
/// resize handler fires before the JS handler updates the stored bounds.
fn content_bounds(window: &Window, state: &TabState) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>), String> {
    let inner_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let y_off = state.chrome_y_offset;

    // Logical-pixel offsets for left edge and top edge (from viewport origin).
    let (left_logical, top_viewport) = if let Some(b) = &state.content_bounds {
        (b.left, b.top)
    } else {
        (AGENT_PANEL_WIDTH + TAB_LIST_WIDTH, NAV_BAR_HEIGHT)
    };

    // Convert to physical pixels, adding the title-bar offset to y.
    let left_px  = (left_logical * scale).round().max(0.0) as i32;
    let top_px   = ((top_viewport + y_off) * scale).round().max(0.0) as i32;

    // Width and height are derived from the *current* inner_size so they stay
    // correct even when stored JS bounds are stale during a resize.
    let width_px  = inner_size.width.saturating_sub(left_px.max(0) as u32);
    let height_px = inner_size.height.saturating_sub(top_px.max(0) as u32);

    Ok((
        PhysicalPosition::new(left_px, top_px),
        PhysicalSize::new(width_px, height_px),
    ))
}

fn apply_bounds(window: &Window, webview: &Webview, state: &TabState) -> Result<(), String> {
    let _ = webview.set_auto_resize(false);
    let (position, size) = content_bounds(window, state)?;
    let bounds = tauri::Rect {
        position: position.into(),
        size: size.into(),
    };
    webview
        .set_bounds(bounds)
        .map_err(|e| format!("Failed to set webview bounds: {}", e))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabInfo {
    pub id: String,
    pub url: String,
    pub title: String,
}

pub struct TabState {
    pub tabs: HashMap<String, TabInfo>,
    pub active_tab: Option<String>,
    pub content_bounds: Option<ContentBounds>,
    /// Title-bar height in logical pixels. On macOS, `inner_size()` includes
    /// the title bar but the JS viewport does not. Computed on first
    /// `set_content_bounds` call and reused for all subsequent positioning.
    pub chrome_y_offset: f64,
}

impl TabState {
    pub fn new() -> Self {
        Self {
            tabs: HashMap::new(),
            active_tab: None,
            content_bounds: None,
            chrome_y_offset: 0.0,
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

    let (position, size) = content_bounds(&window, state)?;

    let webview_url = if url == "about:blank" || url.is_empty() {
        WebviewUrl::App(BLANK_PAGE_PATH.into())
    } else {
        let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;
        WebviewUrl::External(parsed)
    };

    let mut builder = WebviewBuilder::new(&label, webview_url);
    if let Some(user_agent) = user_agent_override() {
        builder = builder.user_agent(user_agent);
    }
    if let Some(script) = debug_init_script(&id) {
        builder = builder.initialization_script(script);
    }
    builder = builder.initialization_script(link_intercept_script(&id));

    let app_handle = app.clone();
    let tab_id = id.clone();
    let builder = builder.on_page_load(move |_webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                let url_str = normalize_tab_url(payload.url());
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
        let url_str = normalize_tab_url(&nav_url);
        let _ = app_handle2.emit(
            "tab-navigated",
            serde_json::json!({
                "tabId": tab_id2,
                "url": url_str,
            }),
        );
        true // allow all navigations
    });

    let app_handle3 = app.clone();
    let tab_id3 = id.clone();
    let builder = builder.on_new_window(move |url, _features| {
        let url_str = normalize_tab_url(&url);
        let _ = app_handle3.emit(
            "tab-open-request",
            serde_json::json!({
                "tabId": tab_id3,
                "url": url_str,
                "reason": "new-window",
            }),
        );
        NewWindowResponse::Deny
    });

    // Hide all existing content webviews and move off-screen
    let offscreen = tauri::Rect {
        position: PhysicalPosition::new(-10000_i32, -10000_i32).into(),
        size: PhysicalSize::new(0_u32, 0_u32).into(),
    };
    for existing_id in state.tabs.keys() {
        let existing_label = format!("tab-{}", existing_id);
        if let Some(webview) = app.get_webview(&existing_label) {
            let _ = webview.set_bounds(offscreen);
            let _ = webview.hide();
        }
    }

    // Add the new webview as a child of the main window
    let webview = window
        .add_child(builder, position, size)
        .map_err(|e| format!("Failed to create webview: {}", e))?;

    // Immediately disable auto-resize before anything else can override our position
    let _ = webview.set_auto_resize(false);

    // Check bounds right after add_child
    apply_bounds(&window, &webview, state)?;
    devtools::watch_webview_devtools(app.clone(), label.clone());

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

    let offscreen = tauri::Rect {
        position: PhysicalPosition::new(-10000_i32, -10000_i32).into(),
        size: PhysicalSize::new(0_u32, 0_u32).into(),
    };

    // Hide all content webviews and move off-screen
    for existing_id in state.tabs.keys() {
        if existing_id == tab_id {
            continue;
        }
        let label = format!("tab-{}", existing_id);
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.set_bounds(offscreen);
            let _ = webview.hide();
        }
    }

    // Show the target webview
    let label = format!("tab-{}", tab_id);
    if let Some(webview) = app.get_webview(&label) {
        if let Some(window) = app.get_window("main") {
            let _ = apply_bounds(&window, &webview, state);
        }
        let _ = webview.show();
        let _ = webview.set_focus();
    }

    state.active_tab = Some(tab_id.to_string());
    Ok(())
}

/// Hide all content webviews without changing the active tab state.
/// Moves each webview far off-screen so it cannot intercept pointer events
/// even if the native layer remains in the window hierarchy.
pub fn hide_all_tabs(
    app: &tauri::AppHandle,
    state: &TabState,
) -> Result<(), String> {
    let offscreen = tauri::Rect {
        position: PhysicalPosition::new(-10000_i32, -10000_i32).into(),
        size: PhysicalSize::new(0_u32, 0_u32).into(),
    };
    for existing_id in state.tabs.keys() {
        let label = format!("tab-{}", existing_id);
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.set_bounds(offscreen);
            let _ = webview.hide();
        }
    }
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

/// Reposition only the active content webview after a window resize.
/// Non-active webviews are left off-screen to avoid intercepting pointer events.
pub fn reposition_webviews(
    app: &tauri::AppHandle,
    state: &TabState,
) -> Result<(), String> {
    let active_id = match &state.active_tab {
        Some(id) => id.clone(),
        None => return Ok(()),
    };

    let window = app
        .get_window("main")
        .ok_or("Main window not found")?;

    let (position, size) = content_bounds(&window, state)?;
    let bounds = tauri::Rect {
        position: position.into(),
        size: size.into(),
    };

    let label = format!("tab-{}", active_id);
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.set_auto_resize(false);
        let _ = webview.set_bounds(bounds);
    }

    Ok(())
}

pub fn set_content_bounds(
    app: &tauri::AppHandle,
    state: &mut TabState,
    bounds: ContentBounds,
) -> Result<(), String> {
    // Compute the title-bar y-offset from the JS data.
    // JS viewport_height = bounds.top + bounds.height (the visible area).
    // inner_size.height includes the title bar. The difference is the offset.
    let window = app.get_window("main").ok_or("Main window not found")?;
    let inner_size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let inner_h_logical = inner_size.height as f64 / scale;
    let viewport_h = bounds.top + bounds.height;
    let y_off = (inner_h_logical - viewport_h).max(0.0);

    state.chrome_y_offset = y_off;
    state.content_bounds = Some(bounds);
    reposition_webviews(app, state)
}
