# Vault Lock Webview Visibility Design

Date: 2026-02-18

## Summary
Keep encryption and require a password to decrypt. Remove idle auto-lock (lock only on app termination). When locked, hide all content webviews so the lock screen is never covered; on unlock, restore the last active tab (or create a fallback tab if missing).

## Goals
- Hide all content webviews whenever the vault is locked.
- Restore the last active tab after successful unlock.
- Disable idle auto-lock so the vault stays unlocked for the session.
- Keep encryption and existing unlock UX intact.

## Non-goals
- Changing the vault format or encryption algorithms.
- Persisting passphrase or auto-unlock.
- Destroying/recreating webviews on lock (only hide/show).

## Design

### Vault Behavior
- Construct the vault with `idleTimeoutMs = 0` so it never auto-locks.
- Keep the vault lock screen and password flow unchanged.

### Lock Event Handling
- Update the vault to support multiple `onLock` listeners (array).
- Register a `main.ts` listener that:
  - Stores `vaultRestoreTabId = tabManager.getActiveTabId()`.
  - Sets `vaultLocked = true`.
  - Calls `invoke('hide_all_tabs')` to hide all content webviews.

### Unlock Handling
- Extend the existing `vaultUI.setOnUnlock(...)` handler to:
  - Set `vaultLocked = false`.
  - Restore `vaultRestoreTabId` via `tabManager.switchTab(...)` if present and still valid.
  - Otherwise, fall back to the first available tab; if no tabs exist, create `about:blank`.
  - Clear `vaultRestoreTabId` after restore.

### Startup Behavior
- When existing vault data is detected, hide all tabs before showing the lock screen.
- Skip initial tab creation while `vaultLocked` is true.

### Input/Shortcut Guarding
- While locked, ignore:
  - `Ctrl/Cmd+T` tab creation
  - `tab-open-request` events

This prevents background tab creation while the lock overlay is visible.

## Error Handling
- If `hide_all_tabs` fails, log a warning and still show the lock overlay.
- If the stored restore tab no longer exists, fall back to another tab or create a blank one.
- Onboarding behavior remains unchanged; its own hide/restore logic is preserved.

## Testing Plan (Manual)
1. Launch with existing vault data: lock screen appears, no content webview visible behind it.
2. Unlock: last active tab is restored; if none, a blank tab appears.
3. Leave app idle: vault remains unlocked (no auto-lock).
4. Restart app: lock screen returns; content webviews are hidden.

## Open Questions
- None.
