# Persistent Browser Session Button Design

Date: 2026-02-24

## Goal
Add a UI button that opens the Stagehand-controlled browser so the user can log in to web services, with a single shared persistent session that survives restarts.

## Scope
- Add an `Open Session` button in the nav bar next to `Settings`.
- Launch Stagehand with a persistent user data directory so cookies and localStorage persist.
- Expose a sidecar method to open the session on demand.

## Non-Goals
- Multiple named sessions or profile switching.
- Webview-based auth tabs.
- Remote debugging or external browser attachment.

## Approach Options
1. Persistent Stagehand profile + nav bar button.
- Lowest surface area, matches single shared session requirement.

2. Webview auth tab.
- Requires enabling webview automation and more UI/plumbing.

3. External Chrome profile via remote debugging.
- More brittle and higher security risk.

Selected: Option 1.

## Architecture
- Frontend nav bar adds `Open Session` button.
- `main.ts` wires button to `SidecarBridge.browserOpen()`.
- `SidecarBridge` sends JSON-RPC `browserOpen`.
- Sidecar handler calls `StagehandBridge.openSession()`.
- `StagehandBridge` ensures Stagehand initialized with:
  - `localBrowserLaunchOptions.userDataDir = <workspace>/browser-profile/default`
  - `preserveUserDataDir = true`
  - `headless = false`
- `openSession()` opens a blank page to allow login.

## Data Flow
1. User clicks `Open Session`.
2. Frontend calls sidecar `browserOpen`.
3. Sidecar ensures Stagehand is running with persistent profile.
4. Stagehand opens a new page for the user to log in.
5. Agent automation reuses the same profile for subsequent runs.

## Error Handling
- If sidecar is unavailable, surface a short error and keep UI responsive.
- If profile path cannot be created, fall back to `~/.clawbrowser/workspace/browser-profile/default` and log a warning.
- If Stagehand is already active, just open a new page.
- If Stagehand crashes, reinitialize once and retry.

## Testing
- Manual: open session, log in, restart app, verify login persists.
- Optional unit test: assert `userDataDir` passed into Stagehand init and `openSession()` opens a page.
