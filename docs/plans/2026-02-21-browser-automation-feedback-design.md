# Browser Automation Logging + Self-Improvement Design

Date: 2026-02-21

## Context
Production browser automation failures are hard to debug because behavior depends on live websites and the current automation path. We need a consistent router that can try multiple providers, high‑fidelity logs and artifacts, and a feedback loop that improves reliability over time.

## Goals
- Route `browser.*` tools through a single router with Stagehand first and webview fallback.
- Provide structured logs and artifacts under `CLAW_LOG_DIR` for every attempt.
- Record screenshots for every attempt and hybrid DOM snapshots on failure.
- Add a repeatable feedback loop: scenario runner, analyzer, and regression policy.
- Preserve user privacy via PII redaction in logs and snapshots.
- Keep the system extensible for future providers.

## Non‑Goals
- Removing or rewriting existing `dom.automation` tooling.
- Replacing the LLM planner or prompt system.
- Building a full synthetic website testing harness.

## Architecture
- **BrowserAutomationRouter (sidecar)**
  - Single entry point for `browser.*` tools.
  - Selects provider order and applies retry/fallback policy.
  - Emits structured logs and manages artifacts per attempt.
- **Providers**
  - `StagehandProvider` wraps `StagehandBridge` (CDP/Chrome).
  - `WebviewProvider` wraps existing webview tooling for fallback.
  - Future providers implement `navigate/act/extract/observe/screenshot`.
- **Correlation IDs**
  - `traceId` for the agent request.
  - `stepId` for swarm step context.
  - `attemptId` for each provider attempt.

## Data Flow
1. Agent emits a `browser.*` tool call.
2. Router assigns `attemptId`, logs `start`, and selects Stagehand (if not disabled).
3. Provider executes and returns `result` or `error`.
4. Router writes artifacts:
   - Screenshot for every attempt.
   - Hybrid DOM snapshot on failure: full A11y tree + minimal DOM JSON around failure‑adjacent nodes.
5. On first failure, router returns a tool error instructing the LLM to retry Stagehand once with the failure reason.
6. On second failure, router disables Stagehand for the remainder of the request/step and routes to WebviewProvider.
7. On success, router returns results and logs `success`.

## Error Handling
- Stagehand is retried once per request/step.
- Webview is not retried by default.
- Stagehand crash detection triggers re‑init before failure is reported.
- All errors are normalized into `{ type, message, retryable }` for consistent logging.
- Router enforces a max per‑attempt duration and logs timeouts explicitly.

## Logging + Artifacts
- **Root directory**: `CLAW_LOG_DIR/browser-automation/YYYY-MM-DD/<traceId>/`
- **Files**:
  - `attempt.jsonl` for lifecycle events: `start`, `success`, `failure`, `fallback`, `disabled`.
  - `summary.json` with run totals, provider success rates, and final decision.
  - `artifacts/` for screenshots and DOM snapshots.
- **Fields (JSONL)**:
  `ts, traceId, stepId, attemptId, action, provider, durationMs, outcome, reason, retryUsed, stagehandDisabled, toolArgsHash`
- **Redaction**:
  - Mask input values and URL query params.
  - Apply the same redaction rules to DOM snapshots.
- **Visibility**:
  - Structured logs go to `SystemLogger` at `info`.
  - `stderr` only for failure summaries.

## Testing + Self‑Improvement Loop
- **Scenario runner** executes a curated suite of flows with fixed prompts and seeds.
- **Analyzer** reads `summary.json` and `attempt.jsonl` and produces `docs/ops/browser-automation-report.md`.
- **Regression policy** fails if:
  - Stagehand success rate drops more than 10% from baseline.
  - A new error type exceeds 5% of attempts.
- **Production sampling** periodically feeds real runs into the analyzer to update the scenario suite.

## Verification
- Unit tests for router policy, logging, and artifact creation.
- Scenario runner regression tests for Stagehand + webview paths.
- Manual run on a live website to confirm artifacts and report generation.

## Rollback / Iteration
- Make retry policy error‑specific if false positives are too high.
- Adjust screenshot or DOM snapshot frequency if overhead is excessive.
- Add or remove providers without changing the router contract.
