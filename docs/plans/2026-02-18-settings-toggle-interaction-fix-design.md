# Settings Toggle Interaction Fix Design (2026-02-18)

## Summary
Some Settings controls (notably the Vault Security toggle and Open Logs Folder) do not consistently respond to clicks. The fix makes the vault toggle a standard input-driven control (listening on `change`) and adds delegated click handling for Settings action buttons to ensure event wiring survives DOM changes.

## Goals
- Make the Vault Security toggle reliably interactive.
- Ensure Settings action buttons (e.g., Open Logs Folder) always fire.
- Keep UI/UX and visual styling unchanged.

## Non-Goals
- Redesigning the Settings UI.
- Replacing confirm/prompt dialogs with custom modals.
- Refactoring other Settings logic beyond event wiring.

## Architecture
- Use the native `<input type="checkbox">` change event for the vault toggle.
- Make the input cover the switch area so clicks land on the input reliably.
- Add a single delegated click handler on the Settings root for `[data-action]` elements.
- Remove redundant per-element click handlers for the vault toggle row/label to avoid conflicts.

## UI/UX
- No visual changes to the toggle or cards.
- Toggle semantics remain the same:
  - Off prompts for confirmation and migrates to plaintext.
  - On prompts for passphrase and re-encrypts.

## Data Flow
- Vault toggle:
  - User toggles input -> `change` event -> `handleVaultEncryptionToggle(next)` -> update vault + config + UI.
- Action buttons:
  - User clicks any `[data-action]` element -> delegated handler -> run action (`openLogsFolder`, `refreshAll`, etc.).

## Error Handling
- Toggle failure reverts UI state and posts a banner warning.
- Action failures continue to use existing banner messaging.

## Testing
- Update `tests/frontend/settings-panel.test.ts`:
  - Toggle the vault checkbox via `change` and verify migration calls.
  - Trigger Open Logs via delegated click and verify `getLogsDir` + `open` calls.

## Rollout
- Ship as an internal wiring change with no user-visible behavior change beyond reliability.
