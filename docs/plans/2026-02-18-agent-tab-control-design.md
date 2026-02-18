# Agent Tab Control Wiring Design

## Problem

The sidecar agent process can perform DOM automation via the existing notification pipeline, but has no path to create, close, switch, navigate, or query tabs. Tab control is currently only invoked by UI/shortcuts.

## Approach

**Notification-based (mirrors DOM automation pattern).** The sidecar sends JSON-RPC notifications, the frontend handles them via TabManager, and sends results back through the existing sidecar relay.

```
Sidecar (Node.js)                    Frontend (TS)
┌─────────────┐                      ┌──────────────────┐
│ TabControl   │──notification──────>│ SidecarTabRouter   │
│              │  "tabRequest"        │                    │
│  pending map │                      │  listens for       │
│  await result│<──JSON-RPC send─────│  "tabRequest"       │
│              │  "tabResult"         │  calls TabManager   │
└─────────────┘                      │  sends "tabResult"  │
                                     └──────────────────┘
```

## New Files

### `sidecar/tabs/TabControl.ts`
- Analogous to `sidecar/dom/DomAutomation.ts`
- Methods: `createTab(url)`, `closeTab(tabId)`, `switchTab(tabId)`, `navigateTab(tabId, url)`, `listTabs()`, `getActiveTab()`
- Each generates a requestId, sends `tabRequest` notification, returns a promise
- Internal pending map + timeout (30s default)
- `handleResult(result)` called when frontend responds

### `src/automation/SidecarTabRouter.ts`
- Analogous to `src/automation/SidecarAutomationRouter.ts`
- Listens for `tabRequest` notifications from sidecar
- Dispatches by `action` field to TabManager
- Sends result back via `sidecar.send('tabResult', ...)`

## Modified Files

### `sidecar/main.ts`
- Import and instantiate `TabControl`
- Register `tabResult` handler
- Wire tab methods for agent tool use

### `src/main.ts`
- Import `SidecarTabRouter`, instantiate, call `start()`

### `src/tabs/TabManager.ts`
- Add `getTabById(id)` method
- Add `navigateTab(tabId, url)` for navigating a specific tab

### `sidecar/core/AgentCore.ts`
- Extend system prompt with tab tool descriptions
- Add tool parsing for tab actions
- Wire `invokeWithTools` to dispatch to `TabControl`

### `docs/API_CONTRACT.md`
- Document `tabRequest` notification and `tabResult` response formats

## Protocol

### Notification (sidecar -> frontend)
```json
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"create","url":"https://example.com"}}
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"close","tabId":"abc"}}
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"switch","tabId":"abc"}}
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"navigate","tabId":"abc","url":"https://..."}}
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"list"}}
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"getActive"}}
```

### Response (frontend -> sidecar)
```json
{"action":"create","requestId":"uuid","ok":true,"data":{"tabId":"new-uuid"}}
{"action":"list","requestId":"uuid","ok":true,"data":{"tabs":[{"id":"...","url":"...","title":"..."}]}}
{"action":"getActive","requestId":"uuid","ok":true,"data":{"tabId":"abc","url":"...","title":"..."}}
{"action":"close","requestId":"uuid","ok":false,"error":{"message":"Tab not found"}}
```

## No Rust Changes

All communication flows through the existing `sidecar-message` event and `sidecar.send()` relay.
