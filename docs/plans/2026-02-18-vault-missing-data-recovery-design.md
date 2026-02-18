# Vault Missing Data Recovery Design

Date: 2026-02-18

## Summary
Prevent silent creation of an empty vault when the encrypted vault file is missing. Surface a clear recovery path (restart setup wizard) and avoid configuring hosted models without API keys after unlock.

## Goals
- Detect when onboarding is complete but the vault file is missing.
- Block unlock from silently creating a fresh vault in that case.
- Provide a recovery action that restarts setup wizard to create a new vault.
- Skip configuring hosted providers when required API keys are unavailable.

## Non-goals
- Persist API keys in config or any secondary store.
- Add environment-variable fallbacks for hosted providers.
- Change vault encryption format or key-derivation parameters.

## Design

### Startup Detection
- During app bootstrap, if `onboardingComplete` is true and `loadVault()` returns `null` or fails, mark the vault as missing.
- Show the vault overlay in a dedicated “missing vault data” state instead of the normal unlock flow.

### Vault UI Recovery State
- Extend the vault lock screen with a “Vault data not found” message.
- Hide the passphrase input and unlock button while in the missing state.
- Add a “Restart Setup Wizard” button that triggers `startSetupWizard({ freshVault: true })`.

### Model Configuration Guard
- When configuring models after unlock, only call `configureModel` for hosted providers if a key is present.
- Local providers (ollama/llamacpp) remain configurable without keys.

## Error Handling
- If vault data is missing: show a clear message and guide the user to restart setup wizard.
- If a hosted provider key is missing after unlock: skip configuration and log a warning.

## Testing Plan (Manual)
1. Complete onboarding with a hosted provider, restart, unlock: agent works.
2. Delete `~/.clawbrowser/vault.json`, restart: vault overlay shows recovery state and blocks unlock.
3. Click “Restart Setup Wizard”: onboarding appears and creates a new vault.
4. Configure a hosted model without an API key: unlock succeeds, model configuration is skipped and warning is logged.

## Open Questions
- None.
