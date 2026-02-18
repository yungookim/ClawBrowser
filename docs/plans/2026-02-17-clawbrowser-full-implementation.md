# ClawBrowser Full Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a lightweight native AI browser using Tauri v2 with real multi-tab browsing (multi-webview), an embedded AI agent with persistent memory, nightly self-reflection, multi-model support, voice control, and encrypted local-only data storage.

**Architecture:** Three-layer design. (1) **Rust main process** (Tauri) — manages native windows, creates/destroys webview instances per tab, handles IPC, system tray, auto-update. (2) **TypeScript browser chrome** — single "chrome" webview for tab bar, URL bar, agent sidebar; communicates with Rust via Tauri commands. (3) **Node.js sidecar** — AI agent core running LangChain.js, qmd memory, cron jobs, Whisper STT; communicates with Rust process via Tauri sidecar protocol (stdin/stdout JSON-RPC).

**Tech Stack:** Tauri v2 (Rust + TypeScript), Vite, LangChain.js, LangGraph, qmd + sqlite-vec, node-cron, Web Crypto API, @xenova/transformers (Whisper), edge-tts, node-llama-cpp.

**Why Tauri v2 over Neutralinojs:** Neutralinojs cannot render real browser tabs — its single WebView per window means iframe-only content, which most sites block via X-Frame-Options/CSP. Tauri v2's multi-webview feature creates real system WebView instances (WKWebView/WebView2/WebKitGTK) per tab with zero iframe restrictions.

---

## Directory Structure

```
ClawBrowser/
├── src-tauri/                        # Rust backend (Tauri)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── src/
│   │   ├── main.rs                   # Entry point
│   │   ├── lib.rs                    # Tauri setup + plugin registration
│   │   ├── tabs.rs                   # Tab/webview lifecycle management
│   │   ├── ipc.rs                    # IPC command handlers
│   │   └── sidecar.rs                # Node.js sidecar management
│   └── icons/
├── src/                              # Frontend (browser chrome webview)
│   ├── index.html
│   ├── main.ts                       # App bootstrap
│   ├── styles/
│   │   ├── shell.css
│   │   ├── agent-panel.css
│   │   ├── onboarding.css
│   │   └── vault.css
│   ├── tabs/
│   │   ├── TabManager.ts
│   │   └── TabBar.ts
│   ├── navigation/
│   │   └── NavBar.ts
│   ├── agent/
│   │   ├── AgentPanel.ts
│   │   ├── ChatView.ts
│   │   └── SidecarBridge.ts
│   ├── vault/
│   │   ├── Vault.ts
│   │   └── VaultUI.ts
│   ├── voice/
│   │   └── VoiceInput.ts
│   └── onboarding/
│       └── Wizard.ts
├── sidecar/                          # Node.js AI agent sidecar
│   ├── package.json
│   ├── tsconfig.json
│   ├── main.ts                       # Sidecar entry (stdin/stdout JSON-RPC)
│   ├── core/
│   │   ├── AgentCore.ts
│   │   ├── ModelManager.ts
│   │   └── Swarm.ts
│   ├── memory/
│   │   ├── QmdMemory.ts
│   │   ├── WorkspaceFiles.ts
│   │   └── DailyLog.ts
│   ├── cron/
│   │   ├── Heartbeat.ts
│   │   └── Reflection.ts
│   └── voice/
│       └── WhisperSTT.ts
├── workspace-template/
│   ├── AGENTS.md
│   ├── SOUL.md
│   ├── USER.md
│   ├── IDENTITY.md
│   ├── TOOLS.md
│   ├── BOOT.md
│   ├── BOOTSTRAP.md
│   └── HEARTBEAT.md
├── tests/
│   ├── frontend/
│   └── sidecar/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── docs/
    ├── index.html
    └── plans/
```

---

## Key Architectural Decisions

### How Tabs Work (Multi-Webview)

The Tauri window contains TWO types of webviews:

1. **Chrome webview** — Fixed at top. Renders tab bar, URL bar, agent sidebar. Built with our HTML/CSS/TS from `src/`.

2. **Content webviews** — One per tab. Each is a real system WebView instance created via Tauri's `WebviewBuilder`. Positioned below chrome. Only active tab visible; others hidden (size set to 0x0).

