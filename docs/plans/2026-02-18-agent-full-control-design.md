# Agent Full Control Design (Max Autonomy)

## Goal
Make ClawBrowser fully controllable by the embedded agent, exposing all browser and app capabilities while honoring a max-autonomy policy with a global kill switch, persistent status indicator, destructive-action confirmations, and full-detail auditing.

## Scope
- Browser: tabs, navigation, DOM automation, storage/cookies/credentials, downloads, file dialogs, clipboard.
- App: window control, devtools control.
- System: terminal and filesystem access (scoped to app sandbox + workspace by default, user-configurable).
- Exclusions: agent cannot read/modify app settings or API keys; camera/mic/geo/screen sharing remain user-only.

## Architecture
Extend the existing sidecar <-> frontend JSON-RPC/notification pattern into a unified capability router.

- Sidecar emits `agentRequest` notifications with `{ requestId, capability, action, params, destructive? }`.
- Frontend `AgentCapabilityRouter` validates policy, dispatches to subsystems, and returns `agentResult` via `sidecar.send`.
- Sidecar resolves pending requests and returns tool results to the LLM.

## Components

Sidecar (Node):
- `sidecar/core/ToolRegistry.ts`: schema + validation for multi-tool capability calls.
- `sidecar/core/AgentDispatcher.ts`: request/response dispatcher for agent requests.
- `sidecar/core/AgentCore.ts`: expanded prompt and tool parsing beyond `terminalExec`.
- `sidecar/main.ts`: register `agentResult` handler and route agent requests.

Frontend (TS):
- `src/agent/AgentCapabilityRouter.ts`: listens for `agentRequest`, enforces policy, dispatches to subsystems, returns `agentResult`.
- `src/agent/AgentActionLog.ts`: live action log + 30-day audit retention (full detail).
- `src/agent/AgentConfirm.ts` (or ChatView integration): destructive-action confirmation in chat flow.
- `src/agent/AgentStatusIndicator.ts`: persistent “Agent Control Active” indicator + kill switch.

Subsystem adapters:
- Tabs/navigation: `TabManager` hooks.
- DOM: `DomAutomationBridge`.
- Storage: cookies/localStorage/credentials adapters.
- Downloads + file dialogs: new adapters.
- Clipboard, window, devtools: new adapters.

Config + Onboarding:
- Extend `AppConfig` + `ConfigStore` with `agentControl` defaults.
- Add onboarding step in `src/onboarding/Wizard.ts` for agent control settings.

## Data Flow & Protocol

1. LLM returns a tool call (e.g., `{"tool":"tab.create","url":"https://google.com"}`).
2. Sidecar validates via ToolRegistry and sends:
   ```json
   {"jsonrpc":"2.0","method":"agentRequest","params":{"requestId":"uuid","capability":"tab","action":"create","params":{"url":"https://google.com"},"destructive":false}}
   ```
3. Frontend router checks kill switch + settings; prompts in-chat if destructive; executes action.
4. Frontend responds:
   ```json
   {"requestId":"uuid","ok":true,"data":{"tabId":"..."}}
   ```
5. Sidecar resolves and returns tool result to the LLM.

## Policy & Safety
Defaults (max autonomy):
- Enabled by default at startup.
- Auto-grant per-origin and cross-origin permissions.
- Filesystem scope default: app sandbox + workspace (user-configurable).
- Terminal + filesystem allowed.
- Cookies/localStorage/credentials allowed.
- File dialogs + downloads auto-accepted.
- Clipboard read/write allowed.
- Window + devtools control allowed.
- Camera/mic/geo/screen sharing: not auto-granted.
- Destructive actions: chat confirmation required.
- Persistent status indicator + global kill switch.
- Full-detail action log with 30-day retention.

Hard constraints:
- Agent cannot read/modify settings or API keys.
- Kill switch blocks all agent actions immediately.

## Error Handling
- All agent requests return structured errors `{ ok: false, error: { message } }`.
- Router logs failures and includes them in the action log.

## Testing
- Unit tests for tool validation and request dispatch.
- Router tests for kill switch, destructive confirmation flow, and capability denial.
- Integration test: sidecar -> frontend roundtrip for tab + DOM + clipboard.

## Rollout
- Ship behind `agentControl.enabled` default true for max autonomy.
- Document settings in onboarding and Settings screen.
- Validate audit log retention and kill switch behavior before release.
