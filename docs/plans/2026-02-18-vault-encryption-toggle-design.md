# Vault Encryption Toggle Design (2026-02-18)

## Summary
Add a Settings toggle that turns vault encryption on/off. When turned OFF, the app migrates all vault entries to plaintext and bypasses the lockscreen. When turned ON, the app prompts for a new passphrase, encrypts all entries, and restores lockscreen behavior.

## Goals
- Allow users to disable vault encryption from Settings.
- When disabling encryption, migrate all vault entries to plaintext and overwrite `~/.clawbrowser/vault.json`.
- When encryption is disabled, bypass the lockscreen and treat the vault as unlocked.
- Preserve existing encrypted vault format when encryption is enabled.

## Non-Goals
- Changing cryptography algorithms or key derivation parameters.
- Maintaining a backup of the encrypted vault after disabling encryption.
- Sharing plaintext vault files across devices or syncing.

## Architecture
- Add `vaultEncryptionEnabled: boolean` to sidecar `AppConfig` (default `true`).
- Introduce `VaultStore` in `src/vault/VaultStore.ts` to abstract encrypted vs plaintext storage:
  - Encrypted mode wraps the existing `Vault`.
  - Plaintext mode stores entries in-memory and reads/writes plaintext JSON.
- Add `Vault.exportPlaintext()` to return JSON `{ entries: { key: value } }` from decrypted entries.
- Settings panel drives the toggle and orchestrates migration steps.
- `src/main.ts` selects mode at startup based on config:
  - Encryption ON -> show lockscreen (`VaultUI`) and require unlock.
  - Encryption OFF -> skip lockscreen, load plaintext, configure models immediately.

## Data Format
- Encrypted (unchanged):
  - `{ "salt": "...", "entries": { "apikey:primary": "<encrypted>" } }`
- Plaintext (new):
  - `{ "entries": { "apikey:primary": "sk-...", "apikey:secondary": "..." } }`

## UI/UX
- Add a "Vault Security" card to Settings with a toggle:
  - ON: "Encryption enabled" (default)
  - OFF: "Encryption disabled (plaintext)"
- Toggle OFF:
  - Confirm modal warning about plaintext storage.
  - If vault is locked, prompt user to unlock first.
  - Migrate entries to plaintext and update config.
- Toggle ON:
  - Prompt for new passphrase (confirm match).
  - Encrypt plaintext entries and update config.

## Onboarding & Setup Wizard
- If `vaultEncryptionEnabled` is `false`, skip the passphrase step and create a plaintext vault.
- If `vaultEncryptionEnabled` is `true`, keep the current passphrase step and encrypted vault flow.
- The setup wizard uses the current config flag so restarts do not silently flip modes.

## Migration Flow
- **ON -> OFF**
  1. Ensure encrypted vault is unlocked.
  2. Export decrypted entries to plaintext JSON.
  3. Save plaintext to `vault.json` (overwrite).
  4. Update config `vaultEncryptionEnabled=false`.
  5. Hide lockscreen; treat vault as unlocked.
- **OFF -> ON**
  1. Prompt for passphrase.
  2. Initialize encrypted vault, import plaintext entries.
  3. Export encrypted JSON and save to `vault.json`.
  4. Update config `vaultEncryptionEnabled=true`.
  5. Lockscreen resumes on next launch (or immediately if requested by UX).

## Error Handling
- Toggle OFF:
  - If unlock fails, abort and keep encryption ON; show warning banner.
  - If plaintext export or save fails, revert toggle and keep encryption ON.
- Toggle ON:
  - If passphrase validation or encryption fails, keep OFF and show warning.
- Startup:
  - Encryption ON + missing vault -> existing missing-vault flow.
  - Encryption OFF + invalid/missing plaintext -> treat as empty vault and warn.

## Testing
- Frontend: `tests/frontend/main.test.ts`
  - When `vaultEncryptionEnabled=false`, skip `VaultUI` and configure models directly.
- Settings: add coverage for toggling OFF -> save plaintext + update config.
- Sidecar: `tests/sidecar/config-store.test.ts`
  - Ensure `vaultEncryptionEnabled` defaults to `true` and persists updates.

## Rollout
- Ship as opt-in via Settings toggle.
- Keep default encryption ON for existing users.