```
+---------------------------------------------+
|  Chrome Webview (tab bar + URL bar)         |  <- Our HTML/TS
+-----------------------------------+---------+
|                                   | Agent   |
|  Content Webview (active tab)     | Sidebar |  <- Real system webview
|  e.g. google.com                  | (part   |
|                                   |  of     |
|                                   |  chrome)|
+-----------------------------------+---------+
```

The Rust process manages webview lifecycle:
- `create_tab(url)` -> creates new WebView, positions it below chrome
- `close_tab(id)` -> destroys the WebView
- `switch_tab(id)` -> hides current content webview, shows target
- `inject_js(id, code)` -> runs JS in a content webview via Tauri's webview JS evaluation API (the standard Tauri/Wry method for DOM access)
- `navigate(id, url)` -> sets URL on content webview

**Security note on JS injection:** The `webview.eval()` Tauri API is the standard mechanism for communicating with webview content (equivalent to Electron's `webContents.executeJavaScript()`). All injected code originates from the trusted agent sidecar, never from untrusted user input. The IPC handler validates that only the agent sidecar can trigger JS injection. This is the intended design for agent DOM access (form filling, content extraction, etc.).

### How the Agent Sidecar Works

Tauri v2's sidecar feature spawns the Node.js process and communicates via stdin/stdout. Messages use JSON-RPC format:

```
Chrome TS  --(Tauri IPC)-->  Rust main  --(stdin/stdout)-->  Node.js sidecar
           <--(Tauri IPC)--             <--(stdin/stdout)--
```

The sidecar is compiled to a standalone Node.js binary (using pkg or ncc) bundled with the app.

---

## Phase 0: Project Scaffolding

### Task 0.1: Initialize Tauri v2 Project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`
- Create: `src/index.html`, `src/main.ts`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`

**Step 1: Install Tauri CLI**

```bash
npm install -D @tauri-apps/cli@latest @tauri-apps/api@latest
```

**Step 2: Create src-tauri/Cargo.toml**

```toml
[package]
name = "clawbrowser"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["unstable"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
tokio = { version = "1", features = ["full"] }
url = "2"

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

Note: `features = ["unstable"]` enables multi-webview.

**Step 3: Create src-tauri/tauri.conf.json**

```json
{
  "productName": "ClawBrowser",
  "version": "0.1.0",
  "identifier": "com.clawbrowser.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev:frontend",
    "beforeBuildCommand": "npm run build:frontend"
  },
  "app": {
    "windows": [
      {
        "title": "ClawBrowser",
        "width": 1280,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "center": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["sidecar/clawbrowser-agent"]
  }
}
```

**Step 4: Create src-tauri/src/main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    clawbrowser_lib::run();
}
```

**Step 5: Create src-tauri/src/lib.rs (minimal)**

```rust
use std::sync::Mutex;
use tauri::Manager;
mod tabs;
mod ipc;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(tabs::TabState::new()))
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            println!("ClawBrowser started: {:?}", window.title());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::create_tab,
            ipc::close_tab,
            ipc::switch_tab,
            ipc::navigate_tab,
            ipc::run_js_in_tab,
            ipc::list_tabs,
            ipc::get_active_tab,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClawBrowser");
}
```

**Step 6: Create src/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ClawBrowser</title>
  <link rel="stylesheet" href="/styles/shell.css" />
</head>
<body>
  <div id="app">
    <div id="tab-bar"></div>
    <div id="nav-bar"></div>
    <div id="agent-panel"></div>
  </div>
  <script type="module" src="/main.ts"></script>
</body>
</html>
```

No content area in HTML — content tabs are separate webviews managed by Rust.

**Step 7: Create src/main.ts and vite.config.ts**

