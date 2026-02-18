use std::time::Duration;

use tauri::{AppHandle, Manager};

#[cfg(all(target_os = "macos", any(debug_assertions, feature = "devtools")))]
use objc2::rc::Retained;
#[cfg(all(target_os = "macos", any(debug_assertions, feature = "devtools")))]
use objc2::runtime::{AnyObject, Bool};
#[cfg(all(target_os = "macos", any(debug_assertions, feature = "devtools")))]
use objc2::{msg_send, sel};
#[cfg(all(target_os = "macos", any(debug_assertions, feature = "devtools")))]
use objc2_web_kit::WKWebView;
#[cfg(all(target_os = "macos", any(debug_assertions, feature = "devtools")))]
use tauri::Webview;

#[cfg(all(target_os = "macos", any(debug_assertions, feature = "devtools")))]
fn detach_inspector(webview: &Webview) {
    let _ = webview.with_webview(|platform| unsafe {
        let view: &WKWebView = &*platform.inner().cast();
        let inspector: Retained<AnyObject> = msg_send![view, _inspector];
        let responds: Bool = msg_send![&*inspector, respondsToSelector: sel!(detach)];
        if responds.as_bool() {
            let _: () = msg_send![&*inspector, detach];
        }
    });
}

#[cfg(all(target_os = "macos", any(debug_assertions, feature = "devtools")))]
pub fn watch_webview_devtools(app: AppHandle, label: String) {
    tauri::async_runtime::spawn(async move {
        let mut was_open = false;
        loop {
            let Some(webview) = app.get_webview(&label) else {
                break;
            };

            let is_open = webview.is_devtools_open();
            if is_open && !was_open {
                // Force Web Inspector into its own window whenever it opens.
                detach_inspector(&webview);
            }
            was_open = is_open;

            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    });
}

#[cfg(not(all(target_os = "macos", any(debug_assertions, feature = "devtools"))))]
pub fn watch_webview_devtools(_app: AppHandle, _label: String) {}
