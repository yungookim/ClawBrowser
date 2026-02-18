# Setup Wizard Reset Design [COMPLETED]

Status: COMPLETED

## Summary
Add a Settings button that restarts the **Setup Wizard** immediately after confirmation. The flow creates a **fresh vault** and overwrites existing vault data when the wizard completes.

## Goals
- Provide a quick way to re-run the Setup Wizard from Settings.
- Start the wizard immediately (no reload).
- Create a fresh vault and overwrite existing vault data on completion.

## Non-goals
- Migrating or preserving old vault data.
- Renaming internal config fields like `onboardingComplete`.

## UX
- Settings card titled "Setup Wizard" with a button labeled `Restart Setup Wizard`.
- Confirmation dialog: warns that a new vault will overwrite existing vault data.
- On confirm, the wizard opens immediately.

## Architecture & Data Flow
- `main.ts` adds a `startSetupWizard({ freshVault })` helper.
  - For `freshVault: true`, do not load existing vault data.
  - Reuse the existing `onComplete` logic to save config, save vault, and configure models.
- `SettingsPanel` receives an optional callback to trigger the wizard.
  - On confirm, it triggers the callback immediately and updates config to `onboardingComplete: false` in the background.

## Error Handling
- If config update fails, show a warning banner but keep the wizard open.

## Testing
- Settings panel test: confirm -> callback called, config update attempted.
