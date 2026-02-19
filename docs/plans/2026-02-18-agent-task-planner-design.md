# Multi-Step Agent Task Planner Design

**Date:** 2026-02-18
**Status:** Approved

## Problem

The agent currently executes a single tool call per user query. AgentCore's `invokeWithTools` calls the LLM once, parses one tool call, executes it, then sends a follow-up LLM call with "do not call tools again." This prevents complex workflows like "search for silver price news and summarize the top 5 headlines" which require a sequence of: navigate, search, open links, read pages, consolidate.

## Solution Overview

Evolve the existing `Swarm` class (LangGraph-based planner/executor/synthesizer) from text-only to tool-enabled, and add a complexity router to decide when to use it.

### Architecture

```
User prompt → agentQuery handler
    ↓
AgentCore.classifyAndRoute() — single LLM call
    ↓
Returns: { role, complexity: 'simple'|'complex' }
    ↓
simple → AgentCore.query() with multi-tool loop (max 5 iterations)
complex → Swarm.execute() with plan → execute (tool loops) → synthesize
```

## Component Changes

### 1. AgentCore — Combined Router

Replace `selectRole()` with `classifyAndRoute()` that returns both model role AND complexity in one LLM call:

```typescript
interface RouteDecision {
  role: ModelRole;          // 'primary' | 'secondary' | 'subagent'
  complexity: 'simple' | 'complex';
  reason: string;
}
```

**Router prompt:** Classifies `simple` (single action or direct answer) vs `complex` (needs multiple sequential actions, research, or multi-page browsing). Combined with existing role selection to avoid extra latency.

### 2. AgentCore — Multi-Tool Loop (Simple Path)

Replace the current one-shot `invokeWithTools` with a loop:

```
LOOP (max 5 iterations):
  Call LLM with messages
  Parse response for tool call
  If no tool call → done, return text response
  Execute tool call via AgentDispatcher or CommandExecutor
  Append tool result to messages as HumanMessage
  Continue loop
Return final text response
```

This handles simple multi-step tasks (e.g., "open google and search for cats") without Swarm overhead.

### 3. Swarm — Tool-Enabled Executor

**New dependencies injected via constructor:**
- `ToolRegistry` — tool definitions and parsing
- `AgentDispatcher` — execute browser/tab/dom tools
- `CommandExecutor` — execute terminal commands
- `sendNotification` — progress updates to frontend

**New `execute()` context parameter:**
```typescript
browserContext?: {
  activeTabUrl?: string;
  activeTabTitle?: string;
  tabCount?: number;
}
```

**Executor node enhancement — tool-calling loop per step:**

```
executorNode(state):
  1. sendNotification('swarmStepStarted', { stepIndex, description })
  2. Build messages with system prompt + step context + previous results + tool descriptions
  3. LOOP (max 10 iterations):
     a. Call LLM
     b. Parse response for tool call (via ToolRegistry)
     c. If no tool call → step done, break
     d. Execute tool via AgentDispatcher or CommandExecutor
     e. Append tool result to messages
     f. sendNotification('swarmToolExecuted', { stepIndex, tool, briefResult })
     g. Check aborted flag, check step timeout
  4. sendNotification('swarmStepCompleted', { stepIndex, result })
  5. Return step result to state
```

**Planner node enhancement:**
- Include available tool descriptions in planner prompt
- sendNotification('swarmPlanReady', { steps }) before execution starts

**Synthesizer node:** Unchanged — combines step results into final response.

**New state fields:**
```typescript
toolCallsPerStep: Annotation<number[]>  // track tool calls per step
```

### 4. Frontend UX — Plan Display and Progress

**New notifications handled by AgentPanel:**

| Notification | Action |
|---|---|
| `swarmPlanReady` | Display numbered step list in chat |
| `swarmStepStarted` | Highlight active step with spinner |
| `swarmToolExecuted` | Show tool activity under active step |
| `swarmStepCompleted` | Mark step done with checkmark |
| `swarmComplete` | Display final synthesized result |

**ChatView additions:**
- `addPlanMessage(steps: string[])` — Render step list with status indicators
- `updateStepStatus(index, status)` — Update individual step: pending/active/done/error
- `addToolActivity(stepIndex, toolName, brief)` — Subtle tool execution feedback

**Example chat rendering:**
```
User: Summarize the latest 5 headlines about silver price

Agent: Planning...
  1. [ ] Search Google for silver price news
  2. [ ] Open top 5 results
  3. [ ] Read and summarize each article
  4. [ ] Consolidate into final summary

  1. [>] Searching Google for silver price news...
     > tab.navigate: google.com
     > dom.automation: type "silver price news"
  1. [x] Found search results
  ...

Agent: [Final consolidated summary]
```

**Cancel button:** Visible during Swarm execution. Sends `swarmCancel` to sidecar.

### 5. Sidecar Wiring

**New handlers in main.ts:**

```typescript
handlers.set('swarmCancel', async () => {
  swarm.cancel();
  return { status: 'ok' };
});
```

**Modified agentQuery handler:**
```typescript
handlers.set('agentQuery', async (params) => {
  // ... existing param extraction ...

  const route = await agentCore.classifyAndRoute(context);

  if (route.complexity === 'complex') {
    const result = await swarm.execute(userQuery, {}, {
      activeTabUrl, activeTabTitle, tabCount
    });
    return { reply: result };
  }

  // Simple path — existing query with enhanced tool loop
  return agentCore.query(context);
});
```

**Swarm constructor update in boot():**
```typescript
swarm = new Swarm(modelManager, toolRegistry, agentDispatcher, commandExecutor, sendNotification);
```

## Error Handling

**Per-step:**
- Tool call failure → error fed back to LLM, can retry or try different approach
- Step max iterations (10) exhausted → complete with partial result
- 3+ consecutive step failures → Swarm aborts, synthesizes what it has

**Timeouts:**
- Individual tool call: 30s (existing AgentDispatcher default)
- Per step: 120s total
- Total Swarm execution: 600s (10 min)

**Cancellation:**
- `Swarm.cancel()` sets `aborted` flag
- Each executor loop iteration checks flag before continuing
- Frontend `swarmCancel` → sidecar handler → `swarm.cancel()`

## Files Modified

| File | Change |
|---|---|
| `sidecar/core/Swarm.ts` | Major: add tool execution, notifications, cancel, browser context |
| `sidecar/core/AgentCore.ts` | Moderate: replace selectRole with classifyAndRoute, multi-tool loop |
| `sidecar/main.ts` | Minor: update Swarm constructor, add swarmCancel handler, modify agentQuery routing |
| `src/agent/AgentPanel.ts` | Moderate: handle swarm notifications, cancel button |
| `src/agent/ChatView.ts` | Moderate: plan display, step progress, tool activity rendering |
| `src/agent/SidecarBridge.ts` | Minor: add swarmCancel method |
| `src/styles/agent-panel.css` | Minor: styles for plan display and progress indicators |

## Non-Goals

- Parallel step execution (steps are sequential for now)
- User editing the plan mid-execution
- Persistent task queuing across sessions
- Sub-agent model assignment per step (all steps use same model)
