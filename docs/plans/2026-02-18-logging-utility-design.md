# Design: Logging Utility + Retention [COMPLETED]

Date: 2026-02-18
Status: COMPLETED

## Context
ClawBrowser needs a logger with levels, daily file output, and one-week retention. There are two distinct log types:
- Chat logs for reflection (existing daily markdown files).
- System logs for debugging (sidecar + frontend + Rust).

Users also need a Settings button to open the logs folder.

## Goals
- Keep chat logs for reflection unchanged in format/location.
- Add system logs with level filtering (fixed minimum level = error).
- Retain only the last 7 UTC calendar days of logs (inclusive).
- Provide a Settings button to open the logs folder.

## Non-Goals
- User-configurable log level.
- Changing reflection behavior or chat-log format.
- In-app viewing of system logs.

## Requirements
- Chat logs remain at `~/.clawbrowser/workspace/logs/YYYY-MM-DD.md`.
- System logs stored at `~/.clawbrowser/workspace/logs/system/YYYY-MM-DD.log`.
- Retention: keep the last 7 UTC calendar days for both log types.
- Fixed minimum level for system logs: `error`.
- Settings button opens `~/.clawbrowser/workspace/logs`.

## Proposed Solution
### Architecture
- Keep `DailyLog` for chat logs; add retention and expose `getLogsDir()`.
- Introduce a sidecar `SystemLogger` utility with level filtering, daily files, and retention.
- Add a Rust logger that writes to the same system log folder with the same retention.
- Frontend debug capture filters to `error` and sends system log events to sidecar.

### Components
- Sidecar: `sidecar/logging/SystemLogger.ts`.
- Sidecar: `sidecar/memory/DailyLog.ts` retention + `getLogsDir()`.
- Sidecar: `sidecar/main.ts` handlers `logSystemEvent`, `getLogsDir`.
- Frontend: `src/debug/DebugCapture.ts` error-only forwarding.
- Frontend: `src/agent/SidecarBridge.ts` add `logSystemEvent`, `getLogsDir`.
- Rust: `src-tauri/src/logger.rs` file logger + retention; initialize in `src-tauri/src/lib.rs`.
- Settings UI: add “Open Logs Folder” button in `src/settings/SettingsPanel.ts`.

### Data Flow
1. Chat logs: existing `DailyLog.log()` calls -> daily markdown files.
2. System logs:
   - Sidecar console/error paths -> `SystemLogger` -> daily `.log` files.
   - Frontend debug capture -> `logSystemEvent` -> `SystemLogger`.
   - Rust logs via `log` crate -> Rust file logger.
3. Settings button: frontend requests logs path from sidecar and opens it using Tauri shell `open()`.

### Error Handling
- Logger write failures are non-fatal; failures are ignored after best-effort write.
- Retention pruning skips unknown filenames and ignores delete errors.

### Testing
Manual:
- Trigger a sidecar error and confirm it appears in system logs.
- Trigger a frontend console error and confirm it appears in system logs.
- Validate Reflection still reads chat logs.
- Set system clock forward and confirm logs older than 7 days are pruned.
- Click “Open Logs Folder” and confirm it opens `~/.clawbrowser/workspace/logs`.

## Risks
- Multiple writers to the system log directory may interleave lines (acceptable for debugging).
- UTC day boundaries may be unexpected to some users but match existing chat log naming.