```ts
// src/main.ts
console.log('ClawBrowser chrome loaded');
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
export default defineConfig({
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari15'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

**Step 8: Verify compilation**

```bash
npm run tauri dev
```

Expected: Window opens with title "ClawBrowser".

**Step 9: Commit**

```bash
git add src-tauri/ src/ package.json tsconfig.json vite.config.ts
git commit -m "feat: scaffold Tauri v2 project with multi-webview support"
```

---

### Task 0.2: Implement Tab Management in Rust

**Files:**
- Create: `src-tauri/src/tabs.rs`
- Create: `src-tauri/src/ipc.rs`

**Step 1: Implement tabs.rs**

Core webview lifecycle manager. Creates/destroys/switches real system WebView instances. Each tab is a separate webview positioned below the chrome webview.

Key functions:
- `create_tab(app, state, url)` -> creates WebviewBuilder, positions below chrome (80px), returns UUID
- `close_tab(app, state, tab_id)` -> closes webview, activates previous tab
- `switch_tab(app, state, tab_id)` -> hides current (set size 0x0), shows target (full size)
- `navigate_tab(app, state, tab_id, url)` -> calls webview.navigate(url)
- `run_js_in_tab(app, tab_id, code)` -> calls Tauri's webview JS execution API for agent DOM access (only callable from trusted sidecar, never from untrusted input)

The state struct:
```rust
pub struct TabState {
    pub tabs: HashMap<String, TabInfo>,
    pub active_tab: Option<String>,
    pub chrome_height: f64,
}
```

**Step 2: Implement ipc.rs**

Thin command handler layer that delegates to tabs module. Each function is a `#[tauri::command]` that receives AppHandle and State, calls the corresponding tabs function.

**Step 3: Verify cargo check passes**

```bash
cd src-tauri && cargo check
```

**Step 4: Commit**

```bash
git add src-tauri/src/tabs.rs src-tauri/src/ipc.rs
git commit -m "feat: implement Rust tab manager with multi-webview lifecycle"
```

---

### Task 0.3: Create Workspace Template Files

**Files:** Create all 8 files in `workspace-template/`

Each file contains minimal markdown template headers that the agent populates over time:

- `AGENTS.md` — Primary and sub-agent config
- `SOUL.md` — Personality, tone, communication style
- `USER.md` — Facts, preferences, biographical details
- `IDENTITY.md` — Workflow patterns, role context
- `TOOLS.md` — Available tools (tab control, form fill, etc.)
- `BOOT.md` — Boot sequence checklist
- `BOOTSTRAP.md` — First-run instructions
- `HEARTBEAT.md` — Last pulse, active tabs, context, pending actions

**Commit:**

```bash
git add workspace-template/
git commit -m "feat: add workspace template files for agent memory system"
```

---

## Phase 1: Browser Chrome UI (TypeScript)

### Task 1.1: TabManager Frontend State

**Files:**
- Create: `src/tabs/TabManager.ts`
- Test: `tests/frontend/tabs.test.ts`

Frontend TabManager wraps Tauri IPC calls (`invoke('create_tab', ...)`) and maintains local tab state (url, title, history, historyIndex). Provides `onChange` listeners for UI updates. Each mutation calls the corresponding Rust command, then updates local state, then notifies listeners.

Key methods: `createTab(url)`, `closeTab(id)`, `switchTab(id)`, `navigate(url)`, `goBack()`, `goForward()`, `injectJs(tabId, code)`.

Tests mock `@tauri-apps/api/core` invoke and verify correct IPC calls are made.

**Commit:**

```bash
git add src/tabs/ tests/frontend/
git commit -m "feat: implement TabManager with Tauri IPC for real webview tab control"
```

---

### Task 1.2: TabBar UI Component

**Files:**
- Create: `src/tabs/TabBar.ts`

Renders tab strip: one `.tab` div per tab, `.active` class on current, close button, "+" new tab button. Subscribes to `TabManager.onChange`. Uses `document.createElement` for all DOM operations (no innerHTML with untrusted data — tab titles are set via `textContent` to prevent XSS).

**Commit:**

```bash
git add src/tabs/TabBar.ts
git commit -m "feat: add TabBar UI component"
```

---

### Task 1.3: NavBar Component

**Files:**
- Create: `src/navigation/NavBar.ts`

URL bar + back/forward/refresh buttons + agent toggle. URL input auto-prepends `https://` if missing, or searches Google if input looks like a search query. Agent toggle button shows/hides the agent sidebar panel.

**Commit:**

```bash
git add src/navigation/
git commit -m "feat: add NavBar with URL input and navigation controls"
```

---

### Task 1.4: Shell Styling (Dark Theme)

**Files:**
- Create: `src/styles/shell.css`

