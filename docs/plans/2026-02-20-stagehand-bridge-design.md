# Stagehand Bridge Integration Design

Date: 2026-02-20

## Context
The current `dom.automation` path crosses multiple fragile layers (sidecar notification → frontend router → DomAutomationBridge → Tauri injectJs → injected page script → Tauri event → result). This fails frequently due to tab sync issues, script injection unreliability, and `window.__TAURI__` availability in webviews.

Stagehand (`@browserbasehq/stagehand`) can control Chrome locally via CDP. By integrating Stagehand in the sidecar, new `browser.*` tools can execute locally without crossing the JSON-RPC boundary to the frontend, while keeping `dom.automation` for backward compatibility.

## Goals
- Add a local Stagehand execution path in the sidecar.
- Provide `browser.*` tools that route to Stagehand.
- Ensure lazy initialization, health checks, and idle shutdown.
- Expose status and close operations over JSON-RPC.
- Preserve existing `dom.automation` behavior.

## Non-Goals
- Removing or refactoring existing `dom.automation` flow.
- Introducing a separate worker process for Stagehand.
- Changing frontend automation logic or permissions behavior.

## Proposed Architecture (Approved)
### Components
- `sidecar/dom/StagehandBridge.ts`
  - Owns Stagehand lifecycle and exposes tool methods.
  - Lazy initializes Stagehand on first use.
  - Idle timeout closes Chrome after 5 minutes of inactivity.
  - Health check before each action; reinit on unhealthy.
  - Methods: `navigate`, `act`, `extract`, `observe`, `screenshot`, `close`, `getStatus`.

- `sidecar/core/ToolRegistry.ts`
  - Add tool definitions:
    - `browser.navigate` (required: `url`)
    - `browser.act` (required: `instruction`)
    - `browser.extract` (required: `instruction`, optional: `schema`)
    - `browser.observe` (required: `instruction`)
    - `browser.screenshot` (optional: `fullPage`)
  - All use `capability: "stagehand"`.

- `sidecar/core/AgentCore.ts` and `sidecar/core/Swarm.ts`
  - Add optional `stagehandBridge` constructor parameter.
  - Before `dispatcher` path, route `capability === "stagehand"` to `executeStagehandTool()`.

- `sidecar/main.ts`
  - Instantiate `StagehandBridge` after config/model initialization.
  - Pass to `AgentCore` and `Swarm`.
  - Add `browserStatus` and `browserClose` JSON-RPC handlers.
  - Call `stagehandBridge.close()` on `SIGTERM` and stdin close.

## Data Flow
1. LLM emits `browser.*` tool call.
2. `ToolRegistry` parses tool call with `capability: "stagehand"`.
3. `AgentCore.executeToolCall()` / `Swarm.executeToolCall()` detects `stagehand` capability and calls `executeStagehandTool()`.
4. `StagehandBridge` ensures Stagehand is initialized and healthy.
5. Stagehand executes action locally via CDP and returns result.
6. Response is returned to the agent.

## Stagehand Initialization
- Lazy init: no browser at sidecar boot.
- Concurrent init: all calls await a shared `initPromise`.
- Model string resolution:
  1. `ModelManager.getConfig('primary')` → `${provider}/${model}`
  2. Else fallback to `ConfigStore.get().models.primary` → `${provider}/${model}`
  3. Else default to `openai/gpt-4o`
- Constructor:
  - `new Stagehand({ env: 'LOCAL', model, localBrowserLaunchOptions: { headless: false } })`

## Health Checks and Recovery
- Before each action, check if browser/page is healthy.
- If unhealthy, reinitialize and retry the action once.
- Store `lastError` on failures, clear `initPromise` on init error.
- `close()` is idempotent.

## Idle Shutdown
- On each successful tool call, reset idle timer.
- After 5 minutes of inactivity, `StagehandBridge.close()` runs.

## JSON-RPC Handlers
- `browserStatus`: returns a rich status object:
  - `{ active, lastUsedAt, idleMs, initializing, lastError, browserPid, wsEndpoint }`
- `browserClose`: calls `StagehandBridge.close()` and returns `{ status: "ok" }`.

## Screenshot Behavior
- `browser.screenshot` defaults to viewport only.
- `fullPage: true` captures full page.

## Testing Strategy
- New unit tests: `tests/sidecar/stagehand-bridge.test.ts`.
  - Lazy init, reuse, concurrent init coalescing.
  - Method coverage: `navigate`, `act`, `extract`, `observe`, `screenshot`.
  - Close and status behavior.
  - Model config resolution and fallback.
  - Error handling and crash recovery.
  - Idle timeout via fake timers.
- Minimal coverage for tool routing in `AgentCore` and `Swarm`.

## Verification
- `npm run test`
- `npm run build:sidecar`
- Manual: run app and use `browser.*` tools to open Chrome and complete a simple search task.

## Rollback / Iteration Notes
If this approach fails (e.g., Stagehand stability, resource usage, or tool UX issues), revisit:
- Move Stagehand into a dedicated worker process.
- Route Stagehand calls through an internal dispatcher abstraction.
- Add stronger health telemetry or error classification.
