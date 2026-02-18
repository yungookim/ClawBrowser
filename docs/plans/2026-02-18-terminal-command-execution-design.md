# Terminal Command Execution Design

**Date:** 2026-02-18  
**Owner:** ClawBrowser

## Goal
Enable the built-in agent to execute terminal commands without allowlist checks, while keeping execution constrained to the active workspace directory. Provide a UI panel for users to trigger and review command runs (history + output) and log each run to the daily log.

## Decisions
- **No allowlist validation** for terminal commands.
- **Workspace-only `cwd`**: commands may only run within the configured workspace directory.
- **No per-command approval prompt**.
- **UI-based execution** with history + output display; no streaming output for now.
- **Existing JSON-RPC pipeline** is reused; no new transport protocols.

## Architecture & Data Flow
1. UI Terminal panel calls `SidecarBridge.terminalExec(command, args, cwd)`.
2. Rust `sidecar_send` emits JSON-RPC -> `SidecarBridge` writes to sidecar stdin.
3. Sidecar `terminalExec` handler executes via `CommandExecutor.execute`.
4. Sidecar returns `{ exitCode, stdout, stderr }` to UI via JSON-RPC response.
5. UI stores a local history entry and renders output for the selected run.
6. Sidecar appends a concise log entry to DailyLog for audit/troubleshooting.

## UI/UX
- Add a **Terminal** card to Settings (replacing the current allowlist card).
- Fields:
  - `Command` input
  - `Args` textarea (one arg per line)
  - `CWD` (optional; relative to workspace root)
  - `Run` button
- History list (session-only) shows timestamp, command, exit code.
- Detail panel shows stdout/stderr for selected run.
- Banner text: “Commands run without allowlist checks; cwd restricted to workspace.”

## Error Handling
- **Sidecar offline**: disable Run button + show banner.
- **Invalid input**: empty command -> inline error banner.
- **Invalid cwd**: error banner if outside workspace.
- **Non-zero exit**: still captured; stderr shown separately.

## Logging
Each run appends a single line to DailyLog with timestamp, command, args, exit code.

## Backward Compatibility
- Keep existing config schema fields (`commandAllowlist`) intact to avoid migrations.
- Allowlist UI will be removed or hidden since it is no longer used.

## Testing
- Manual: run a valid command, verify stdout/stderr capture and history entry.
- Manual: run with invalid `cwd` outside workspace, verify error shown.
- Manual: confirm DailyLog entry created.

