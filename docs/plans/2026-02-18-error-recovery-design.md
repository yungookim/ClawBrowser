# Error-Aware Recovery Layer Design

**Date:** 2026-02-18
**Status:** Approved

## Problem

When a sidecar request times out (e.g., `Sidecar request timeout: agentQuery`), the error is caught in `AgentPanel.handleUserMessage()` and displayed as a dead-end error message. The LLM never sees the failure and has no opportunity to retry or adapt.

## Approach

Error-aware wrappers inline in `AgentCore` and `Swarm`. When a model invocation or tool call fails with a retryable error, the error is injected into the LLM's conversation context so it can adapt its strategy. The LLM actively participates in recovery.

## Error Classification

Two categories — retryable vs non-retryable:

```typescript
interface ErrorContext {
  retryable: boolean;
  message: string;
  retriesAttempted: number;
  failedOperation: string;
}
```

- **Retryable:** rate limits, timeouts, transient 5xx, tool failures
- **Non-retryable:** sidecar process crash, no model configured, invalid config

Heuristic classifier:

```typescript
function isRetryable(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes('timeout') || msg.includes('rate') || msg.includes('429')
    || msg.includes('503') || msg.includes('500') || msg.includes('failed');
}
```

## Recovery in AgentCore

`AgentCore.invokeWithTools()` wraps each `model.invoke()` call with recovery:

1. Try `model.invoke(messages)`
2. On retryable error → append error context message to messages:
   `"The previous model call failed: [error]. Adjust your approach — try a simpler action or different tool."`
3. Retry `model.invoke(messages)` with injected context (max 2 retries)
4. On non-retryable error → throw immediately

The LLM sees its own failure and can change strategy.

New method: `AgentCore.invokeWithRecovery(model, messages, context)`

## Recovery in Swarm

Extends existing resilience (consecutive failure detection, step timeouts):

- **executorNode:** wrap each `model.invoke()` with the same `invokeWithRecovery` pattern
- **plannerNode/evaluatorNode/replannerNode:** simple auto-retry (1 attempt) — these are planning/evaluating, not executing
- **Notification:** emit `swarmRecoveryAttempted` so frontend can show "Retrying..." indicator

## Frontend Awareness (Minimal)

- Handle `swarmRecoveryAttempted` notification → show "Retrying..." instead of immediate error
- Existing timeout error in `AgentPanel.handleUserMessage()` stays as final fallback

## Configuration

`ConfigStore` gains:

```typescript
agentRecovery: {
  maxRetries: 2,
  enabled: true,
}
```

## Files to Modify

- `sidecar/core/AgentCore.ts` — add `invokeWithRecovery`, `isRetryable`, `ErrorContext`
- `sidecar/core/Swarm.ts` — wrap model calls in executor/planner/evaluator/replanner nodes
- `sidecar/core/ConfigStore.ts` — add `agentRecovery` config
- `src/agent/AgentPanel.ts` — handle `swarmRecoveryAttempted` notification
- Tests for all of the above