CSS custom properties for dark theme: `--bg: #1e1e2e`, `--surface: #252536`, `--accent: #7c6ff7`, etc. CSS grid layout: `grid-template-rows: 38px 42px 1fr`. Tab bar with horizontal scroll, pill-shaped tabs. Nav bar with rounded URL input. Agent panel with slide-in transition (width 0 -> 380px).

**Commit:**

```bash
git add src/styles/shell.css
git commit -m "feat: add dark-theme browser shell styling"
```

---

### Task 1.5: Wire Up main.ts Bootstrap

**Files:**
- Modify: `src/main.ts`

Instantiate TabManager, TabBar, NavBar. Create initial "New Tab" on load. Listen for Tauri window resize events and notify Rust to reposition content webviews.

**Commit:**

```bash
git add src/main.ts
git commit -m "feat: wire up browser chrome bootstrap"
```

---

## Phase 2: Node.js Sidecar

### Task 2.1: Sidecar JSON-RPC Protocol

**Files:**
- Create: `sidecar/package.json`, `sidecar/tsconfig.json`
- Create: `sidecar/main.ts`

The sidecar communicates via stdin/stdout JSON-RPC. Each message is a JSON line:

```json
{"jsonrpc":"2.0","method":"agentQuery","params":{"userQuery":"..."},"id":1}
```

Response:

```json
{"jsonrpc":"2.0","result":{"reply":"..."},"id":1}
```

The main.ts reads lines from stdin, parses JSON, routes to handler, writes response to stdout.

**Step 1: Create sidecar/package.json**

```json
{
  "name": "clawbrowser-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "bundle": "npx ncc build main.ts -o dist"
  }
}
```

**Step 2: Implement sidecar/main.ts**

Reads stdin line by line. Parses JSON-RPC. Routes methods to handlers. Writes JSON-RPC responses to stdout. Methods: `agentQuery`, `configureModel`, `tabUpdate`, `triggerReflection`, `ping`.

**Commit:**

```bash
git add sidecar/
git commit -m "feat: add Node.js sidecar with JSON-RPC stdin/stdout protocol"
```

---

### Task 2.2: Frontend SidecarBridge

**Files:**
- Create: `src/agent/SidecarBridge.ts`

Uses Tauri's shell plugin (`@tauri-apps/plugin-shell`) to spawn and communicate with the sidecar process. The `Command.sidecar()` API manages the process lifecycle. Messages are sent via stdin, responses read from stdout.

```ts
import { Command } from '@tauri-apps/plugin-shell';

export class SidecarBridge {
  private process: any;

  async start() {
    const command = Command.sidecar('sidecar/clawbrowser-agent');
    this.process = await command.spawn();
    // Listen for stdout lines
    command.stdout.on('data', (line: string) => {
      const msg = JSON.parse(line);
      this.handleResponse(msg);
    });
  }

  async send(method: string, params: unknown): Promise<unknown> {
    // Write JSON-RPC to stdin
  }
}
```

**Commit:**

```bash
git add src/agent/SidecarBridge.ts
git commit -m "feat: add SidecarBridge for Tauri shell plugin communication"
```

---

### Task 2.3: Rust Sidecar Management

**Files:**
- Create: `src-tauri/src/sidecar.rs`
- Modify: `src-tauri/src/lib.rs`

Rust module that starts the sidecar on app launch, restarts on crash, and provides IPC commands for the frontend to send messages to the sidecar. The sidecar process is managed by Tauri's shell plugin.

**Commit:**

```bash
git add src-tauri/src/sidecar.rs
git commit -m "feat: add Rust sidecar lifecycle management"
```

---

## Phase 3: Vault and Security

### Task 3.1: Web Crypto Vault

**Files:**
- Create: `src/vault/Vault.ts`
- Test: `tests/frontend/vault.test.ts`

PBKDF2 key derivation (600k iterations, SHA-256) from passphrase + random salt. AES-GCM-256 encryption. Store salt + encrypted entries as JSON via Tauri filesystem API. Auto-lock on idle timeout (configurable, default 5 min).

Key methods: `unlock(password)`, `lock()`, `encrypt(plaintext)` -> base64, `decrypt(base64)` -> plaintext, `set(key, value)`, `get(key)`, `exportEncrypted()`, `importEncrypted(data)`.

