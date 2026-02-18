# Agent Full Control Implementation Plan

**Goal:** Deliver full app control for the embedded agent using the capability-router approach, with max autonomy defaults, kill switch, destructive chat confirmation, full-detail audit log, and onboarding configuration.

## Task 1: Define Agent Control Settings

**Files:**
- Modify: `src/agent/types.ts` (or create if missing)
- Modify: `sidecar/core/ConfigStore.ts`
- Modify: `src/agent/SidecarBridge.ts`
- Modify: `src/onboarding/Wizard.ts`
- Modify: `src/settings/*` (settings UI)

**Steps:**
1. Extend `AppConfig` with `agentControl` settings for autonomy, kill switch, filesystem scope, terminal/FS allow, cookies/storage, clipboard, window/devtools, downloads, file dialogs, destructive confirmation, log retention.
2. Wire config load/save in sidecar and frontend bridge.
3. Add onboarding step to capture defaults.
4. Add settings UI to edit the same fields.

**Acceptance:**
- Config persists and loads correctly.
- Onboarding step writes the settings.
- Settings UI can update the same fields.

## Task 2: Sidecar Tool Registry + Dispatcher

**Files:**
- Create: `sidecar/core/ToolRegistry.ts`
- Create: `sidecar/core/AgentDispatcher.ts`
- Modify: `sidecar/core/AgentCore.ts`
- Modify: `sidecar/main.ts`

**Steps:**
1. Define tool schema for all capabilities (tab, nav, dom, storage, downloads, clipboard, window, devtools, filesystem, terminal).
2. Parse tool calls from LLM responses and validate against schema.
3. Send `agentRequest` notifications with `requestId` and await `agentResult`.
4. Handle `agentResult` in sidecar and resolve pending requests.

**Acceptance:**
- Tool calls route correctly and return results.
- Invalid tool payloads are rejected with structured errors.

## Task 3: Frontend Agent Capability Router

**Files:**
- Create: `src/agent/AgentCapabilityRouter.ts`
- Modify: `src/agent/AgentPanel.ts`
- Modify: `src/agent/SidecarBridge.ts`

**Steps:**
1. Listen for `agentRequest` notifications and dispatch to handlers.
2. Enforce kill switch and `agentControl.enabled`.
3. Trigger chat confirmation for destructive actions.
4. Send `agentResult` to sidecar.

**Acceptance:**
- Router blocks when disabled or kill switch is active.
- Destructive actions require explicit chat confirmation.

## Task 4: Capability Handlers

**Files:**
- Modify: `src/tabs/TabManager.ts`
- Modify: `src/automation/DomAutomationBridge.ts`
- Create: `src/agent/handlers/*`
- Modify: `src-tauri/src/*` (as needed for new IPC commands)

**Steps:**
1. Tabs and navigation: create/switch/close/navigate/list/getActive.
2. DOM automation: reuse existing bridge.
3. Storage/cookies/credentials: add IPC commands and handlers.
4. Downloads and file dialogs: add IPC commands and handlers.
5. Clipboard read/write: add IPC commands and handlers.
6. Window and devtools control: add IPC commands and handlers.
7. Filesystem read/write: scoped to app sandbox + workspace by default.

**Acceptance:**
- Each capability is reachable via tool call.
- Filesystem scope enforcement matches config.
- Camera/mic/geo/screen sharing are not auto-granted.

## Task 5: UI Safety + Logging

**Files:**
- Create: `src/agent/AgentStatusIndicator.ts`
- Create: `src/agent/AgentActionLog.ts`
- Modify: `src/agent/ChatView.ts`

**Steps:**
1. Add persistent “Agent Control Active” indicator + kill switch.
2. Implement full-detail live action feed.
3. Persist audit log with 30-day retention.

**Acceptance:**
- Indicator and kill switch always visible while enabled.
- Action log records all agent actions with full detail.
- Retention policy enforced.

## Task 6: API Contract Updates

**Files:**
- Modify: `docs/API_CONTRACT.md`

**Steps:**
1. Document `agentRequest` and `agentResult` payloads.
2. Enumerate capability/action mapping.

**Acceptance:**
- Contract covers all exposed capabilities.

## Task 7: Tests

**Files:**
- Create/Modify: `sidecar/*/*.test.ts`
- Create/Modify: `src/agent/*.test.ts`

**Steps:**
1. Unit tests for tool parsing and dispatcher.
2. Router tests for kill switch and destructive confirmation.
3. Integration test for a full roundtrip (e.g., open tab + navigate + clipboard write).

**Acceptance:**
- Tests pass and cover critical control paths.

---

If approved, proceed to implement task-by-task with small commits.
