# Matrix Empty State (Design)

Date: 2026-02-18

## Summary
Show an animated Matrix background with the ClawBrowser wordmark and slogan inside the webview area whenever there are no tabs or the active tab is `about:blank`. This replaces the current whitespace with a branded empty state while keeping settings/onboarding/vault overlays unaffected.

## Goals
- Provide a branded, animated empty state within the webview region.
- Display when there are zero tabs or the active tab is `about:blank`.
- Do not show while settings, onboarding, or vault lock screens are visible.

## Non-Goals
- No changes to chrome (agent panel, tab bar, nav bar).
- No redesign of existing settings/onboarding/vault UIs.
- No new tab-management UX beyond ensuring a blank tab exists.

## Approach (Chosen)
Use the existing `about:blank` webview (backed by `blank.html`) to render the matrix animation and branding. Ensure a blank tab exists whenever the tab list becomes empty. This keeps the empty state fully inside the webview surface and avoids chrome overlays.

## UI/Content
`blank.html` will render:
- Full-bleed matrix animation (canvas).
- Centered “ClawBrowser” wordmark.
- Slogan text (current copy: “The smartest child of openclaw.”).

Styling will be monochrome and square-cornered, consistent with current visual rules.

## Behavior
- On startup, if there are zero tabs, create an `about:blank` tab so the empty state appears.
- When the active tab is `about:blank`, the matrix empty state is visible.
- When a real URL is active, the empty state is hidden (normal webview content).
- When settings/onboarding/vault lock hide tabs, the empty state is not visible.

## Data Flow / State
- Tab changes are observed by the existing tab manager and chrome.
- A guard ensures at least one tab exists when the app is not in onboarding/vault-locked state.

## Error Handling / Edge Cases
- If the blank page fails to load, users see a blank page; no extra UI is required.
- Avoid creating tabs during onboarding or while vault is locked.

## Testing (Manual)
1. Launch app with no tabs persisted → matrix empty state appears in webview area.
2. Close last tab → empty state reappears.
3. Navigate to a real URL → empty state disappears.
4. Open Settings/Onboarding/Vault lock → tabs hidden, empty state not visible.
