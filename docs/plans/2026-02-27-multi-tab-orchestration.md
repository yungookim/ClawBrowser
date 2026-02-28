# Multi-Tab Research Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable agents to orchestrate browser automation across multiple tabs — opening, switching, waiting for content, and synthesizing — to support workflows like "research a topic on 4 AI sites and produce a unified report."

**Architecture:** Add `browser.waitFor` (streaming response detection), a `pageRegistry` inside `StagehandBridge` (stable tabId handles for opened pages), and four new tools (`browser.waitFor`, `browser.switchTab`, `browser.listTabs`, `browser.closeTab`) wired through a new `'stagehand-tab'` capability type that bypasses `BrowserAutomationRouter` (no webview fallback for in-process state).

**Tech Stack:** TypeScript, Stagehand/Playwright, Vitest (tests in `tests/sidecar/`)

---

## Background

The call chain for browser tools today:
```
Swarm.executeToolCall()
  → BrowserAutomationRouter.execute()         (stagehand/webview fallback logic)
  → StagehandProvider.execute()
  → StagehandBridge.<method>()
```

Key files:
- `sidecar/core/ToolRegistry.ts` — tool definitions, lines 34–61
- `sidecar/dom/StagehandBridge.ts` — browser automation, ~809 lines
- `sidecar/dom/BrowserAutomationRouter.ts` — provider dispatch + tracing
- `sidecar/dom/providers/StagehandProvider.ts` — adapter implementing `BrowserAutomationProvider`
- `sidecar/core/Swarm.ts` — `executeToolCall()` at line 697, `executeStagehandTool()` around line 807

Session persistence is already solved: `preserveUserDataDir: true` in `StagehandBridge.initStagehand()` persists the browser profile to `~/.clawbrowser/workspace/browser-profile/default`. Users log in once manually.

---

## Task 1: Add `browser.waitFor` Tool

Enables the agent to pause and wait for a DOM element (e.g., the "stop generating" button disappearing on an AI site) before extracting a response.

**Files:**
- Modify: `sidecar/dom/StagehandBridge.ts`
- Modify: `sidecar/dom/BrowserAutomationRouter.ts` (type only)
- Modify: `sidecar/dom/providers/StagehandProvider.ts`
- Modify: `sidecar/core/ToolRegistry.ts`
- Modify: `sidecar/core/Swarm.ts`
- Test: `tests/sidecar/stagehand-bridge.test.ts`

### Step 1: Write the failing test

In `tests/sidecar/stagehand-bridge.test.ts`, find the existing `describe('StagehandBridge')` block and add:

```typescript
describe('waitFor', () => {
  it('calls waitForSelector on the active page', async () => {
    const mockWaitForSelector = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      goto: vi.fn(),
      url: vi.fn().mockReturnValue('https://example.com'),
      title: vi.fn().mockResolvedValue('Example'),
      waitForSelector: mockWaitForSelector,
    };
    const mockStagehand = makeMockStagehand(mockPage);
    const bridge = makeBridge({ createStagehand: () => mockStagehand });

    await bridge.waitFor('.done-button');

    expect(mockWaitForSelector).toHaveBeenCalledWith('.done-button', { timeout: 30000 });
  });

  it('respects custom timeout', async () => {
    const mockWaitForSelector = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      goto: vi.fn(),
      url: vi.fn().mockReturnValue('https://example.com'),
      title: vi.fn().mockResolvedValue('Example'),
      waitForSelector: mockWaitForSelector,
    };
    const mockStagehand = makeMockStagehand(mockPage);
    const bridge = makeBridge({ createStagehand: () => mockStagehand });

    await bridge.waitFor('[data-testid="response"]', 60000);

    expect(mockWaitForSelector).toHaveBeenCalledWith('[data-testid="response"]', { timeout: 60000 });
  });

  it('throws if waitForSelector not supported', async () => {
    const mockPage = {
      goto: vi.fn(),
      url: vi.fn().mockReturnValue('https://example.com'),
      title: vi.fn().mockResolvedValue('Example'),
      // No waitForSelector
    };
    const mockStagehand = makeMockStagehand(mockPage);
    const bridge = makeBridge({ createStagehand: () => mockStagehand });

    await expect(bridge.waitFor('.anything')).rejects.toThrow('waitFor not supported');
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd /Users/dgyk/Dev/ClawBrowser
npx vitest run tests/sidecar/stagehand-bridge.test.ts -t "waitFor"
```

