# AGENTS

This file provides working guidance for AI agents contributing to ClawBrowser.

## Quick Commands
- `npm run dev` - Run the full Tauri app in dev mode.
- `npm run dev:frontend` - Run the Vite frontend only.
- `npm run build` - Build sidecar and Tauri app.
- `npm run build:sidecar` - Build the sidecar TypeScript.
- `npm run test` - Run the test suite.

## Repo Map
- `src/` - Frontend UI and app logic.
- `sidecar/` - Sidecar process code.
- `src-tauri/` - Tauri backend configuration and Rust glue.
- `docs/` - Plans and documentation.
- `tests/` - Test suite.

## Current Plans
- Active project plans live under `docs/plans/` (see README for links).

## Design Philosophy
- **No rounded corners.** All UI elements must use square corners (`border-radius: 0`). Never use `border-radius` with a non-zero value. The CSS variables `--radius` and `--radius-sm` are set to `0` and must stay that way. Do not introduce hardcoded `border-radius` values.

## Architecture
The correct architecture is an agentic loop:
1. **Understand** — Parse the user's intent; ask clarifying questions if ambiguous
2. **Generate** — Produce the full UI code (not a DSL mapped to fixed component renderers)
3. **Connect** — Wire the generated UI to real APIs using the capability map
4. **QA** — A review agent evaluates the generated view and provides feedback
5. **Iterate** — The generation agent incorporates feedback and re-generates until satisfactory

## Development Mode

The `dev` script already sets `CLAW_LOG_DIR=./log`, so all logs land in `./log/` relative to the repo root when you run:

```bash
npm run dev
```

`SystemLogger` (`sidecar/logging/SystemLogger.ts`) defaults to `minLevel: 'error'`. To get verbose output during development, construct it with `minLevel: 'debug'`:

```ts
new SystemLogger({ logsDir: logDir, minLevel: 'debug' });
```

Log files are auto-pruned after 7 days. If `CLAW_LOG_DIR` is unset, logs fall back to `~/.clawbrowser/workspace/logs/system/`.

## Logging Conventions

### Log levels

| Level   | Use for                                                | Example                                                    |
|---------|--------------------------------------------------------|------------------------------------------------------------|
| `debug` | Tracing flow, entry/exit of functions, intermediate state | `[AgentCore] classifyAndRoute: complexity=simple tools=3`  |
| `info`  | Meaningful state changes, successful completions       | `[Swarm] Plan ready: 4 steps`                              |
| `warn`  | Recoverable problems, degraded paths                   | `[StagehandBridge] Stagehand unhealthy, reinitializing`    |
| `error` | Unrecoverable failures, crashes                        | `[AgentDispatcher] TIMEOUT reqId=abc after 30000ms`        |

### Sidecar vs frontend

- **Sidecar**: Always use `console.error()`. Stdout is the JSON-RPC channel — any `console.log()` there corrupts the protocol.
- **Frontend**: Use `console.log()` for normal flow, `console.warn()` for degraded paths, `console.error()` for failures.

### Tag prefix

Every log line must start with a tag in brackets identifying the source module:

```
[ClassName]              — e.g. [AgentCore], [Swarm], [ToolRegistry]
[ClassName/Side]         — when the same concept spans sidecar and frontend,
                           e.g. [DomAutomation/Sidecar], [SidecarAutomationRouter]
```

### Request correlation

All request/response logs must include `reqId=<uuid>` so a single operation can be traced across the sidecar → frontend → tab → result chain. Both `AgentDispatcher` and `DomAutomation` generate a UUID per request; propagate it at every hop.

```
[DomAutomation/Sidecar] Sending domAutomationRequest: reqId=abc tabId=1 actions=2 timeoutMs=30000
[SidecarAutomationRouter] domAutomationRequest received: reqId=abc tabId=1 actions=2
[SidecarAutomationRouter] sending domAutomationResult: reqId=abc ok=true
[DomAutomation/Sidecar] handleResult: resolved reqId=abc ok=true
```

### Timing

