# Terminal Command Execution Implementation Plan

**Date:** 2026-02-18  
**Owner:** ClawBrowser

## Scope
Implement terminal command execution with no allowlist enforcement, workspace-only `cwd`, and a Settings UI panel for running commands and viewing history/output. Reuse the existing JSON-RPC pipeline.

## Non-Goals
- Streaming output.
- Per-command approval prompts.
- Arbitrary `cwd` outside the configured workspace.

## Plan
1. **Sidecar: disable allowlist enforcement**
   - Update `sidecar/core/CommandExecutor.ts` to bypass allowlist validation in `execute`.
   - Keep workspace-only `cwd` constraint via `resolveCwd`.
   - Keep config schema fields (`commandAllowlist`) for backward compatibility.

2. **Sidecar: update logging and prompts**
   - In `sidecar/main.ts`, append a daily log entry for each `terminalExec` (timestamp, command, args, exitCode).
   - In `sidecar/core/AgentCore.ts`, remove “allowlisted commands only” wording from the system prompt.

3. **Frontend: replace Allowlist UI with Terminal UI**
   - Update `src/settings/SettingsPanel.ts`:
     - Remove allowlist form + list.
     - Add Terminal form: Command, Args (one per line), CWD.
     - Add Run button and disable it when sidecar is offline.
     - Add local in-memory history list and details panel for stdout/stderr.
     - Show banner: “Commands run without allowlist checks; cwd restricted to workspace.”
   - Update `src/styles/settings.css` with Terminal card styles.

4. **Bridge: ensure terminalExec usage**
   - Reuse `SidecarBridge.terminalExec` for requests.
   - Handle JSON-RPC errors to display friendly UI messages.

5. **Tests and manual verification**
   - Update `tests/sidecar/command-executor.test.ts` to reflect no allowlist enforcement.
   - Manual checks:
     - Run a simple command, verify stdout/stderr in UI and DailyLog.
     - Attempt `cwd` outside workspace, verify error.
     - Sidecar offline state shows disabled Run button.

## Milestones
- **M1:** Sidecar executes commands without allowlist checks, workspace-only `cwd` enforced.
- **M2:** Terminal Settings UI operational with history/output.
- **M3:** Logs and tests updated.