Tests verify encrypt/decrypt roundtrip, wrong-password rejection, idle auto-lock.

**Commit:**

```bash
git add src/vault/ tests/frontend/vault.test.ts
git commit -m "feat: implement AES-GCM vault with PBKDF2 key derivation"
```

---

### Task 3.2: Vault Lock Screen UI

**Files:**
- Create: `src/vault/VaultUI.ts`
- Create: `src/styles/vault.css`

Full-screen overlay with password input. Shows on app launch and after idle timeout. Centered card with ClawBrowser title, password field, unlock button, error message area. All DOM content set via `textContent` (no dynamic HTML injection).

**Commit:**

```bash
git add src/vault/VaultUI.ts src/styles/vault.css
git commit -m "feat: add vault lock screen UI"
```

---

## Phase 4: Agent Core (Sidecar)

### Task 4.1: Model Manager

**Files:**
- Create: `sidecar/core/ModelManager.ts`
- Test: `tests/sidecar/model-manager.test.ts`

Manages provider configs (openai, anthropic, groq, ollama, llamacpp). Each provider has: model name, API key (optional for local), base URL (optional). Dynamic LangChain.js adapter instantiation: `ChatOpenAI`, `ChatAnthropic`, `ChatGroq`, `ChatOllama`, `ChatLlamaCpp`. Supports primary + sub-agent model roles.

Install deps:
```bash
cd sidecar && npm install @langchain/core @langchain/openai @langchain/anthropic @langchain/groq @langchain/community
```

**Commit:**

```bash
git add sidecar/core/ModelManager.ts tests/sidecar/
git commit -m "feat: add ModelManager with dynamic LangChain.js adapters for 5 providers"
```

---

### Task 4.2: Agent Core Orchestrator

**Files:**
- Create: `sidecar/core/AgentCore.ts`

Loads workspace file content as system prompt context. Maintains conversation history (capped at 40 messages). Accepts `AgentContext` (active tab URL/title, tab count, user query, workspace files). Invokes primary model via LangChain.js.

**Commit:**

```bash
git add sidecar/core/AgentCore.ts
git commit -m "feat: add AgentCore orchestrator with workspace context"
```

---

### Task 4.3: Agent Sidebar UI

**Files:**
- Create: `src/agent/AgentPanel.ts`
- Create: `src/agent/ChatView.ts`
- Create: `src/styles/agent-panel.css`

ChatView: Message list (scrollable), text input area, send button. Messages rendered as divs with role-based styling (user = accent, agent = surface). All message content set via `textContent` for safety. AgentPanel: wraps ChatView, connects to SidecarBridge, forwards messages.

**Commit:**

```bash
git add src/agent/ src/styles/agent-panel.css
git commit -m "feat: add agent sidebar with chat UI"
```

---

## Phase 5: Memory System (Sidecar)

### Task 5.1: Workspace File Reader/Writer

**Files:**
- Create: `sidecar/memory/WorkspaceFiles.ts`
- Test: `tests/sidecar/workspace-files.test.ts`

Reads/writes markdown files in `~/.clawbrowser/workspace/`. Initializes from template on first run. Methods: `initialize()`, `read(filename)`, `write(filename, content)`, `append(filename, content)`, `listFiles()`, `loadAll()` -> Record of filename to content.

**Commit:**

```bash
git add sidecar/memory/WorkspaceFiles.ts tests/sidecar/
git commit -m "feat: add WorkspaceFiles for reading/writing agent memory"
```

---

### Task 5.2: Daily Log Manager

**Files:**
- Create: `sidecar/memory/DailyLog.ts`

Manages timestamped log files at `~/.clawbrowser/workspace/logs/YYYY-MM-DD.md`. Methods: `log(entry)`, `readToday()`, `readDate(dateStr)`, `listLogs()`. Each entry formatted as `- [HH:MM:SS] entry text`.

**Commit:**

```bash
git add sidecar/memory/DailyLog.ts
git commit -m "feat: add DailyLog for timestamped interaction logging"
```

---

### Task 5.3: qmd Semantic Memory

**Files:**
- Create: `sidecar/memory/QmdMemory.ts`

