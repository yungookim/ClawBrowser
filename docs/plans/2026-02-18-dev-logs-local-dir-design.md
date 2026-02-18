# Design: Dev Log Directory Override

Date: 2026-02-18
Status: APPROVED

## Context
During development, we want logs stored in a repo-local directory so they can be easily shared with development agents. Today, chat logs and system logs are written under `~/.clawbrowser/workspace/logs`.

## Goals
- In dev mode (`npm run dev`), write both chat logs and system logs under `./log` in the repo root.
- Keep production log paths unchanged.
- Keep retention behavior and log formats unchanged.
- Ensure `./log` is ignored by git.

## Non-Goals
- Moving workspace data or memory DB into the repo.
- Changing log levels, formats, or retention policy.
- Adding new UI around logs.

## Proposed Solution
- Add `CLAW_LOG_DIR=./log` to the `npm run dev` script.
- Sidecar resolves `CLAW_LOG_DIR` against `process.cwd()` when it is a relative path.
- Sidecar uses the resolved directory as the base logs directory:
  - Chat logs: `<base>/YYYY-MM-DD.md`
  - System logs: `<base>/system/YYYY-MM-DD.log`
- Rust system logger checks `CLAW_LOG_DIR` and, if set, uses `<base>/system` (resolved relative to `current_dir()` if needed).
- Add `/log/` to `.gitignore`.
- If `CLAW_LOG_DIR` is absent or invalid, fall back to existing `~/.clawbrowser/...` behavior.

## Components
- `package.json`: add `CLAW_LOG_DIR=./log` to `dev` script.
- `sidecar/main.ts`: resolve dev log base dir and pass to `DailyLog` and `SystemLogger`.
- `src-tauri/src/logger.rs`: read `CLAW_LOG_DIR` and resolve system log dir.
- `.gitignore`: add `/log/`.

## Data Flow
1. `npm run dev` sets `CLAW_LOG_DIR=./log`.
2. Sidecar uses `CLAW_LOG_DIR` to place chat + system logs under `./log`.
3. Rust logger uses `CLAW_LOG_DIR` to write system logs under `./log/system`.

## Error Handling
- If `CLAW_LOG_DIR` cannot be resolved, keep existing default log locations.
- Log write failures remain non-fatal (current behavior).

## Testing
- Run `npm run dev` and trigger:
  - a chat log entry (e.g., agent interaction)
  - a system error log (e.g., `console.error` from frontend)
- Verify:
  - `./log/YYYY-MM-DD.md` exists and updates.
  - `./log/system/YYYY-MM-DD.log` exists and updates.
