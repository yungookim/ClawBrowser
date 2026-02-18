# Agent Tab Control Wiring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the sidecar agent to create, close, switch, navigate, and query browser tabs via the existing JSON-RPC notification pipeline.

**Architecture:** The sidecar sends `tabRequest` notifications (fire-and-forget JSON-RPC with no `id`). The frontend `SidecarTabRouter` listens, dispatches to `TabManager`, and returns results via `sidecar.send('tabResult', ...)`. The sidecar `TabControl` class awaits results using a pending map + timeout pattern identical to `DomAutomation`. AgentCore parses tool-use JSON from LLM responses and dispatches to `TabControl`.

**Tech Stack:** TypeScript (both sides), Vitest for testing, JSON-RPC 2.0 over stdin/stdout

---

### Task 1: Add `getTabById` and `navigateTab` to TabManager

These methods are needed by the frontend router (and `getTabById` is already called by `DomAutomationBridge` without being defined).

**Files:**
- Modify: `src/tabs/TabManager.ts`
- Test: `src/tabs/TabManager.test.ts`

**Step 1: Write tests**

Create `src/tabs/TabManager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { TabManager } from './TabManager';
import { invoke } from '@tauri-apps/api/core';

const mockedInvoke = vi.mocked(invoke);

describe('TabManager', () => {
  let manager: TabManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    manager = new TabManager();
    await manager.init();
  });

  describe('getTabById', () => {
    it('returns undefined when no tabs exist', () => {
      expect(manager.getTabById('nonexistent')).toBeUndefined();
    });

    it('returns the tab after creating one', async () => {
      mockedInvoke.mockResolvedValueOnce('tab-1');
      await manager.createTab('https://example.com');

      const tab = manager.getTabById('tab-1');
      expect(tab).toBeDefined();
      expect(tab!.id).toBe('tab-1');
      expect(tab!.url).toBe('https://example.com');
    });
  });

  describe('navigateTab', () => {
    it('navigates a specific tab by id', async () => {
      mockedInvoke.mockResolvedValueOnce('tab-1');
      await manager.createTab('https://example.com');

      mockedInvoke.mockResolvedValueOnce(undefined);
      await manager.navigateTab('tab-1', 'https://new.com');

      expect(mockedInvoke).toHaveBeenCalledWith('navigate_tab', {
        tabId: 'tab-1',
        url: 'https://new.com',
      });
      const tab = manager.getTabById('tab-1');
      expect(tab!.url).toBe('https://new.com');
    });

    it('throws when tab does not exist', async () => {
      await expect(manager.navigateTab('no-such', 'https://x.com'))
        .rejects.toThrow('Tab no-such not found');
    });

    it('resolves bare domains with https', async () => {
      mockedInvoke.mockResolvedValueOnce('tab-1');
      await manager.createTab('about:blank');

      mockedInvoke.mockResolvedValueOnce(undefined);
      await manager.navigateTab('tab-1', 'example.com');

      expect(mockedInvoke).toHaveBeenCalledWith('navigate_tab', {
        tabId: 'tab-1',
        url: 'https://example.com',
      });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tabs/TabManager.test.ts`
Expected: FAIL — `getTabById` and `navigateTab` are not defined on TabManager

**Step 3: Implement `getTabById` and `navigateTab`**

In `src/tabs/TabManager.ts`, add after `getActiveTab()` method (around line 76):

```typescript
  getTabById(id: string): Tab | undefined {
    return this.tabs.get(id);
  }
```

Add after `goForward()` method (around line 151):

```typescript
  async navigateTab(tabId: string, url: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} not found`);

    const resolved = this.resolveUrl(url);
    await invoke('navigate_tab', { tabId, url: resolved });
    tab.url = resolved;

    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(resolved);
    tab.historyIndex = tab.history.length - 1;

    this.notify();
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tabs/TabManager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tabs/TabManager.ts src/tabs/TabManager.test.ts
git commit -m "feat: add getTabById and navigateTab to TabManager"
```

---

### Task 2: Create sidecar `TabControl`

The sidecar-side class that sends tab requests and awaits results. Mirrors `sidecar/dom/DomAutomation.ts`.

**Files:**
- Create: `sidecar/tabs/TabControl.ts`
- Test: `sidecar/tabs/TabControl.test.ts`

**Step 1: Write tests**

Create `sidecar/tabs/TabControl.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabControl } from './TabControl';

