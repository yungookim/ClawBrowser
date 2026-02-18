# Design: Shift+Click Opens New Tab [COMPLETED]

Date: 2026-02-18
Status: COMPLETED

## Context
Users want Shift+Click on any link to open in a new tab and switch immediately. Links that request a new window (e.g., target="_blank" or window.open()) should also open a new tab and switch immediately.

## Goals
- Shift+Click on any link opens a new tab and switches to it.
- target="_blank" and window.open() open a new tab and switch to it.
- Behavior is consistent across content webviews.

## Non-Goals
- Background tab opening.
- New tab UI changes beyond existing tab handling.

## Requirements
- Works for any link, regardless of its default target behavior.
- Handles new-window requests from the page without Shift.
- Ignores invalid or missing URLs safely.

## Proposed Solution
### Architecture
- Inject a small JS interceptor into each content webview to detect Shift+Click on links and emit a `tab-open-request` event with `{ tabId, url, reason: "shift-click" }`.
- Add a Tauri webview new-window handler to intercept target="_blank" / window.open() and emit the same `tab-open-request` event with `{ tabId, url, reason: "new-window" }`.
- In the frontend, listen for `tab-open-request`, call `tabManager.createTab(url)`, and switch immediately (existing createTab behavior already activates the new tab).

### Components
- Rust: webview new-window hook in `src-tauri/src/tabs.rs`.
- JS: initialization script injected for each webview (same file as other initialization scripts).
- Frontend: `src/main.ts` listener for `tab-open-request` -> `tabManager.createTab(url)`.

### Data Flow
1. Shift+Click in a webview.
2. JS interceptor emits `tab-open-request` with URL.
3. Frontend creates a new tab with that URL and switches immediately.

For target="_blank" / window.open():
1. Webview new-window handler fires in Rust.
2. Rust emits `tab-open-request` with URL.
3. Frontend creates a new tab with that URL and switches immediately.

### Error Handling
- If URL is missing/invalid: ignore and log.
- If tab creation fails: log and keep current tab active.
- JS interceptor respects `event.defaultPrevented` and skips links without href.

### Testing
Manual smoke tests:
- Shift+Click a normal link -> new tab, switch immediately.
- Shift+Click a target="_blank" link -> one new tab, switch immediately.
- Click target="_blank" without Shift -> new tab, switch immediately.
- window.open() from page JS -> new tab, switch immediately.
- Shift+Click on link without href -> no action.

## Risks
- Some sites may stop propagation on click events. Using a capturing listener mitigates this.
- window.open handling depends on webview API support; if not available, only Shift+Click is guaranteed.