Log `durationMs` for any async operation that could be slow (network, browser, model calls). The in-tab `domScript.ts` already reports `durationMs` in its result — surface this in upstream logs too.

## Browser Automation Logging

Browser automation is the core flow. Two paths exist; both must be thoroughly logged.

### Stagehand path (`StagehandBridge`)

The Stagehand path uses a managed Chromium instance controlled by the Stagehand SDK.

**What to log at each stage:**

| Stage | Level | What to log |
|-------|-------|-------------|
| Lazy init start | `info` | `[StagehandBridge] Initializing: model=<provider/model> headless=<bool>` |
| Lazy init complete | `info` | `[StagehandBridge] Ready: browserPid=<pid> wsEndpoint=<ws>` with `durationMs` |
| Operation entry | `debug` | `[StagehandBridge] <op>: <params summary>` — for navigate/act/extract/observe/screenshot |
| Operation complete | `debug` | `[StagehandBridge] <op> complete: durationMs=<ms> <result summary>` |
| Health check fail | `warn` | `[StagehandBridge] Stagehand unhealthy, reinitializing` (already logged) |
| Crash detection | `warn` | `[StagehandBridge] Detected crashed browser, reinitializing` (already logged) |
| Recovery failure | `error` | `[StagehandBridge] Recovery failed: <error message>` |
| Idle timeout | `info` | `[StagehandBridge] Idle timeout reached (<ms>ms), closing` |
| Close | `debug` | `[StagehandBridge] Closed` |

### DOM Automation path (sidecar → frontend → tab → result)

The DOM path injects scripts into the user's existing browser tab via the Tauri webview.

**Sidecar side** (`DomAutomation`):
- Request dispatch: `reqId=<id> tabId=<id> actions=<count> timeoutMs=<ms>` (already logged)
- Result resolved: `reqId=<id> ok=<bool>` (already logged)
- Timeout: `reqId=<id> after <ms>ms — pending count: <n>` (already logged)
- Dropped result: `dropped — missing requestId` (already logged)

**Frontend side** (`SidecarAutomationRouter`, `DomAutomationBridge`):
- Request received: `reqId=<id> tabId=<id> actions=<count>` (already logged)
- Tab resolution: which tab was selected, any fallback
- Permission check: whether DOM automation was allowed/blocked for the origin
- Script injection: success or failure
- Result sent back: `reqId=<id> ok=<bool>` (already logged)

**In-tab** (`domScript.ts`):
- Run completion: `reqId=<id> ok=<bool> results=<count> durationMs=<ms>` (already logged)

### AgentDispatcher (capability routing)

The `AgentDispatcher` routes tool calls from the agent to frontend capabilities (DOM automation, tab management, etc.).

- Request dispatch: `reqId=<id> capability=<cap> action=<act> timeoutMs=<ms>` (already logged)
- Result resolved: `reqId=<id> ok=<bool>` (already logged)
- Timeout: `reqId=<id> after <ms>ms — pending count: <n>` (already logged)
- Dropped result: `dropped — missing requestId` (already logged)

## Browser Automation Feedback Loop

Use the browser automation router artifacts and analyzer to iterate on reliability.

- All browser automation logs and artifacts live under `CLAW_LOG_DIR/browser-automation/YYYY-MM-DD/<traceId>/`.
- Each attempt writes `attempt.jsonl` plus a `summary.json` for the run.
- Screenshots are captured for every attempt.
- On failure, capture a hybrid DOM snapshot: full A11y tree plus minimal DOM JSON around failure‑adjacent nodes.
- Logs and snapshots must apply PII redaction to input values and URL query params.
- Analyzer output is written to `docs/ops/browser-automation-report.md`.
- Analyzer script: `sidecar/tools/analyze-browser-automation.js` (runs automatically after `npm run test`).
- Baseline metrics stored in `docs/ops/browser-automation-baseline.json`.
- Regression policy: fail if Stagehand success drops >10% or any new error exceeds 5% of attempts.
- Retention: keep only the last 20 runs under `CLAW_LOG_DIR/browser-automation/`.
