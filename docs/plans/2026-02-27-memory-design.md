# Memory Capability Design

**Date:** 2026-02-27
**Status:** Approved

## Overview

Add persistent memory to ClawBrowser so the agent can store and recall user preferences, facts, and context across sessions. Memory intent can be explicit ("remember that I prefer X") or implicit (the agent detects a preference signal during normal conversation). The user sees acknowledgment when a memory is saved and can manage memories through a dedicated panel.

## Architecture

A `MemoryManager` class (`sidecar/memory/MemoryManager.ts`) wraps the existing `QmdMemory` (SQLite-backed BM25 + vector semantic search). It exposes:

- `store(fact: string): Promise<string>` — saves a plain-text fact, returns the generated ID
- `search(query: string, topN: number): Promise<Memory[]>` — semantic search, returns top-N matches
- `delete(id: string): Promise<void>` — removes a memory by ID
- `list(): Promise<Memory[]>` — returns all stored memories for the panel

`QmdMemory` already handles persistence at `~/.clawbrowser/workspace/memory/index.sqlite`. No new storage layer is needed.

## Agent Integration

### Memory Injection (every message)

`AgentCore.buildSystemPrompt()` is extended to:
1. Run `MemoryManager.search(userMessage, 5)` using the current user message as the semantic query
2. If results exist, append a `## What I remember about you` block to the system prompt before every LLM call
3. On search failure, log a warning and continue — no memories injected, response unblocked

### Memory Tools (ToolRegistry)

Two new tools added to `ToolRegistry`:

**`memory.store`**
```
description: "Persist a preference, fact, or piece of context about the user for future reference. Call this when the user expresses a preference, states a fact about themselves, or asks you to remember something — even implicitly."
params: { fact: string }
```

**`memory.delete`**
```
description: "Delete a previously stored memory by its ID. Use when the user corrects or retracts something."
params: { id: string }
```

When `AgentCore` handles a `memory.store` tool call:
1. Calls `MemoryManager.store(fact)`
2. On success, sends `memoryStored` notification to frontend with `{ fact, id }`
3. Continues agent loop normally

### System Prompt Block Format

```
## What I remember about you
- User prefers bullet-point responses
- User's project deadline is March 15
- User wakes up at 7am for standup
```

## Frontend

### Chat Acknowledgment (`memoryStored` notification)

`AgentPanel` listens for `memoryStored` notifications. `ChatView` renders a subtle inline chip after the agent's response turn:

```
★ Remembered: "User prefers bullet-point responses"
```

### Memory Panel (`src/agent/MemoryPanel.ts`)

A new panel toggled from the agent panel header. Displays all stored memories with timestamps. Each entry has a delete button. Calls new RPC methods:

- `listMemories` → `MemoryManager.list()` → returns `{ id, fact, createdAt }[]`
- `deleteMemory({ id })` → `MemoryManager.delete(id)`

Panel follows existing design conventions: square corners, same styling as AgentPanel.

## RPC Methods (sidecar/main.ts)

| Method | Params | Returns |
|--------|--------|---------|
| `listMemories` | — | `{ memories: Memory[] }` |
| `deleteMemory` | `{ id: string }` | `{ ok: boolean }` |

Notification (sidecar → frontend):

| Method | Payload |
|--------|---------|
| `memoryStored` | `{ fact: string, id: string }` |

## Error Handling

- `MemoryManager.store()` failure: log warning, continue response, do NOT send `memoryStored` notification
- `MemoryManager.search()` failure: log warning, proceed with no injected memories
- `memory.delete` with unknown ID: return error result to agent; agent acknowledges failure to user
- All memory errors are non-fatal — they never block the agent response

## Testing

- `MemoryManager` unit tests: store→search roundtrip, delete, list, empty-state search, search failure
- `AgentCore` system prompt test: assert `## What I remember about you` block appears with mocked `MemoryManager.search()` results; assert block absent when search returns empty
- Tool dispatch test: mock `memory.store` call → assert `memoryStored` notification fires with correct payload
- `memory.delete` test: unknown ID returns error result
- Existing `qmd-memory.test.ts` covers underlying `QmdMemory` — no changes needed

## Files to Create / Modify

**Create:**
- `sidecar/memory/MemoryManager.ts`
- `src/agent/MemoryPanel.ts`
- `tests/sidecar/memory-manager.test.ts`

**Modify:**
- `sidecar/core/AgentCore.ts` — inject memories in `buildSystemPrompt()`, handle `memory.store`/`memory.delete` tool results
- `sidecar/core/ToolRegistry.ts` — add `memory.store` and `memory.delete` tool definitions
- `sidecar/main.ts` — add `listMemories` and `deleteMemory` RPC handlers, wire `MemoryManager`
- `src/agent/AgentPanel.ts` — listen for `memoryStored`, toggle `MemoryPanel`
- `src/agent/ChatView.ts` — render `memoryStored` chip in chat
