# Sidecar Dev Launcher Design

## Goal
Fix the dev-only “Sidecar offline or unreachable” issue by providing a dedicated sidecar launcher that resolves to the repo-root `sidecar/dist/main.js`, without changing production behavior.

## Approach (Selected)
Use a dev-specific sidecar name and launcher script. The frontend selects the sidecar name via a `VITE_` environment variable in dev; production keeps the existing sidecar name.

## Architecture
- Production: `sidecar/clawbrowser-agent` (unchanged).
- Development: `sidecar/clawbrowser-agent-dev` resolved via `VITE_SIDECAR_NAME`.
- Both sidecars are declared in Tauri config and allowed in shell capabilities; only the dev script changes the runtime path.

## Components
- `src-tauri/sidecar/clawbrowser-agent-dev-aarch64-apple-darwin`
  - Bash launcher that execs `node <repo>/sidecar/dist/main.js`.
  - Exits non-zero with a clear error if the file is missing.
- `src/agent/SidecarBridge.ts`
  - Use `import.meta.env.VITE_SIDECAR_NAME ?? 'sidecar/clawbrowser-agent'`.
- `package.json`
  - `dev` script sets `VITE_SIDECAR_NAME=sidecar/clawbrowser-agent-dev`.
- `src-tauri/capabilities/default.json`
  - Allow spawn for `sidecar/clawbrowser-agent-dev`.
- `src-tauri/tauri.conf.json`
  - Add `sidecar/clawbrowser-agent-dev` to `bundle.externalBin` so Tauri validates the sidecar name.

## Data Flow
1. `npm run dev` sets `VITE_SIDECAR_NAME`.
2. `SidecarBridge` calls `Command.sidecar(<env name>)`.
3. Tauri spawns the matching sidecar script.
4. Dev launcher execs `node sidecar/dist/main.js` from repo root.

## Error Handling
- Dev launcher checks that `sidecar/dist/main.js` exists. If missing, it prints a short error and exits non-zero.
- Settings continues to show “Sidecar offline or unreachable” when ping fails.

## Testing
- `npm run build:sidecar` then `npm run dev` → Settings should show “Sidecar online”.
- Break the path intentionally (rename `sidecar/dist/main.js`) → launcher error and Settings banner indicates offline.