Wraps `@tobilu/qmd` for vector-indexed semantic memory. Uses `Xenova/all-MiniLM-L6-v2` for local embeddings. Methods: `initialize()`, `addDocument(id, content, metadata)`, `search(query, topK)`, `remove(id)`, `reindex()`. Stored at `~/.clawbrowser/workspace/memory/`.

Install: `cd sidecar && npm install @tobilu/qmd better-sqlite3`

**Commit:**

```bash
git add sidecar/memory/QmdMemory.ts
git commit -m "feat: add qmd semantic memory with local embeddings"
```

---

## Phase 6: Heartbeat and Nightly Reflection

### Task 6.1: Heartbeat Monitor

**Files:**
- Create: `sidecar/cron/Heartbeat.ts`

Uses node-cron to pulse every 60 seconds. Writes current state to `HEARTBEAT.md`: last pulse ISO timestamp, active tab count, current context summary, pending actions. Emits state to Rust process via stdout for frontend display.

Install: `cd sidecar && npm install node-cron`

**Commit:**

```bash
git add sidecar/cron/Heartbeat.ts
git commit -m "feat: add 60s heartbeat with HEARTBEAT.md updates"
```

---

### Task 6.2: Nightly Reflection Engine

**Files:**
- Create: `sidecar/cron/Reflection.ts`

Cron at `0 0 * * *` (midnight). Reads today's daily log, loads all workspace files, sends to primary model with a system prompt instructing it to:
1. Extract new user preferences and patterns
2. Generate updates to SOUL.md, USER.md, IDENTITY.md
3. Produce new memory entries for qmd indexing

Parses model response as JSON, applies file updates, indexes new memories, re-indexes qmd. Can also be triggered manually via IPC.

**Commit:**

```bash
git add sidecar/cron/Reflection.ts
git commit -m "feat: add nightly reflection engine"
```

---

## Phase 7: Voice Interface

### Task 7.1: Voice Input

**Files:**
- Create: `src/voice/VoiceInput.ts`
- Create: `sidecar/voice/WhisperSTT.ts`

**Frontend (VoiceInput.ts):** Uses Web Speech API (SpeechRecognition) as primary. Toggle button in nav bar. On result, sends transcribed text to agent panel.

**Sidecar (WhisperSTT.ts):** Optional higher-quality path using `@xenova/transformers` with `Xenova/whisper-large-v3` quantized model. Falls back gracefully if model can't load. Accepts Float32Array audio buffer, returns transcribed text.

Install: `cd sidecar && npm install @xenova/transformers`

**Commit:**

```bash
git add src/voice/ sidecar/voice/
git commit -m "feat: add voice input with Web Speech API and local Whisper"
```

---

## Phase 8: Onboarding Wizard

### Task 8.1: Setup Wizard

**Files:**
- Create: `src/onboarding/Wizard.ts`
- Create: `src/styles/onboarding.css`

4-step wizard:
1. **Welcome** — "Get Started" button
2. **Workspace Import** — Drag-and-drop zone for OpenClaw workspace folder, or "Start Fresh" button. Uses Tauri filesystem API to read dropped folder path.
3. **Model Setup** — Provider dropdown (openai/anthropic/groq/ollama/llamacpp), model name input, API key input (not required for local). "Add" button to add multiple providers.
4. **Passphrase** — Password + confirm fields. Min 8 chars. On submit: unlock vault, store API keys encrypted, send model configs to sidecar.
5. **Complete** — "Launch ClawBrowser" button removes overlay.

All form values handled via DOM element `.value` properties. All display text set via `textContent`. No dynamic HTML from user input.

**Commit:**

```bash
git add src/onboarding/ src/styles/onboarding.css
git commit -m "feat: add onboarding wizard with workspace import and model setup"
```

---

## Phase 9: LangGraph Swarm

### Task 9.1: Multi-Agent Swarm

**Files:**
- Create: `sidecar/core/Swarm.ts`

Uses `@langchain/langgraph` StateGraph with planner-executor pattern:
- **Planner node** (primary model): breaks task into steps
- **Executor node** (sub-agent model): carries out each step

Graph: planner -> executor -> END. Returns final result.

Install: `cd sidecar && npm install @langchain/langgraph`

**Commit:**

```bash
git add sidecar/core/Swarm.ts
git commit -m "feat: add LangGraph multi-agent swarm"
```

---