Expected: FAIL with `bridge.waitFor is not a function`

### Step 3: Extend `StagehandPageLike` type and add `waitFor` method

In `sidecar/dom/StagehandBridge.ts`:

**a) Extend `StagehandPageLike`** (add after `observe?` line ~33):
```typescript
  waitForSelector?: (selector: string, opts?: { timeout?: number }) => Promise<void>;
```

**b) Add `waitFor` public method** (after the `screenshot` method, ~line 219):
```typescript
async waitFor(selector: string, timeout?: number): Promise<void> {
  if (!selector || typeof selector !== 'string') {
    throw new Error('waitFor requires a selector');
  }
  return this.runWithRecovery(async (stagehand) => {
    const page = await this.getActivePage(stagehand);
    if (!page || typeof page.waitForSelector !== 'function') {
      throw new Error('waitFor not supported on this page');
    }
    await page.waitForSelector(selector, { timeout: timeout ?? 30000 });
  });
}
```

### Step 4: Run test to verify it passes

```bash
npx vitest run tests/sidecar/stagehand-bridge.test.ts -t "waitFor"
```

Expected: PASS (3 tests)

### Step 5: Expand `BrowserAutomationAction` type

In `sidecar/dom/BrowserAutomationRouter.ts`, line 8:
```typescript
// Before:
export type BrowserAutomationAction = 'navigate' | 'act' | 'extract' | 'observe' | 'screenshot';

// After:
export type BrowserAutomationAction = 'navigate' | 'act' | 'extract' | 'observe' | 'screenshot' | 'waitFor';
```

### Step 6: Wire `waitFor` in `StagehandProvider`

In `sidecar/dom/providers/StagehandProvider.ts`, add a case before `default`:
```typescript
case 'waitFor':
  return this.bridge.waitFor(
    String(params.selector || ''),
    typeof params.timeout === 'number' ? params.timeout : undefined,
  );
```

### Step 7: Register `browser.waitFor` in `ToolRegistry`

In `sidecar/core/ToolRegistry.ts`, add after the `browser.screenshot` entry (~line 46):
```typescript
{
  name: 'browser.waitFor',
  capability: 'stagehand',
  action: 'waitFor',
  description: 'Wait for a CSS selector to appear on the current page. Use after browser.act to wait for streaming AI responses to complete before extracting.',
  required: ['selector'],
  optional: ['timeout'],
},
```

### Step 8: Wire `waitFor` in `Swarm.executeStagehandTool()`

In `sidecar/core/Swarm.ts`, find the `executeStagehandTool` method (around line 807 where `case 'navigate':` etc. live) and add:
```typescript
case 'waitFor': {
  await this.stagehandBridge.waitFor(
    String(toolCall.params.selector || ''),
    typeof toolCall.params.timeout === 'number' ? toolCall.params.timeout : undefined,
  );
  return { tool: toolCall.tool, ok: true, data: 'Condition met' };
}
```

### Step 9: Run all stagehand tests

```bash
npx vitest run tests/sidecar/stagehand-bridge.test.ts
```

Expected: All existing + new tests PASS

### Step 10: Commit

```bash
git add sidecar/dom/StagehandBridge.ts sidecar/dom/BrowserAutomationRouter.ts \
        sidecar/dom/providers/StagehandProvider.ts sidecar/core/ToolRegistry.ts \
        sidecar/core/Swarm.ts tests/sidecar/stagehand-bridge.test.ts
git commit -m "feat: add browser.waitFor tool for streaming response detection"
```

---

## Task 2: Add Tab Registry to `StagehandBridge`

Gives each opened tab a stable UUID handle so agents can revisit previous tabs by ID.

**Files:**
- Modify: `sidecar/dom/StagehandBridge.ts`
- Test: `tests/sidecar/stagehand-bridge.test.ts`

### Step 1: Write failing tests

In `tests/sidecar/stagehand-bridge.test.ts`, add a new `describe('tab registry')` block:

