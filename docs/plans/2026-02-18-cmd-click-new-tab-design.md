# Design: Cmd+Click Opens New Tab (macOS)

Date: 2026-02-18

## Context
We already intercept Shift+Click on links to open a new tab. On macOS, the system convention is Cmd+Click for opening links in a new tab. We want both Shift+Click and Cmd+Click to open a new tab immediately, but only treat Cmd as a modifier on macOS.

## Goals
- On macOS, Cmd+Click opens a new tab and switches immediately.
- On all platforms, Shift+Click continues to open a new tab and switches immediately.
- Do not change target="_blank" / window.open() handling.

## Non-Goals
- Changing behavior for the Windows key on Windows or Super key on Linux.
- Background tab opening.

## Requirements
- Detect macOS in the injected link interceptor script.
- Keep the existing event emission `tab-open-request` and navigation prevention.

## Proposed Solution
### Architecture
Update the injected link interceptor script to treat `event.metaKey` as a new-tab modifier only when the platform is macOS, while continuing to accept `event.shiftKey` on all platforms.

### Components
- `src-tauri/src/tabs.rs`: update `LINK_INTERCEPT_SCRIPT` to detect macOS and allow `metaKey` when `isMac` is true.

### Data Flow
1. User Shift+Clicks (any OS) or Cmd+Clicks (macOS) a link.
2. JS interceptor emits `tab-open-request` with URL.
3. Frontend creates a new tab and switches immediately.

### Error Handling
No changes; existing URL validation and emit error handling remain.

### Testing
- macOS: Cmd+Click any link -> new tab, switch immediately.
- macOS: Shift+Click any link -> new tab, switch immediately.
- Windows/Linux: Shift+Click any link -> new tab, switch immediately.
- Windows/Linux: Meta/Windows key does nothing special.

## Risks
- Incorrect platform detection in the webview; we mitigate by checking both `navigator.platform` and `navigator.userAgent`.
