# Onboarding Reset Button Design

## Summary
Add a Settings button to restart onboarding by setting `onboardingComplete=false` and reloading the app. Preserve existing vault data so the user can re-enter their password and continue with their stored API keys.

## Goals
- Provide a one-click way to re-run onboarding.
- Keep existing vault data and API keys.
- Minimal changes to the existing onboarding flow.

## Non-goals
- Clearing or migrating vault data.
- Adding new onboarding steps.
- Changing model/config storage semantics.

## UX
- New Settings card titled "Onboarding" with a button labeled `Reset & Restart Onboarding`.
- Clicking prompts for confirmation.
- On confirm, update config, show a banner, and reload the app to show the wizard.

## Architecture & Data Flow
- `SettingsPanel` adds a new button handler:
  - `confirm()` -> `bridge.updateConfig({ onboardingComplete: false })` -> `location.reload()`.
- `main.ts`:
  - When `onboardingComplete` is false, attempt `sidecar.loadVault()` and pass the data into `Wizard`.
- `Wizard`:
  - Accept optional `existingVaultData` in the constructor.
  - On finish, if `existingVaultData` is present, call `vault.unlock(password, existingVaultData)`; otherwise, call `vault.unlock(password)`.

## Error Handling
- If `updateConfig` fails, show a warning banner and do not reload.
- If `loadVault` fails, log a warning and proceed with a fresh vault unlock.

## Testing
- `SettingsPanel` test: confirm + updateConfig + reload path.
- `Wizard` test: verify `vault.unlock` called with existing vault data when provided.
