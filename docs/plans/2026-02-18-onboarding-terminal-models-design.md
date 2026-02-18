# ClawBrowser Onboarding + Models + Terminal Exec Design [COMPLETED]

Status: COMPLETED (onboarding, models, config store, command executor all implemented; terminal execution redesigned in separate plan)

## Summary
Implement the onboarding flow and model role configuration (primary/secondary/subagent), plus agent-initiated command execution through a regex allowlist. Store persistent config in the sidecar at `~/.clawbrowser/config.json` and keep secrets in `~/.clawbrowser/vault.json`.

## Goals
- Show onboarding wizard only on first run.
- Let users configure primary, secondary, and subagent models.
- Store API keys encrypted in the vault.
- Allow agent-initiated command execution (Codex / Claude Code) gated by a regex allowlist editable in Settings.
- macOS-only scope for v1.

## Non-Goals
- Embedded terminal UI.
- Cross-platform command execution.
- Dynamic Tauri shell allowlist configuration.

## Architecture
- Sidecar owns config + execution policy.
- Frontend reads/writes config via JSON-RPC through the existing SidecarBridge.
- Vault remains frontend crypto; sidecar only stores encrypted vault blob to disk.

## Data Model
`~/.clawbrowser/config.json`:
```
{
  "onboardingComplete": false,
  "workspacePath": null,
  "models": {
    "primary": { "provider": "openai", "model": "gpt-5.2", "baseUrl": null, "temperature": 0.7 },
    "secondary": { "provider": "groq", "model": "llama-3.1-70b", "baseUrl": null, "temperature": 0.3 },
    "subagent": { "provider": "anthropic", "model": "claude-opus-4.6", "baseUrl": null, "temperature": 0.7 }
  },
  "commandAllowlist": [
    { "command": "codex", "argsRegex": ["^--project$", "^.+$"] },
    { "command": "claude", "argsRegex": ["^code$", "^--project$", "^.+$"] }
  ]
}
```

`~/.clawbrowser/vault.json`:
- Encrypted blob produced by the existing `Vault` class.

## Onboarding Flow
1. Welcome
2. Workspace import or start fresh
3. Model setup for primary/secondary/subagent
4. Passphrase (create vault, store API keys)
5. Complete

Behavior:
- Wizard shows only if `onboardingComplete` is false.
- On completion, models are sent to the sidecar and persisted in config.
- API keys are written only to the vault.

## Settings
Add a **Command Allowlist** card:
- List entries (command + regex list).
- Form to add/edit command and regex list (one regex per line).
- Saves to sidecar config.

Models card:
- Keep the current model form, extend role dropdown to include `secondary`.
- Save calls `configureModel` and updates config.

## Command Execution
Add sidecar JSON-RPC method `terminalExec`:
- Params: `{ command, args, cwd? }`
- Validation: `command` must match allowlist entry; each arg must match at least one regex in that entry.
- Execution: `child_process.spawn` with `shell: false` and output capture.
- Response: `{ exitCode, stdout, stderr }`

## Model Role Usage
- `primary` for main chat and planning.
- `secondary` for fast/cheap tasks (heuristic routing with fallback to primary).
- `subagent` for swarm executor (fallback to primary if missing).

## Sidecar API Additions
- `getConfig`
- `updateConfig`
- `loadVault`
- `saveVault`
- `terminalExec`

## Error Handling
- Invalid regex or allowlist match failures return explicit JSON-RPC errors.
- Command execution errors return non-zero exit code and stderr.

## Testing
- Sidecar unit tests for allowlist validation and config read/write.
- Basic frontend checks for onboarding gating and settings persistence.

## Open Questions
- Heuristic for secondary routing (length-based or token estimate).
- Default allowlist entries for Codex/Claude Code.
