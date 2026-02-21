# Stagehand Router + Webview Fallback Design

Date: 2026-02-21

## Context
Stagehand (`browser.*`) runs locally via CDP and is more reliable than the existing `dom.automation` chain, but we want redundancy. When Stagehand fails, the system should attempt recovery and then fall back to webview tools so the agent can still complete tasks. We also need strong logging to debug failures.

## Goals
- Route Stagehand tool calls with a single retry.
- If retry fails, force fallback to webview tools (`tab.*`, `nav.*`, `dom.automation`, etc.).
- Provide clear, structured logs in both stderr and SystemLogger.
- Keep behavior consistent in both AgentCore (simple path) and Swarm (multi-step path).

## Non-Goals
- Removing existing `dom.automation` or webview tooling.
- Building a new dispatcher abstraction.
- Changing global timeouts or prompt structure outside of the routing logic.

## Architecture (Approved)
- Implement fallback logic inline in:
  - `sidecar/core/AgentCore.ts` (`invokeWithTools` loop)
  - `sidecar/core/Swarm.ts` (`executorNode` loop)
- Track two flags per request/step:
  - `stagehandRetryUsed: boolean`
  - `stagehandDisabled: boolean`
- Behavior:
  - First Stagehand failure: log reason, inject retry instruction, allow one more Stagehand attempt.
  - Second Stagehand failure: log, disable Stagehand for the rest of that request/step, inject instruction to use webview tools.
  - If model continues to emit `browser.*` after disable: return a tool error so the model re-plans with webview tools.

## Data Flow
1. LLM emits tool call.
2. If `capability === 'stagehand'`, execute Stagehand tool.
3. On failure:
   - Log `{ event: "stagehand_fallback", action, attempt, reason, fallback }`.
   - If retry not used: inject “Stagehand failed: <reason>. Try Stagehand once more.”
   - If retry used: inject “Stagehand failed again: <reason>. Use webview tools now.” and disable Stagehand for remainder of request/step.
4. Once Stagehand is disabled, only webview tools are permitted for the remainder of that request/step.

## Error Handling
- Stagehand retry count = 1 per request/step.
- StagehandBridge already re-initializes on crash; if it still fails, the router fallback triggers.
- Prevent infinite loops by rejecting `browser.*` after Stagehand is disabled.

## Logging
- Log to **stderr** and **SystemLogger** for each:
  - Stagehand failure
  - Stagehand retry
  - Stagehand disabled + fallback
- Suggested payload (JSON string):
  `{"event":"stagehand_fallback","action":"act","attempt":1,"reason":"...","fallback":"retry|webview"}`

## Log Location
- If `CLAW_LOG_DIR` is set, SystemLogger writes to `${CLAW_LOG_DIR}/system/YYYY-MM-DD.log`.
- Otherwise it writes under the workspace logs directory (default: `~/.clawbrowser/workspace/logs/system`).

## Verification
- Unit tests for AgentCore and Swarm fallback behavior (Stagehand retry + disable + webview).
- Manual run: invoke browser actions to trigger Stagehand failure and verify fallback logs.

## Rollback / Iteration
If fallback behavior is too aggressive or noisy:
- Make retry policy conditional on specific errors.
- Move routing logic to a shared router class to reduce duplication.
- Add configurable flags to enable/disable fallback per environment.