```typescript
describe('tab registry', () => {
  it('navigate returns a tabId', async () => {
    const mockPage = {
      goto: vi.fn(),
      url: vi.fn().mockReturnValue('https://example.com'),
      title: vi.fn().mockResolvedValue('Example'),
    };
    const mockStagehand = makeMockStagehand(mockPage);
    const bridge = makeBridge({ createStagehand: () => mockStagehand });

    const result = await bridge.navigate('https://example.com');

    expect(result.tabId).toBeDefined();
    expect(typeof result.tabId).toBe('string');
    expect(result.url).toBe('https://example.com');
  });

  it('listTabs returns all opened tabs', async () => {
    const makeTabPage = (url: string) => ({
      goto: vi.fn(),
      url: vi.fn().mockReturnValue(url),
      title: vi.fn().mockResolvedValue(url),
    });
    let callCount = 0;
    const pages = [makeTabPage('https://a.com'), makeTabPage('https://b.com')];
    const mockStagehand = {
      ...makeMockStagehand(pages[0]),
      context: {
        newPage: vi.fn(() => Promise.resolve(pages[callCount++])),
        pages: vi.fn(() => pages),
        isClosed: vi.fn().mockReturnValue(false),
      },
    };
    const bridge = makeBridge({ createStagehand: () => mockStagehand });

    await bridge.navigate('https://a.com');
    await bridge.navigate('https://b.com');
    const tabs = await bridge.listTabs();

    expect(tabs).toHaveLength(2);
    expect(tabs.map(t => t.url)).toEqual(expect.arrayContaining(['https://a.com', 'https://b.com']));
    expect(tabs.every(t => typeof t.tabId === 'string')).toBe(true);
  });

  it('switchTab makes subsequent getActivePage use the specified tab', async () => {
    const pageA = {
      goto: vi.fn(),
      url: vi.fn().mockReturnValue('https://a.com'),
      title: vi.fn().mockResolvedValue('A'),
      extract: vi.fn().mockResolvedValue('result-a'),
    };
    const pageB = {
      goto: vi.fn(),
      url: vi.fn().mockReturnValue('https://b.com'),
      title: vi.fn().mockResolvedValue('B'),
      extract: vi.fn().mockResolvedValue('result-b'),
    };
    let callCount = 0;
    const pages = [pageA, pageB];
    const mockStagehand = {
      ...makeMockStagehand(pageA),
      context: {
        newPage: vi.fn(() => Promise.resolve(pages[callCount++])),
        pages: vi.fn(() => pages),
        isClosed: vi.fn().mockReturnValue(false),
      },
    };
    const bridge = makeBridge({ createStagehand: () => mockStagehand });

    const navA = await bridge.navigate('https://a.com');
    await bridge.navigate('https://b.com');
    // Now active tab is B; switch back to A
    await bridge.switchTab(navA.tabId!);
    await bridge.extract('get content');

    expect(pageA.extract).toHaveBeenCalled();
    expect(pageB.extract).not.toHaveBeenCalled();
  });

  it('switchTab throws for unknown tabId', async () => {
    const mockStagehand = makeMockStagehand({ goto: vi.fn(), url: vi.fn(), title: vi.fn() });
    const bridge = makeBridge({ createStagehand: () => mockStagehand });

    await expect(bridge.switchTab('nonexistent')).rejects.toThrow('Tab not found');
  });

  it('closeTab removes tab and switches to remaining', async () => {
    const pageA = { goto: vi.fn(), url: vi.fn().mockReturnValue('https://a.com'), title: vi.fn().mockResolvedValue('A') };
    const pageB = { goto: vi.fn(), url: vi.fn().mockReturnValue('https://b.com'), title: vi.fn().mockResolvedValue('B') };
    let callCount = 0;
    const pages = [pageA, pageB];
    const mockStagehand = {
      ...makeMockStagehand(pageA),
      context: {
        newPage: vi.fn(() => Promise.resolve(pages[callCount++])),
        pages: vi.fn(() => pages),
        isClosed: vi.fn().mockReturnValue(false),
      },
    };
    const bridge = makeBridge({ createStagehand: () => mockStagehand });

    const navB = await bridge.navigate('https://b.com'); // active = B
    await bridge.closeTab(navB.tabId!);
    const tabs = await bridge.listTabs();

    expect(tabs).toHaveLength(1);
    expect(tabs[0].url).toBe('https://a.com');
  });
});
```

### Step 2: Run tests to verify they fail