## Phase 10: Integration, Polish, and Packaging

### Task 10.1: Wire Up Sidecar main.ts

**Files:**
- Modify: `sidecar/main.ts`

Full integration: on boot, initialize WorkspaceFiles, DailyLog, QmdMemory, ContentProxy, Heartbeat, Reflection. Route JSON-RPC methods to corresponding handlers. Methods: `agentQuery`, `configureModel`, `tabUpdate`, `triggerReflection`, `ping`, `getMemory`.

**Commit:**

```bash
git add sidecar/main.ts
git commit -m "feat: integrate all agent subsystems in sidecar entry point"
```

---

### Task 10.2: Window Resize Handling

**Files:**
- Modify: `src-tauri/src/tabs.rs`

Listen for window resize events. When window resizes, reposition all content webviews to fill available space below chrome. Only the active tab's webview gets full dimensions; hidden tabs stay at 0x0.

**Commit:**

```bash
git add src-tauri/src/tabs.rs
git commit -m "feat: handle window resize for content webview repositioning"
```

---

### Task 10.3: Cross-Platform Build

**Files:**
- Create: `scripts/build.sh`
- Modify: `package.json` (scripts)

Build steps:
1. `cd sidecar && npm ci && npx ncc build main.ts -o dist` (compile sidecar to single file)
2. `npm run build:frontend` (Vite build)
3. `npm run tauri build` (Rust compile + bundle)

Package.json scripts:
```json
{
  "dev:frontend": "vite",
  "build:frontend": "vite build",
  "build:sidecar": "cd sidecar && npx ncc build main.ts -o dist",
  "tauri": "tauri",
  "dev": "tauri dev",
  "build": "npm run build:sidecar && tauri build",
  "test": "vitest run"
}
```

**Commit:**

```bash
git add scripts/ package.json
git commit -m "feat: add build scripts for cross-platform packaging"
```

---

### Task 10.4: Auto-Update

**Files:**
- Modify: `src-tauri/tauri.conf.json` (add updater config)

Tauri v2 has a built-in updater plugin. Configure endpoint pointing to GitHub releases. On app start, check for updates and prompt user.

**Commit:**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: configure Tauri auto-updater"
```

---

## Dependency Graph

```
Phase 0 (Scaffolding: Tauri + Rust tabs + workspace)
  |
  +-> Phase 1 (Browser Chrome UI: TabManager, TabBar, NavBar, CSS)
  |     |
  |     +-> Phase 2 (Sidecar: JSON-RPC, SidecarBridge, Rust management)
  |           |
  |           +-> Phase 3 (Vault: Web Crypto, lock screen)
  |           +-> Phase 4 (Agent Core: ModelManager, AgentCore, sidebar UI)
  |           |     |
  |           |     +-> Phase 5 (Memory: WorkspaceFiles, DailyLog, qmd)
  |           |     |     |
  |           |     |     +-> Phase 6 (Cron: Heartbeat, Reflection)
  |           |     |
  |           |     +-> Phase 9 (Swarm: LangGraph) [parallel with Phase 5]
  |           |
  |           +-> Phase 7 (Voice: Web Speech, Whisper)
  |           +-> Phase 8 (Onboarding: Wizard)
  |
  +-> Phase 10 (Integration, build, auto-update) [depends on all]
```

## Summary

| Phase | Tasks | Key Deliverables |
|-------|-------|-----------------|
| 0 | 3 | Tauri v2 scaffold, Rust tab manager, workspace templates |
| 1 | 5 | TabManager, TabBar, NavBar, shell CSS, main.ts bootstrap |
| 2 | 3 | Sidecar JSON-RPC, SidecarBridge, Rust sidecar management |
| 3 | 2 | AES-GCM vault, lock screen UI |
| 4 | 3 | ModelManager, AgentCore, agent sidebar chat UI |
| 5 | 3 | WorkspaceFiles, DailyLog, qmd semantic memory |
| 6 | 2 | 60s heartbeat, nightly reflection engine |
| 7 | 1 | Voice input (Web Speech + Whisper) |
| 8 | 1 | Onboarding wizard |
| 9 | 1 | LangGraph multi-agent swarm |
| 10 | 4 | Full integration, resize handling, build scripts, auto-update |
| **Total** | **28 tasks** | |
