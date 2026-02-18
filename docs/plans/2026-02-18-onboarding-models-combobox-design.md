# Onboarding Models Combobox + Copy Refresh

Date: 2026-02-18
Status: DRAFT

## Goals
- Remove workspace setup from onboarding (3-step wizard).
- Add clear explanations for Primary/Secondary/Subagent roles.
- Replace model name text inputs with a combobox (select or type).
- Use a static JSON catalog shipped in-app (future GitHub-hosted list).
- Remove temperature fields from onboarding and settings UI.
- Replace positioning copy with “smartest child of openclaw” everywhere it appears.

## Non-Goals
- Dynamic model fetching (deferred; later GitHub-hosted list).
- Backend schema migration for config; keep existing fields for compatibility.
- Full custom autocomplete component (native combobox only).

## UX Flow
- Wizard steps: Welcome → Model Configuration → Passphrase.
- Step indicators updated to 3 dots.
- Model Configuration includes short role explanations:
  - Primary: main model for most tasks.
  - Secondary: backup or specialized model for follow-up tasks.
  - Subagent: lightweight delegate for parallel or subtask work.

## Model Combobox Behavior
- Each role’s model input becomes `<input list="...">` with a provider-specific `datalist`.
- Provider change updates the list options for that role.
- Users can always type a custom model name (no validation lock-in).

## Static Model Catalog
- New file: `src/shared/modelCatalog.json`.
- Schema: top-level object keyed by provider; each value is an array of model IDs.
- Initial curated lists (by provider):
  - openai: gpt-5.2, gpt-5.2-pro, gpt-5-mini, gpt-5-nano, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
  - anthropic: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
  - groq: groq/compound, groq/compound-mini, llama-3.3-70b-versatile, llama-3.1-8b-instant, openai/gpt-oss-120b, openai/gpt-oss-20b
  - ollama: llama3.3, deepseek-v3, qwen2.5-coder, mistral-nemo, llama4, phi4-reasoning
  - llamacpp: (suggestions only) llama3.3, qwen2.5-coder, mistral-nemo, deepseek-v3

## Copy Updates
- Replace tagline/positioning text with “smartest child of openclaw” across the app:
  - Onboarding welcome description.
  - Settings kicker.
  - Vault subtitle.
  - Any other similar marketing copy.

## Compatibility
- Keep `workspacePath` in config; onboarding sets it to `null`.
- Keep `temperature` in config; remove from UI.

## Testing
- Update onboarding wizard tests for 3-step flow and role copy.
- Update tests that reference workspace selection or temperature inputs.
- Add minimal assertions for combobox presence and datalist population.

## Risks
- Incorrect model list freshness; mitigated by easy JSON updates and future GitHub hosting.
- Missing role descriptions in other flows; limited to onboarding for now.