```bash
npx vitest run tests/sidecar/stagehand-bridge.test.ts -t "tab registry"
```

Expected: FAIL — `bridge.listTabs is not a function`, `result.tabId is undefined`

### Step 3: Add tab registry state and import `randomUUID`

In `sidecar/dom/StagehandBridge.ts`:

**a) Add import at top:**
```typescript
import { randomUUID } from 'node:crypto';
```

**b) Add fields to `StagehandBridge` class** (after `private lastModelSignature` ~line 90):
```typescript
private pageRegistry = new Map<string, StagehandPageLike>();
private activeTabId: string | null = null;
```

### Step 4: Update `openNewTab()` to register tabs

Replace the existing `openNewTab()` method body (lines 406–423):
```typescript
private async openNewTab(stagehand: StagehandLike, url: string): Promise<{ tabId: string; page: StagehandPageLike }> {
  const tabId = randomUUID();
  const context = stagehand.context;
  let page: StagehandPageLike;

  if (context && typeof context.newPage === 'function') {
    page = await context.newPage();
    if (typeof page.goto === 'function') {
      await page.goto(url);
    }
  } else {
    page = await this.getActivePage(stagehand);
    if (typeof page.goto === 'function') {
      await page.goto(url);
    }
  }

  this.pageRegistry.set(tabId, page);
  this.activeTabId = tabId;
  this.logStagehandTabOpen(url, tabId);
  return { tabId, page };
}
```

Update `logStagehandTabOpen` signature to accept `tabId`:
```typescript
private logStagehandTabOpen(url: string, tabId: string): void {
  const message = `[StagehandBridge] Opened new tab tabId=${tabId} url=${url}`;
  console.error(message);
  if (this.systemLogger) {
    this.systemLogger.log('info', message).catch(() => {});
  }
}
```

### Step 5: Update callers of `openNewTab()` to destructure

`navigate()` (~line 128): returns `tabId` in result
```typescript
async navigate(url: string): Promise<{ url: string; title?: string | null; tabId: string }> {
  if (!url || typeof url !== 'string') {
    throw new Error('navigate requires a url');
  }
  return this.runWithRecovery(async (stagehand) => {
    const { tabId, page } = await this.openNewTab(stagehand, url);
    if (!page || typeof page.goto !== 'function') {
      throw new Error('Stagehand page unavailable');
    }
    const finalUrl = typeof page.url === 'function' ? page.url() : url;
    const title = typeof page.title === 'function' ? await page.title() : null;
    return { url: finalUrl, title, tabId };
  });
}
```

`act()` (~line 143): destructure page from result
```typescript
const { page } = navUrl ? await this.openNewTab(stagehand, navUrl) : { page: await this.getActivePage(stagehand) };
```

`extract()` (~line 161): same pattern
```typescript
const { page: pageForAction } = navUrl
  ? await this.openNewTab(stagehand, navUrl)
  : { page: await this.getActivePage(stagehand) };
```

`observe()` (~line 192): same pattern
```typescript
const { page } = navUrl ? await this.openNewTab(stagehand, navUrl) : { page: await this.getActivePage(stagehand) };
```

`openSession()` (~line 425):
```typescript
async openSession(): Promise<void> {
  await this.runWithRecovery(async (stagehand) => {
    await this.openNewTab(stagehand, 'about:blank');
  });
}
```

### Step 6: Update `getActivePage()` to use the registry

Replace `getActivePage()` (lines 386–404):
```typescript
private async getActivePage(stagehand: StagehandLike): Promise<StagehandPageLike> {
  // Registry takes priority — honours switchTab()
  if (this.activeTabId && this.pageRegistry.has(this.activeTabId)) {
    return this.pageRegistry.get(this.activeTabId)!;
  }

  if (stagehand.page) {
    return stagehand.page;
  }

  const context = stagehand.context;
  if (context) {
    if (typeof context.pages === 'function') {
      const pages = context.pages();
      if (pages.length > 0) return pages[0];
    }
    if (typeof context.newPage === 'function') {
      return context.newPage();
    }
  }

  throw new Error('Stagehand page unavailable');
}
```

### Step 7: Add `switchTab`, `listTabs`, `closeTab` public methods

Add after the `waitFor` method added in Task 1:

```typescript
async switchTab(tabId: string): Promise<void> {
  if (!this.pageRegistry.has(tabId)) {
    throw new Error(`Tab not found: ${tabId}`);
  }
  this.activeTabId = tabId;
}

async listTabs(): Promise<Array<{ tabId: string; url?: string; title?: string; active: boolean }>> {
  const tabs: Array<{ tabId: string; url?: string; title?: string; active: boolean }> = [];
  for (const [tabId, page] of this.pageRegistry.entries()) {
    const url = typeof page.url === 'function' ? page.url() : undefined;
    const title = typeof page.title === 'function' ? await page.title() : undefined;
    tabs.push({ tabId, url, title, active: tabId === this.activeTabId });
  }
  return tabs;
}

async closeTab(tabId?: string): Promise<void> {
  const id = tabId ?? this.activeTabId ?? undefined;
  if (!id || !this.pageRegistry.has(id)) {
    throw new Error(`Tab not found: ${id ?? '(no active tab)'}`);
  }
  this.pageRegistry.delete(id);
  if (this.activeTabId === id) {
    const remaining = [...this.pageRegistry.keys()];
    this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
  }
}
```

### Step 8: Clear registry on reset/close

In `resetStagehand()` (~line 487), add before returning:
```typescript
this.pageRegistry.clear();
this.activeTabId = null;
```

In `close()` (~line 220), at the very end (after `this.stagehand = null`):
```typescript
this.pageRegistry.clear();
this.activeTabId = null;
```

### Step 9: Run tab registry tests

```bash
npx vitest run tests/sidecar/stagehand-bridge.test.ts -t "tab registry"
```

Expected: All 5 PASS

### Step 10: Run full stagehand test suite

```bash
npx vitest run tests/sidecar/stagehand-bridge.test.ts
```

Expected: All PASS (no regressions)

### Step 11: Commit

```bash
git add sidecar/dom/StagehandBridge.ts tests/sidecar/stagehand-bridge.test.ts
git commit -m "feat: add tab registry to StagehandBridge (switchTab, listTabs, closeTab)"
```

---

## Task 3: Register Tab Tools End-to-End

Wire the three tab tools (`browser.switchTab`, `browser.listTabs`, `browser.closeTab`) through ToolRegistry and Swarm dispatch.

**Files:**
- Modify: `sidecar/core/ToolRegistry.ts`
- Modify: `sidecar/core/Swarm.ts`
- Test: `tests/sidecar/swarm.test.ts` and `tests/sidecar/stagehand-bridge.test.ts`

### Step 1: Write failing integration test

In `tests/sidecar/swarm.test.ts`, find the section that tests tool calls and add:

```typescript
describe('stagehand-tab tools', () => {
  function makeSwarmWithTabBridge(bridge: Partial<import('../../sidecar/dom/StagehandBridge.js').StagehandBridge>) {
    const registry = new ToolRegistry();
    return new Swarm(
      mockModelManager,
      registry,
      null,   // no dispatcher
      null,   // no commandExecutor
      vi.fn(), // notify
      bridge as any,
      null,   // no systemLogger
      null,   // no browserAutomationRouter
    );
  }

  it('executes browser.listTabs and returns tab list', async () => {
    const mockBridge = {
      isActive: vi.fn().mockReturnValue(true),
      listTabs: vi.fn().mockResolvedValue([
        { tabId: 'abc', url: 'https://grok.com', title: 'Grok', active: false },
        { tabId: 'def', url: 'https://claude.ai', title: 'Claude', active: true },
      ]),
    };
    const swarm = makeSwarmWithTabBridge(mockBridge);

    // Simulate tool dispatch directly
    const toolCall = {
      kind: 'agent' as const,
      tool: 'browser.listTabs',
      capability: 'stagehand-tab',
      action: 'listTabs',
      params: {},
    };

    // Call executeToolCall via swarm (we test public API via execute or expose for test)
    // Use execute() with a canned model response
    // ... OR access private method via (swarm as any).executeToolCall(toolCall)
    const result = await (swarm as any).executeToolCall(toolCall);

    expect(result.ok).toBe(true);
    expect(mockBridge.listTabs).toHaveBeenCalled();
    expect(result.data).toHaveLength(2);
  });

  it('executes browser.switchTab', async () => {
    const mockBridge = {
      isActive: vi.fn().mockReturnValue(true),
      switchTab: vi.fn().mockResolvedValue(undefined),
    };
    const swarm = makeSwarmWithTabBridge(mockBridge);

    const toolCall = {
      kind: 'agent' as const,
      tool: 'browser.switchTab',
      capability: 'stagehand-tab',
      action: 'switchTab',
      params: { tabId: 'abc-123' },
    };

    const result = await (swarm as any).executeToolCall(toolCall);

    expect(result.ok).toBe(true);
    expect(mockBridge.switchTab).toHaveBeenCalledWith('abc-123');
  });
});
```

