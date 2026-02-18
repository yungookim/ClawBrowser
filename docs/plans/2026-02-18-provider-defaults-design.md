# Provider Defaults Auto-Population Design [COMPLETED]

Date: 2026-02-18
Status: COMPLETED

## Summary
Add shared provider defaults that auto-populate model configuration fields when the provider changes. Apply the behavior in both Settings and Onboarding. Base URL is always overwritten with the provider default, and API key is required for non-local providers.

## Goals
- Auto-fill provider-specific defaults (base URL, API key required state) on provider change.
- Apply to Settings model form and Onboarding model sections.
- Keep provider list unchanged: openai, anthropic, groq, ollama, llamacpp.

## Non-Goals
- Changing provider list or adding new providers.
- Auto-selecting model names or changing model routing behavior.
- Server-side validation changes.

## Provider Defaults
These defaults come from the vendors' OpenAI-compatible API documentation.

- openai
  - baseUrl: https://api.openai.com/v1
  - apiKeyRequired: true
- anthropic
  - baseUrl: https://api.anthropic.com
  - apiKeyRequired: true
- groq
  - baseUrl: https://api.groq.com/openai/v1
  - apiKeyRequired: true
- ollama
  - baseUrl: http://localhost:11434/v1/
  - apiKeyRequired: false (local)
- llamacpp
  - baseUrl: http://localhost:8080/v1
  - apiKeyRequired: false (local)

## Architecture
Introduce a shared helper module (e.g. src/shared/providerDefaults.ts) that exports:
- A typed map of provider -> defaults (baseUrl, apiKeyRequired, example placeholders).
- A function applyProviderDefaults(inputs, provider, { force: true }) that:
  - Overwrites baseUrl with the provider default.
  - Sets apiKey input required state based on apiKeyRequired.
  - Updates placeholders and helper text where present.

Both SettingsPanel and Wizard will import and use this helper so defaults remain consistent.

## Components
- Settings panel (src/settings/SettingsPanel.ts)
  - On provider select change, call applyProviderDefaults for the form inputs.
  - On submit, block save with banner if apiKey is missing for non-local providers.
- Onboarding wizard (src/onboarding/Wizard.ts)
  - On provider select change in each section, call applyProviderDefaults.
  - Apply defaults on section creation to initialize baseUrl for the default provider.
  - On collectModels, block progression if apiKey missing for any non-local configured model and show a targeted error.

## Data Flow
Provider change -> applyProviderDefaults -> baseUrl overwritten -> apiKey required toggled -> placeholders updated.

## Error Handling
- Settings: use existing banner to warn when apiKey is missing for non-local providers.
- Onboarding: show a role-specific error in the existing error element and prevent moving forward.

## Testing
Manual checks:
- Settings: switch providers and confirm baseUrl overwrites; save is blocked without apiKey for openai/anthropic/groq.
- Onboarding: switch providers across roles; confirm baseUrl overwrites and missing apiKey blocks Next for non-local providers.
- Local providers (ollama/llamacpp): confirm apiKey not required.