describe('TabControl', () => {
  let notify: ReturnType<typeof vi.fn>;
  let tabControl: TabControl;

  beforeEach(() => {
    notify = vi.fn();
    tabControl = new TabControl(notify);
  });

  it('sends a tabRequest notification for createTab', async () => {
    const promise = tabControl.createTab('https://example.com');

    expect(notify).toHaveBeenCalledOnce();
    const [method, params] = notify.mock.calls[0];
    expect(method).toBe('tabRequest');
    expect(params.action).toBe('create');
    expect(params.url).toBe('https://example.com');
    expect(params.requestId).toBeDefined();

    // Simulate frontend response
    tabControl.handleResult({
      requestId: params.requestId,
      action: 'create',
      ok: true,
      data: { tabId: 'new-tab-1' },
    });

    const result = await promise;
    expect(result).toEqual({ tabId: 'new-tab-1' });
  });

  it('sends a tabRequest notification for closeTab', async () => {
    const promise = tabControl.closeTab('tab-1');

    const [, params] = notify.mock.calls[0];
    expect(params.action).toBe('close');
    expect(params.tabId).toBe('tab-1');

    tabControl.handleResult({
      requestId: params.requestId,
      action: 'close',
      ok: true,
      data: {},
    });

    await promise;
  });

  it('sends a tabRequest notification for switchTab', async () => {
    const promise = tabControl.switchTab('tab-2');

    const [, params] = notify.mock.calls[0];
    expect(params.action).toBe('switch');
    expect(params.tabId).toBe('tab-2');

    tabControl.handleResult({
      requestId: params.requestId,
      action: 'switch',
      ok: true,
      data: {},
    });

    await promise;
  });

  it('sends a tabRequest notification for navigateTab', async () => {
    const promise = tabControl.navigateTab('tab-1', 'https://new.com');

    const [, params] = notify.mock.calls[0];
    expect(params.action).toBe('navigate');
    expect(params.tabId).toBe('tab-1');
    expect(params.url).toBe('https://new.com');

    tabControl.handleResult({
      requestId: params.requestId,
      action: 'navigate',
      ok: true,
      data: {},
    });

    await promise;
  });

  it('sends a tabRequest notification for listTabs', async () => {
    const tabs = [{ id: 'tab-1', url: 'https://a.com', title: 'A' }];
    const promise = tabControl.listTabs();

    const [, params] = notify.mock.calls[0];
    expect(params.action).toBe('list');

    tabControl.handleResult({
      requestId: params.requestId,
      action: 'list',
      ok: true,
      data: { tabs },
    });

    const result = await promise;
    expect(result).toEqual({ tabs });
  });

  it('sends a tabRequest notification for getActiveTab', async () => {
    const promise = tabControl.getActiveTab();

    const [, params] = notify.mock.calls[0];
    expect(params.action).toBe('getActive');

    tabControl.handleResult({
      requestId: params.requestId,
      action: 'getActive',
      ok: true,
      data: { tabId: 'tab-1', url: 'https://a.com', title: 'A' },
    });

    const result = await promise;
    expect(result).toEqual({ tabId: 'tab-1', url: 'https://a.com', title: 'A' });
  });

  it('rejects on error result', async () => {
    const promise = tabControl.createTab('https://bad.com');

    const [, params] = notify.mock.calls[0];
    tabControl.handleResult({
      requestId: params.requestId,
      action: 'create',
      ok: false,
      error: { message: 'URL blocked' },
    });

    await expect(promise).rejects.toThrow('URL blocked');
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    const promise = tabControl.createTab('https://slow.com');

    vi.advanceTimersByTime(30_001);

    await expect(promise).rejects.toThrow('timeout');
    vi.useRealTimers();
  });

  it('ignores results with unknown requestId', () => {
    // Should not throw
    tabControl.handleResult({
      requestId: 'unknown-id',
      action: 'create',
      ok: true,
      data: {},
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run sidecar/tabs/TabControl.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `TabControl`**

Create `sidecar/tabs/TabControl.ts`:

```typescript
import { randomUUID } from 'node:crypto';

export interface TabRequestParams {
  requestId: string;
  action: string;
  tabId?: string;
  url?: string;
}

export interface TabResult {
  requestId: string;
  action: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { message: string };
}

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timeoutId: NodeJS.Timeout;
};

type Notify = (method: string, params?: Record<string, unknown>) => void;

export class TabControl {
  private pending = new Map<string, Pending>();
  private notify: Notify;
  private timeoutMs: number;

  constructor(notify: Notify, timeoutMs = 30_000) {
    this.notify = notify;
    this.timeoutMs = timeoutMs;
  }

  async createTab(url: string): Promise<Record<string, unknown>> {
    return this.request({ action: 'create', url });
  }

  async closeTab(tabId: string): Promise<Record<string, unknown>> {
    return this.request({ action: 'close', tabId });
  }

  async switchTab(tabId: string): Promise<Record<string, unknown>> {
    return this.request({ action: 'switch', tabId });
  }

  async navigateTab(tabId: string, url: string): Promise<Record<string, unknown>> {
    return this.request({ action: 'navigate', tabId, url });
  }

  async listTabs(): Promise<Record<string, unknown>> {
    return this.request({ action: 'list' });
  }

  async getActiveTab(): Promise<Record<string, unknown>> {
    return this.request({ action: 'getActive' });
  }

  handleResult(result: TabResult): void {
    if (!result || !result.requestId) return;
    const pending = this.pending.get(result.requestId);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pending.delete(result.requestId);

    if (result.ok) {
      pending.resolve(result.data || {});
    } else {
      pending.reject(new Error(result.error?.message || 'Tab action failed'));
    }
  }

  private request(params: Omit<TabRequestParams, 'requestId'>): Promise<Record<string, unknown>> {
    const requestId = randomUUID();

    this.notify('tabRequest', { requestId, ...params } as Record<string, unknown>);

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Tab request timeout (${params.action})`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeoutId });
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run sidecar/tabs/TabControl.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add sidecar/tabs/TabControl.ts sidecar/tabs/TabControl.test.ts
git commit -m "feat: add TabControl class for sidecar tab requests"
```

---

### Task 3: Create frontend `SidecarTabRouter`

The frontend handler that listens for `tabRequest` notifications and dispatches to `TabManager`.

**Files:**
- Create: `src/automation/SidecarTabRouter.ts`
- Test: `src/automation/SidecarTabRouter.test.ts`

**Step 1: Write tests**

Create `src/automation/SidecarTabRouter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SidecarTabRouter } from './SidecarTabRouter';

// Minimal mocks
const mockSidecar = {
  onNotification: vi.fn(),
  send: vi.fn().mockResolvedValue(undefined),
};

const mockTabManager = {
  createTab: vi.fn(),
  closeTab: vi.fn(),
  switchTab: vi.fn(),
  navigateTab: vi.fn(),
  getTabs: vi.fn(),
  getActiveTabId: vi.fn(),
  getTabById: vi.fn(),
};

describe('SidecarTabRouter', () => {
  let router: SidecarTabRouter;
  let notificationHandler: (method: string, params: Record<string, unknown>) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new SidecarTabRouter(mockSidecar as any, mockTabManager as any);
    router.start();

    // Capture the notification handler registered with sidecar
    notificationHandler = mockSidecar.onNotification.mock.calls[0][0];
  });

  it('ignores non-tabRequest notifications', () => {
    notificationHandler('somethingElse', {});
    expect(mockSidecar.send).not.toHaveBeenCalled();
  });

  it('handles create action', async () => {
    mockTabManager.createTab.mockResolvedValue('new-tab-id');

    await notificationHandler('tabRequest', {
      requestId: 'req-1',
      action: 'create',
      url: 'https://example.com',
    });

    // Wait for async dispatch
    await vi.waitFor(() => {
      expect(mockSidecar.send).toHaveBeenCalledWith('tabResult', {
        requestId: 'req-1',
        action: 'create',
        ok: true,
        data: { tabId: 'new-tab-id' },
      });
    });
  });

  it('handles close action', async () => {
    mockTabManager.closeTab.mockResolvedValue(undefined);

    await notificationHandler('tabRequest', {
      requestId: 'req-2',
      action: 'close',
      tabId: 'tab-1',
    });

    await vi.waitFor(() => {
      expect(mockSidecar.send).toHaveBeenCalledWith('tabResult', {
        requestId: 'req-2',
        action: 'close',
        ok: true,
        data: {},
      });
    });
  });

  it('handles switch action', async () => {
    mockTabManager.switchTab.mockResolvedValue(undefined);

    await notificationHandler('tabRequest', {
      requestId: 'req-3',
      action: 'switch',
      tabId: 'tab-2',
    });

    await vi.waitFor(() => {
      expect(mockSidecar.send).toHaveBeenCalledWith('tabResult', {
        requestId: 'req-3',
        action: 'switch',
        ok: true,
        data: {},
      });
    });
  });

  it('handles navigate action', async () => {
    mockTabManager.navigateTab.mockResolvedValue(undefined);

    await notificationHandler('tabRequest', {
      requestId: 'req-4',
      action: 'navigate',
      tabId: 'tab-1',
      url: 'https://new.com',
    });

    await vi.waitFor(() => {
      expect(mockSidecar.send).toHaveBeenCalledWith('tabResult', {
        requestId: 'req-4',
        action: 'navigate',
        ok: true,
        data: {},
      });
    });
  });

  it('handles list action', async () => {
    const tabs = [{ id: 't1', url: 'https://a.com', title: 'A', history: [], historyIndex: 0 }];
    mockTabManager.getTabs.mockReturnValue(tabs);

    await notificationHandler('tabRequest', {
      requestId: 'req-5',
      action: 'list',
    });

    await vi.waitFor(() => {
      expect(mockSidecar.send).toHaveBeenCalledWith('tabResult', {
        requestId: 'req-5',
        action: 'list',
        ok: true,
        data: { tabs: [{ id: 't1', url: 'https://a.com', title: 'A' }] },
      });
    });
  });

  it('handles getActive action', async () => {
    mockTabManager.getActiveTabId.mockReturnValue('tab-1');
    mockTabManager.getTabById.mockReturnValue({
      id: 'tab-1', url: 'https://a.com', title: 'A', history: [], historyIndex: 0,
    });

    await notificationHandler('tabRequest', {
      requestId: 'req-6',
      action: 'getActive',
    });

    await vi.waitFor(() => {
      expect(mockSidecar.send).toHaveBeenCalledWith('tabResult', {
        requestId: 'req-6',
        action: 'getActive',
        ok: true,
        data: { tabId: 'tab-1', url: 'https://a.com', title: 'A' },
      });
    });
  });

  it('returns error for unknown action', async () => {
    await notificationHandler('tabRequest', {
      requestId: 'req-7',
      action: 'unknown',
    });

    await vi.waitFor(() => {
      expect(mockSidecar.send).toHaveBeenCalledWith('tabResult', {
        requestId: 'req-7',
        action: 'unknown',
        ok: false,
        error: { message: 'Unknown tab action: unknown' },
      });
    });
  });

  it('returns error when TabManager throws', async () => {
    mockTabManager.createTab.mockRejectedValue(new Error('URL blocked'));

    await notificationHandler('tabRequest', {
      requestId: 'req-8',
      action: 'create',
      url: 'https://bad.com',
    });

    await vi.waitFor(() => {
      expect(mockSidecar.send).toHaveBeenCalledWith('tabResult', {
        requestId: 'req-8',
        action: 'create',
        ok: false,
        error: { message: 'URL blocked' },
      });
    });
  });

  it('does not register twice', () => {
    router.start();
    expect(mockSidecar.onNotification).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/automation/SidecarTabRouter.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `SidecarTabRouter`**

Create `src/automation/SidecarTabRouter.ts`:

```typescript
import type { SidecarBridge } from '../agent/SidecarBridge';
import type { TabManager } from '../tabs/TabManager';

interface TabRequestParams {
  requestId: string;
  action: string;
  tabId?: string;
  url?: string;
}

interface TabResultPayload {
  requestId: string;
  action: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { message: string };
}

export class SidecarTabRouter {
  private sidecar: SidecarBridge;
  private tabManager: TabManager;
  private started = false;

  constructor(sidecar: SidecarBridge, tabManager: TabManager) {
    this.sidecar = sidecar;
    this.tabManager = tabManager;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.sidecar.onNotification((method, params) => {
      if (method !== 'tabRequest') return;
      this.handleRequest(params as unknown as TabRequestParams).catch((err) => {
        console.error('Tab request handler error:', err);
      });
    });
  }

  private async handleRequest(params: TabRequestParams): Promise<void> {
    if (!params || !params.requestId) return;

    const { requestId, action } = params;
    let result: TabResultPayload;

    try {
      const data = await this.dispatch(params);
      result = { requestId, action, ok: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { requestId, action, ok: false, error: { message } };
    }

    try {
      await this.sidecar.send('tabResult', result);
    } catch (err) {
      console.warn('Failed to send tabResult to sidecar:', err);
    }
  }

  private async dispatch(params: TabRequestParams): Promise<Record<string, unknown>> {
    switch (params.action) {
      case 'create': {
        const tabId = await this.tabManager.createTab(params.url || 'about:blank');
        return { tabId };
      }
      case 'close': {
        await this.tabManager.closeTab(params.tabId!);
        return {};
      }
      case 'switch': {
        await this.tabManager.switchTab(params.tabId!);
        return {};
      }
      case 'navigate': {
        await this.tabManager.navigateTab(params.tabId!, params.url!);
        return {};
      }
      case 'list': {
        const tabs = this.tabManager.getTabs().map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
        }));
        return { tabs };
      }
      case 'getActive': {
        const activeId = this.tabManager.getActiveTabId();
        if (!activeId) return { tabId: null };
        const tab = this.tabManager.getTabById(activeId);
        return {
          tabId: activeId,
          url: tab?.url || '',
          title: tab?.title || '',
        };
      }
      default:
        throw new Error(`Unknown tab action: ${params.action}`);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/automation/SidecarTabRouter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/automation/SidecarTabRouter.ts src/automation/SidecarTabRouter.test.ts
git commit -m "feat: add SidecarTabRouter for agent-initiated tab control"
```

---

### Task 4: Wire `TabControl` into sidecar `main.ts`

Register the `tabResult` handler and instantiate `TabControl` so the agent can use it.

**Files:**
- Modify: `sidecar/main.ts`

**Step 1: Add imports**

At top of `sidecar/main.ts`, add after the `CommandExecutor` import:

```typescript
import { TabControl } from './tabs/TabControl.js';
```

**Step 2: Add module-level variable**

After the `let commandExecutor: CommandExecutor;` line, add:

```typescript
let tabControl: TabControl;
```

**Step 3: Instantiate in `registerHandlers()`**

Inside `registerHandlers()`, after the `domAutomation` initialization block (line ~193), add:

```typescript
  if (!tabControl) {
    tabControl = new TabControl(sendNotification);
  }
```

**Step 4: Register `tabResult` handler**

Inside `registerHandlers()`, after the `domAutomationResult` handler, add:

```typescript
  handlers.set('tabResult', async (params) => {
    tabControl.handleResult(params as {
      requestId: string;
      action: string;
      ok: boolean;
      data?: Record<string, unknown>;
      error?: { message: string };
    });
    return { status: 'ok' };
  });
```

**Step 5: Build to verify**

Run: `cd sidecar && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add sidecar/main.ts
git commit -m "feat: wire TabControl into sidecar main"
```

---

### Task 5: Wire `SidecarTabRouter` into frontend `main.ts`

**Files:**
- Modify: `src/main.ts`

**Step 1: Add import**

After the `SidecarAutomationRouter` import, add:

```typescript
import { SidecarTabRouter } from './automation/SidecarTabRouter';
```

**Step 2: Instantiate and start**

After the `domAutomationRouter.start();` line (~164), add:

```typescript
  const tabRouter = new SidecarTabRouter(sidecar, tabManager);
  tabRouter.start();
```

**Step 3: Build to verify**

Run: `npx vite build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire SidecarTabRouter into frontend bootstrap"
```

---

### Task 6: Add tab tools to AgentCore

Extend the agent's tool system so the LLM can invoke tab actions.

**Files:**
- Modify: `sidecar/core/AgentCore.ts`

**Step 1: Add `TabControl` to constructor**

Update the constructor to accept and store a `TabControl` instance:

```typescript
import type { TabControl } from '../tabs/TabControl.js';
```

Change the class fields and constructor:

```typescript
  private tabControl: TabControl | null;

  constructor(modelManager: ModelManager, commandExecutor?: CommandExecutor, tabControl?: TabControl) {
    this.modelManager = modelManager;
    this.commandExecutor = commandExecutor || null;
    this.tabControl = tabControl || null;
  }
```

**Step 2: Update system prompt**

In `buildSystemPrompt()`, after the `terminalExec` tool instructions, add:

```typescript
    parts.push('To control browser tabs, respond ONLY with JSON:');
    parts.push('{"tool":"tabCreate","url":"https://example.com"}');
    parts.push('{"tool":"tabClose","tabId":"<tab-id>"}');
    parts.push('{"tool":"tabSwitch","tabId":"<tab-id>"}');
    parts.push('{"tool":"tabNavigate","tabId":"<tab-id>","url":"https://example.com"}');
    parts.push('{"tool":"tabList"}');
    parts.push('{"tool":"tabGetActive"}');
```

**Step 3: Update `parseToolCall` to handle tab tools**

Replace `parseToolCall` with a more general version:

```typescript
  private parseToolCall(content: string): { tool: string; [key: string]: unknown } | null {
    const parsed = this.safeJsonParse(content);
    if (!parsed || typeof parsed.tool !== 'string') return null;
    return parsed as { tool: string; [key: string]: unknown };
  }
```

**Step 4: Update `invokeWithTools` to dispatch tab tools**

Replace the existing `invokeWithTools` method:

```typescript
  private async invokeWithTools(
    model: ReturnType<ModelManager['createModel']>,
    messages: BaseMessage[],
  ): Promise<string> {
    const response = await model.invoke(messages);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const toolCall = this.parseToolCall(content);
    if (!toolCall) {
      return content;
    }

    let toolResult: Record<string, unknown>;
    try {
      toolResult = await this.executeTool(toolCall);
    } catch (err) {
      toolResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const followUp = await model.invoke([
      ...messages,
      new AIMessage(content),
      new SystemMessage('Tool result (do not call tools again):'),
      new HumanMessage(JSON.stringify(toolResult)),
    ]);

    return typeof followUp.content === 'string'
      ? followUp.content
      : JSON.stringify(followUp.content);
  }

  private async executeTool(toolCall: { tool: string; [key: string]: unknown }): Promise<Record<string, unknown>> {
    switch (toolCall.tool) {
      case 'terminalExec': {
        if (!this.commandExecutor) throw new Error('Tool execution unavailable');
        const command = toolCall.command as string;
        const args = Array.isArray(toolCall.args) ? toolCall.args.map((a: unknown) => String(a)) : [];
        const cwd = typeof toolCall.cwd === 'string' ? toolCall.cwd : undefined;
        if (!command) throw new Error('Command is required');
        const result = await this.commandExecutor.execute(command, args, cwd);
        return { ok: result.exitCode === 0, ...result };
      }
      case 'tabCreate': {
        if (!this.tabControl) throw new Error('Tab control unavailable');
        return { ok: true, ...(await this.tabControl.createTab(toolCall.url as string || 'about:blank')) };
      }
      case 'tabClose': {
        if (!this.tabControl) throw new Error('Tab control unavailable');
        await this.tabControl.closeTab(toolCall.tabId as string);
        return { ok: true };
      }
      case 'tabSwitch': {
        if (!this.tabControl) throw new Error('Tab control unavailable');
        await this.tabControl.switchTab(toolCall.tabId as string);
        return { ok: true };
      }
      case 'tabNavigate': {
        if (!this.tabControl) throw new Error('Tab control unavailable');
        await this.tabControl.navigateTab(toolCall.tabId as string, toolCall.url as string);
        return { ok: true };
      }
      case 'tabList': {
        if (!this.tabControl) throw new Error('Tab control unavailable');
        return { ok: true, ...(await this.tabControl.listTabs()) };
      }
      case 'tabGetActive': {
        if (!this.tabControl) throw new Error('Tab control unavailable');
        return { ok: true, ...(await this.tabControl.getActiveTab()) };
      }
      default:
        throw new Error(`Unknown tool: ${toolCall.tool}`);
    }
  }
```

**Step 5: Update `sidecar/main.ts` to pass `tabControl` to `AgentCore`**

In `boot()`, change the AgentCore construction:

```typescript
  agentCore = new AgentCore(modelManager, commandExecutor, tabControl);
```

This requires `tabControl` to be initialized before `boot()`. Move the `tabControl` init into `registerHandlers()` which runs first, so this is already the case.

Wait — `registerHandlers()` runs before `boot()` (see `main()` lines 442-449). So `tabControl` is already set. Good.

**Step 6: Build to verify**

Run: `cd sidecar && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add sidecar/core/AgentCore.ts sidecar/main.ts
git commit -m "feat: add tab tools to AgentCore"
```

---

### Task 7: Update API contract docs

**Files:**
- Modify: `docs/API_CONTRACT.md`

**Step 1: Add tab control protocol documentation**

After the existing "Notifications" section in Layer 2, add:

```markdown
### Tab Control (Sidecar -> Frontend, notification-based round-trip)

The sidecar sends a `tabRequest` notification. The frontend handles it and returns the result as a `tabResult` JSON-RPC request.

#### tabRequest notifications (Sidecar -> Frontend)
```json
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"create","url":"https://example.com"}}
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"close","tabId":"tab-id"}}
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"switch","tabId":"tab-id"}}
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"navigate","tabId":"tab-id","url":"https://..."}}
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"list"}}
{"jsonrpc":"2.0","method":"tabRequest","params":{"requestId":"uuid","action":"getActive"}}
```

#### tabResult responses (Frontend -> Sidecar)
```json
{"action":"create","requestId":"uuid","ok":true,"data":{"tabId":"new-uuid"}}
{"action":"list","requestId":"uuid","ok":true,"data":{"tabs":[{"id":"...","url":"...","title":"..."}]}}
{"action":"getActive","requestId":"uuid","ok":true,"data":{"tabId":"abc","url":"...","title":"..."}}
{"action":"close","requestId":"uuid","ok":false,"error":{"message":"Tab not found"}}
```
```

**Step 2: Commit**

```bash
git add docs/API_CONTRACT.md
git commit -m "docs: add tab control protocol to API contract"
```

---

### Task 8: Run full test suite and verify build

**Files:** None (validation only)

**Step 1: Run all tests**

Run: `npx vitest run --coverage`
Expected: All tests pass, coverage thresholds met

**Step 2: Build sidecar**

Run: `cd sidecar && npx tsc --noEmit`
Expected: No errors

**Step 3: Build frontend**

Run: `npx vite build`
Expected: No errors

**Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: address test/build issues from agent tab control"
```