### Step 2: Run tests to verify they fail

```bash
npx vitest run tests/sidecar/swarm.test.ts -t "stagehand-tab tools"
```

Expected: FAIL — `capability 'stagehand-tab' not handled`

### Step 3: Register tools in `ToolRegistry`

In `sidecar/core/ToolRegistry.ts`, add after the `browser.waitFor` entry:

```typescript
{
  name: 'browser.switchTab',
  capability: 'stagehand-tab',
  action: 'switchTab',
  description: 'Switch the active browser tab to a previously opened tab by its tabId. Use the tabId returned by browser.navigate.',
  required: ['tabId'],
},
{
  name: 'browser.listTabs',
  capability: 'stagehand-tab',
  action: 'listTabs',
  description: 'List all open browser tabs with their tabId, URL, title, and which is active.',
},
{
  name: 'browser.closeTab',
  capability: 'stagehand-tab',
  action: 'closeTab',
  description: 'Close an open browser tab. If tabId is omitted, closes the active tab.',
  optional: ['tabId'],
},
```

### Step 4: Add `executeStagehandTabTool()` to `Swarm`

In `sidecar/core/Swarm.ts`, add a new private method after `executeStagehandTool()`:

```typescript
private async executeStagehandTabTool(toolCall: Extract<ParsedToolCall, { kind: 'agent' }>): Promise<{
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}> {
  if (!this.stagehandBridge) {
    return { tool: toolCall.tool, ok: false, error: 'Stagehand unavailable.' };
  }
  try {
    switch (toolCall.action) {
      case 'switchTab': {
        await this.stagehandBridge.switchTab(String(toolCall.params.tabId || ''));
        return { tool: toolCall.tool, ok: true, data: 'Switched tab' };
      }
      case 'listTabs': {
        const tabs = await this.stagehandBridge.listTabs();
        return { tool: toolCall.tool, ok: true, data: tabs };
      }
      case 'closeTab': {
        const tabId = typeof toolCall.params.tabId === 'string' ? toolCall.params.tabId : undefined;
        await this.stagehandBridge.closeTab(tabId);
        return { tool: toolCall.tool, ok: true, data: 'Tab closed' };
      }
      default:
        return { tool: toolCall.tool, ok: false, error: `Unknown stagehand-tab action: ${toolCall.action}` };
    }
  } catch (err) {
    return { tool: toolCall.tool, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

### Step 5: Add dispatch branch in `executeToolCall()`

In `sidecar/core/Swarm.ts`, in `executeToolCall()` around line 721, add a new branch after the `stagehand` branch:

```typescript
if (toolCall.kind === 'agent' && toolCall.capability === 'stagehand-tab') {
  return this.executeStagehandTabTool(toolCall);
}
```

### Step 6: Run tests

```bash
npx vitest run tests/sidecar/swarm.test.ts -t "stagehand-tab tools"
```

Expected: PASS

### Step 7: Run full test suite

```bash
npm run test
```

Expected: All existing tests PASS, no regressions

### Step 8: Commit

```bash
git add sidecar/core/ToolRegistry.ts sidecar/core/Swarm.ts tests/sidecar/swarm.test.ts
git commit -m "feat: register browser.switchTab, browser.listTabs, browser.closeTab tools"
```

---

## Task 4: Update Planner for Multi-Tab Workflows

Teach the Swarm's planner and executor the multi-tab patterns so it generates correct plans.

**Files:**
- Modify: `sidecar/core/Swarm.ts` (prompt constants only)
- Test: `tests/sidecar/swarm.test.ts`

### Step 1: Write a test for planner prompt content

In `tests/sidecar/swarm.test.ts`:

```typescript
it('PLANNER_SYSTEM_PROMPT includes multi-tab guidance', () => {
  // Access the constant (expose for test or check via toString)
  const swarm = new Swarm(mockModelManager);
  const prompt = (Swarm as any).PLANNER_SYSTEM_PROMPT || '';
  // If private, just verify via the executor system prompt inclusion
  expect(prompt).toContain('tabId');
});
```

> Note: If the prompts are module-level constants rather than static class members, access via `(swarm as any)` won't work. In that case, verify indirectly: check that a mocked model receives the expected system prompt when `execute()` is called.

### Step 2: Update `PLANNER_SYSTEM_PROMPT`

In `sidecar/core/Swarm.ts`, update `PLANNER_SYSTEM_PROMPT` (line 64):

```typescript
const PLANNER_SYSTEM_PROMPT = `You are a task planner for ClawBrowser's AI agent.
Break down the user's task into a numbered list of concrete, actionable steps.
Each step should be a single action that can be executed independently.
Respond ONLY with a JSON array of step strings. Example:
["Search for the topic on Google", "Open the first relevant result", "Extract the key information", "Summarize findings for the user"]
Keep it to 2-6 steps. If the task is simple, use fewer steps.

For multi-site research tasks (e.g. visit 4 websites and compare), plan steps like:
["Navigate to site A and save the tabId from the result", "Wait for the response to load, then extract the answer", "Navigate to site B and save its tabId", "Wait for the response, then extract the answer", "Use browser.listTabs to confirm tabs, then synthesize a comparison report"]

Tab tools available to executors: browser.navigate returns a tabId. browser.switchTab(tabId) returns to a previous tab. browser.listTabs shows all open tabs. browser.waitFor(selector) waits for an element before extracting.`;
```

### Step 3: Update `EXECUTOR_SYSTEM_PROMPT`

In `sidecar/core/Swarm.ts`, update `EXECUTOR_SYSTEM_PROMPT` (line 71):

```typescript
const EXECUTOR_SYSTEM_PROMPT = `You are an AI executor for ClawBrowser.
You are given a specific step to execute as part of a larger task.
Execute the step and provide a clear, concise result.
You have context about previous steps that have already been completed.

When using browser tools:
- browser.navigate returns {url, title, tabId}. Always note the tabId if you need to return to this tab later.
- browser.waitFor(selector) pauses until a CSS selector appears — use it after browser.act to wait for AI responses to finish streaming before calling browser.extract.
- browser.switchTab(tabId) makes subsequent act/extract calls operate on a previously opened tab.
- browser.listTabs() shows all open tabs with their URLs and IDs.`;
```

### Step 4: Run full test suite

```bash
npm run test
```

Expected: All PASS

### Step 5: Smoke test with the dev server (manual verification)

```bash
npm run dev
```

In the agent panel, type:
> "Go to https://grok.com and tell me its page title, then go to https://perplexity.ai and tell me its title, then list my open tabs."

Expected behavior:
1. Swarm classifies as complex
2. Executor opens grok.com, extracts title, returns tabId
3. Executor opens perplexity.ai, extracts title, returns tabId
4. Executor calls `browser.listTabs` and returns list of 2 tabs
5. Synthesizer produces a report

### Step 6: Commit

```bash
git add sidecar/core/Swarm.ts tests/sidecar/swarm.test.ts
git commit -m "feat: update swarm planner/executor prompts for multi-tab research workflows"
```

---

## Verification Checklist

Before declaring complete:

- [ ] `npx vitest run` passes all tests
- [ ] `browser.waitFor` tool appears in `ToolRegistry.describeTools()` output
- [ ] `browser.switchTab`, `browser.listTabs`, `browser.closeTab` appear in tool descriptions
- [ ] `navigate()` return type includes `tabId` in TypeScript
- [ ] `pageRegistry` clears on `close()` and `resetStagehand()`
- [ ] Manual smoke test: 2-site navigation + `listTabs` works end-to-end

---

## Out of Scope (future work)

- **Parallel Swarm steps** — fan-out/fan-in in LangGraph for simultaneously visiting multiple sites
- **SidecarTabRouter** — controlling the *user's* browser tabs (not Stagehand tabs); see `docs/plans/2026-02-18-agent-tab-control-design.md`
- **Tab persistence across Stagehand restarts** — the registry is in-process only; Stagehand restart clears it
