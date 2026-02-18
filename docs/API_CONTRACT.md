# ClawBrowser API Contract

This document defines the interfaces between the three layers. Both frontend and backend teams must implement to this contract.

---

## Layer 1: Tauri IPC Commands (Frontend TS <-> Rust Backend)

The frontend calls these via `invoke()` from `@tauri-apps/api/core`.

### Tab Management

```typescript
// Create a new tab. Returns the tab UUID.
invoke('create_tab', { url: string }): Promise<string>

// Close a tab by ID.
invoke('close_tab', { tabId: string }): Promise<void>

// Switch to a tab (show it, hide others).
invoke('switch_tab', { tabId: string }): Promise<void>

// Navigate a tab to a new URL.
invoke('navigate_tab', { tabId: string, url: string }): Promise<void>

// Execute JavaScript in a tab's webview (agent DOM access only).
invoke('run_js_in_tab', { tabId: string, code: string }): Promise<string>

// Get all tabs.
invoke('list_tabs'): Promise<TabInfo[]>

// Get active tab ID.
invoke('get_active_tab'): Promise<string | null>
```

### Types

```typescript
interface TabInfo {
  id: string;
  url: string;
  title: string;
}
```

### Tauri Events (Rust -> Frontend)

```typescript
// Emitted when a content webview finishes loading
listen('tab-loaded', { tabId: string, url: string, title: string })

// Emitted when a content webview navigation changes
listen('tab-navigated', { tabId: string, url: string })

// Emitted by sidecar via Rust relay
listen('sidecar-message', { method: string, params: any })

// Emitted by content webviews when DOM automation finishes
listen('claw-dom-automation', { requestId: string, ok: boolean, results: any[], error?: any, meta?: any })
```

---

## Layer 2: Sidecar JSON-RPC (Rust <-> Node.js Sidecar via stdin/stdout)

Each message is a single JSON line terminated by newline.

### Requests (Rust -> Sidecar)

```json
{"jsonrpc":"2.0","method":"agentQuery","params":{"userQuery":"...","activeTabUrl":"...","activeTabTitle":"...","tabCount":3},"id":1}
{"jsonrpc":"2.0","method":"configureModel","params":{"provider":"openai","model":"gpt-4o","apiKey":"sk-...","primary":true},"id":2}
{"jsonrpc":"2.0","method":"tabUpdate","params":{"tabCount":3,"activeTabTitle":"Google"},"id":3}
{"jsonrpc":"2.0","method":"triggerReflection","params":{},"id":4}
{"jsonrpc":"2.0","method":"ping","params":{},"id":5}
{"jsonrpc":"2.0","method":"domAutomation","params":{"tabId":"...","actions":[{"type":"click","target":"#login"}]},"id":6}
```

### Responses (Sidecar -> Rust)

```json
{"jsonrpc":"2.0","result":{"reply":"Here's what I found..."},"id":1}
{"jsonrpc":"2.0","result":{"status":"ok"},"id":2}
{"jsonrpc":"2.0","result":{"pong":true,"uptime":12345},"id":5}
{"jsonrpc":"2.0","result":{"requestId":"...","ok":true,"results":[{"type":"click"}]},"id":6}
```

### Notifications (Sidecar -> Rust, no id = fire-and-forget)

```json
{"jsonrpc":"2.0","method":"heartbeatPulse","params":{"lastPulse":"2026-02-17T00:00:00Z","activeTabs":2,"currentContext":"browsing","pendingActions":[]}}
{"jsonrpc":"2.0","method":"agentReady","params":{"version":"0.1.0"}}
{"jsonrpc":"2.0","method":"reflectionComplete","params":{"summary":"Learned user prefers dark mode..."}}
{"jsonrpc":"2.0","method":"domAutomationRequest","params":{"requestId":"...","tabId":"...","actions":[{"type":"click","target":"#login"}]}}
```

---

## Layer 3: Frontend <-> Sidecar (via Rust relay)

The frontend sends messages to the sidecar by calling Tauri IPC commands that relay to stdin. Sidecar responses come back as Tauri events.

```typescript
// Frontend sends to sidecar
invoke('sidecar_send', { method: string, params: object }): Promise<any>

// Frontend listens for sidecar notifications
listen('sidecar-message', handler)

// Frontend returns DOM automation results to sidecar
invoke('sidecar_send', { method: 'domAutomationResult', params: { requestId: string, ok: boolean, results: any[], error?: any, meta?: any } })
```

---

## Filesystem Paths

- Workspace: `~/.clawbrowser/workspace/`
- Vault data: `~/.clawbrowser/vault.json`
- Daily logs: `~/.clawbrowser/workspace/logs/YYYY-MM-DD.md`
- qmd memory: `~/.clawbrowser/workspace/memory/`
- App config: `~/.clawbrowser/config.json`
