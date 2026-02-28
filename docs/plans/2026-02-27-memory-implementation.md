# Memory Capability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent memory to ClawBrowser — the agent detects implicit and explicit memory signals, stores them, injects them into every system prompt, acknowledges them in chat, and exposes a panel for browsing/deleting.

**Architecture:** `MemoryManager` wraps `QmdMemory` (for semantic search) plus a JSON sidecar file (for listing). It is wired into `AgentCore` via a setter. Two new tools (`memory.store`, `memory.delete`) let the model persist facts. On every user message, `buildSystemPrompt()` injects the top-5 semantically matching memories. A `memoryStored` notification drives a chat chip and can refresh the Memory Panel.

**Tech Stack:** TypeScript, `QmdMemory` (BM25/SQLite), `node:crypto` (`randomUUID`), `node:fs/promises`, Vitest

---

### Task 1: Create MemoryManager

**Files:**
- Create: `sidecar/memory/MemoryManager.ts`

**Step 1: Write the file**

```typescript
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { QmdMemory, MemoryDocument } from './QmdMemory.js';

export interface Memory {
  id: string;
  fact: string;
  createdAt: string;
}

/**
 * MemoryManager persists explicit and implicit user facts.
 * Uses QmdMemory (BM25/SQLite) for semantic search and a JSON
 * sidecar file for listing all memories.
 */
export class MemoryManager {
  private memories: Memory[] = [];
  private readonly indexPath: string;
  private readonly qmdMemory: QmdMemory;
  private readonly onMemoryStored?: (fact: string, id: string) => void;

  constructor(
    qmdMemory: QmdMemory,
    indexPath: string,
    onMemoryStored?: (fact: string, id: string) => void,
  ) {
    this.qmdMemory = qmdMemory;
    this.indexPath = indexPath;
    this.onMemoryStored = onMemoryStored;
  }

  /** Load existing memories from the JSON index file. */
  async initialize(): Promise<void> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      this.memories = JSON.parse(raw) as Memory[];
    } catch {
      this.memories = [];
    }
    console.error(`[MemoryManager] Initialized with ${this.memories.length} memories`);
  }

  /** Store a new fact. Returns the generated ID. */
  async store(fact: string): Promise<string> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.memories.push({ id, fact, createdAt });
    await this.persist();
    try {
      await this.qmdMemory.addDocument(id, fact, { title: fact.slice(0, 60) });
    } catch (err) {
      console.error('[MemoryManager] Failed to index in QmdMemory (non-fatal):', err);
    }
    console.error(`[MemoryManager] Stored memory id=${id}`);
    this.onMemoryStored?.(fact, id);
    return id;
  }

  /** Semantic search via QmdMemory. Returns empty array on failure. */
  search(query: string, topN: number = 5): MemoryDocument[] {
    try {
      return this.qmdMemory.search(query, topN);
    } catch (err) {
      console.error('[MemoryManager] Search failed (non-fatal):', err);
      return [];
    }
  }

  /** Delete a memory by ID. Throws if not found. */
  async delete(id: string): Promise<void> {
    const idx = this.memories.findIndex((m) => m.id === id);
    if (idx === -1) throw new Error(`Memory not found: ${id}`);
    this.memories.splice(idx, 1);
    await this.persist();
    try {
      this.qmdMemory.remove(id);
    } catch (err) {
      console.error('[MemoryManager] Failed to remove from QmdMemory (non-fatal):', err);
    }
    console.error(`[MemoryManager] Deleted memory id=${id}`);
  }

  /** Return all stored memories (copy). */
  list(): Memory[] {
    return [...this.memories];
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.writeFile(this.indexPath, JSON.stringify(this.memories, null, 2), 'utf-8');
  }
}
```

**Step 2: Commit**

```bash
git add sidecar/memory/MemoryManager.ts
git commit -m "feat: add MemoryManager class"
```

---

### Task 2: Add memory tools to ToolRegistry

**Files:**
- Modify: `sidecar/core/ToolRegistry.ts:34-61` (the `TOOL_DEFINITIONS` array)

**Step 1: Add two entries at the end of the `TOOL_DEFINITIONS` array**

Find the closing `];` of `TOOL_DEFINITIONS` and insert before it:

```typescript
  {
    name: 'memory.store',
    capability: 'memory',
    action: 'store',
    description: 'Persist a preference, fact, or piece of context about the user for future reference. Call this when the user expresses a preference, states a fact about themselves, or asks you to remember something — even implicitly.',
    required: ['fact'],
  },
  {
    name: 'memory.delete',
    capability: 'memory',
    action: 'delete',
    description: 'Delete a previously stored memory by its ID. Use when the user corrects or retracts something.',
    required: ['id'],
  },
```

**Step 2: Verify the definitions array still compiles**

```bash
npm run build:sidecar 2>&1 | head -20
```

Expected: no TypeScript errors.

**Step 3: Commit**

```bash
git add sidecar/core/ToolRegistry.ts
git commit -m "feat: add memory.store and memory.delete tool definitions"
```

---

### Task 3: Wire memory into AgentCore

**Files:**
- Modify: `sidecar/core/AgentCore.ts`

**Step 1: Add import and private field**

At the top of the file, add import:
```typescript
import type { MemoryManager } from '../memory/MemoryManager.js';
```

Inside the `AgentCore` class, add a private field after `browserAutomationRouter`:
```typescript
private memoryManager: MemoryManager | null = null;
```

**Step 2: Add setMemoryManager method**

After the constructor, add:
```typescript
/** Attach a MemoryManager (called after workspace initializes). */
setMemoryManager(mm: MemoryManager): void {
  this.memoryManager = mm;
}
```

**Step 3: Inject memories into buildSystemPrompt**

At the end of `buildSystemPrompt()`, before `return parts.join('\n');`, add:

```typescript
if (this.memoryManager) {
  const memories = this.memoryManager.search(context.userQuery, 5);
  if (memories.length > 0) {
    parts.push('\n## What I remember about you');
    for (const m of memories) {
      parts.push(`- ${m.content}`);
    }
  }
}
```

**Step 4: Handle memory tool calls in executeToolCall**

In `executeToolCall()`, add a branch before the `if (!this.dispatcher)` check:

```typescript
if (toolCall.kind === 'agent' && toolCall.capability === 'memory') {
  return this.executeMemoryTool(toolCall);
}
```

**Step 5: Add the executeMemoryTool private method**

Add after `executeStagehandTool`:

```typescript
private async executeMemoryTool(
  toolCall: Extract<ParsedToolCall, { kind: 'agent' }>,
): Promise<{ tool: string; ok: boolean; data?: unknown; error?: string }> {
  if (!this.memoryManager) {
    return { tool: toolCall.tool, ok: false, error: 'Memory manager unavailable.' };
  }
  try {
    if (toolCall.action === 'store') {
      const fact = String(toolCall.params.fact || '');
      if (!fact) return { tool: toolCall.tool, ok: false, error: 'fact is required' };
      const id = await this.memoryManager.store(fact);
      return { tool: toolCall.tool, ok: true, data: { id } };
    }
    if (toolCall.action === 'delete') {
      const id = String(toolCall.params.id || '');
      if (!id) return { tool: toolCall.tool, ok: false, error: 'id is required' };
      await this.memoryManager.delete(id);
      return { tool: toolCall.tool, ok: true, data: { deleted: id } };
    }
    return { tool: toolCall.tool, ok: false, error: `Unknown memory action: ${toolCall.action}` };
  } catch (err) {
    return { tool: toolCall.tool, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

**Step 6: Verify build**

```bash
npm run build:sidecar 2>&1 | head -20
```

Expected: no errors.

**Step 7: Commit**

```bash
git add sidecar/core/AgentCore.ts
git commit -m "feat: wire MemoryManager into AgentCore — inject memories + handle memory tools"
```

---

### Task 4: Wire MemoryManager into main.ts

**Files:**
- Modify: `sidecar/main.ts`

**Step 1: Add import**

Add after the `QmdMemory` import:
```typescript
import { MemoryManager } from './memory/MemoryManager.js';
```

**Step 2: Add module-level variable**

After `let qmdMemory: QmdMemory;`, add:
```typescript
let memoryManager: MemoryManager;
```

**Step 3: Initialize in configureWorkspace**

In `configureWorkspace()`, after the `qmdMemory` initialization block (around line 230), add:

```typescript
const memoryIndexPath = path.join(workspaceDir, 'memory', 'memories.json');
memoryManager = new MemoryManager(
  qmdMemory,
  memoryIndexPath,
  (fact, id) => sendNotification('memoryStored', { fact, id }),
);
try {
  await memoryManager.initialize();
} catch (err) {
  console.error('[sidecar] MemoryManager init failed (non-fatal):', err);
}
agentCore.setMemoryManager(memoryManager);
```

**Step 4: Add listMemories and deleteMemory RPC handlers**

In `registerHandlers()`, after the `getMemory` handler block, add:

```typescript
handlers.set('listMemories', async () => {
  return { memories: memoryManager.list() };
});

handlers.set('deleteMemory', async (params) => {
  const id = params.id as string;
  if (!id || typeof id !== 'string') throw new Error('id is required');
  await memoryManager.delete(id);
  return { ok: true };
});
```

**Step 5: Verify build**

```bash
npm run build:sidecar 2>&1 | head -20
```

Expected: no errors.

**Step 6: Commit**

```bash
git add sidecar/main.ts
git commit -m "feat: wire MemoryManager into main.ts — boot, RPC handlers, notification"
```

---

### Task 5: Memory chip in ChatView + AgentPanel notification handler

**Files:**
- Modify: `src/agent/ChatView.ts`
- Modify: `src/agent/AgentPanel.ts`

**Step 1: Add addMemoryChip to ChatView**

After the `addMessage()` method, add:

```typescript
addMemoryChip(fact: string): void {
  const chip = document.createElement('div');
  chip.className = 'chat-memory-chip';
  chip.textContent = `\u2605 Remembered: "${fact}"`;
  this.messageList.appendChild(chip);
  this.messageList.scrollTop = this.messageList.scrollHeight;
}
```

**Step 2: Handle memoryStored notification in AgentPanel**

In `AgentPanel`'s `onNotification` handler, add a new branch after the `swarmComplete` block:

```typescript
} else if (method === 'memoryStored') {
  const { fact } = params as { fact: string; id: string };
  this.chatView.addMemoryChip(fact);
}
```

**Step 3: Add CSS for the chip**

Find the existing CSS file for the chat panel:
```bash
grep -r "chat-message" src/ --include="*.css" -l
```

Add to that file:

```css
.chat-memory-chip {
  font-size: 11px;
  color: var(--text-muted, #888);
  padding: 2px 6px;
  margin: 2px 0;
  border-left: 2px solid var(--accent, #4a9eff);
  background: transparent;
}
```

**Step 4: Commit**

```bash
git add src/agent/ChatView.ts src/agent/AgentPanel.ts
git commit -m "feat: add memory chip to chat on memoryStored notification"
```

---

### Task 6: Create MemoryPanel and wire toggle in AgentPanel

**Files:**
- Create: `src/agent/MemoryPanel.ts`
- Modify: `src/agent/AgentPanel.ts`

**Step 1: Write MemoryPanel**

```typescript
import type { SidecarBridge } from './SidecarBridge';

interface MemoryEntry {
  id: string;
  fact: string;
  createdAt: string;
}

/**
 * MemoryPanel displays stored memories and lets users delete them.
 * Toggled from the AgentPanel header.
 */
export class MemoryPanel {
  private container: HTMLElement;
  private bridge: SidecarBridge;
  private listEl: HTMLElement;

  constructor(container: HTMLElement, bridge: SidecarBridge) {
    this.container = container;
    this.bridge = bridge;
    this.container.className = 'memory-panel';
    this.container.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'memory-panel-header';
    header.textContent = 'Memories';
    this.container.appendChild(header);

    this.listEl = document.createElement('div');
    this.listEl.className = 'memory-panel-list';
    this.container.appendChild(this.listEl);
  }

  async show(): Promise<void> {
    this.container.style.display = 'flex';
    await this.load();
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  toggle(): void {
    if (this.container.style.display === 'none') {
      void this.show();
    } else {
      this.hide();
    }
  }

  private async load(): Promise<void> {
    try {
      const result = await this.bridge.send('listMemories', {}) as { memories: MemoryEntry[] };
      this.render(result.memories);
    } catch {
      this.listEl.textContent = 'Failed to load memories.';
    }
  }

  private render(memories: MemoryEntry[]): void {
    this.listEl.replaceChildren();
    if (memories.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'memory-empty';
      empty.textContent = 'No memories yet.';
      this.listEl.appendChild(empty);
      return;
    }
    for (const mem of memories) {
      const row = document.createElement('div');
      row.className = 'memory-row';

      const fact = document.createElement('span');
      fact.className = 'memory-fact';
      fact.textContent = mem.fact;
      row.appendChild(fact);

      const del = document.createElement('button');
      del.className = 'memory-delete-btn';
      del.textContent = '\u00d7';
      del.title = 'Forget this';
      del.addEventListener('click', async () => {
        try {
          await this.bridge.send('deleteMemory', { id: mem.id });
          row.remove();
        } catch {
          // ignore
        }
      });
      row.appendChild(del);

      this.listEl.appendChild(row);
    }
  }
}
```

Note: `replaceChildren()` (no args) is used to clear the list — this is the safe, modern alternative to `innerHTML = ''`, avoiding any XSS risk.

**Step 2: Add CSS**

In the same CSS file as Task 5:

```css
.memory-panel {
  flex-direction: column;
  border-top: 1px solid var(--border, #333);
  max-height: 240px;
  overflow-y: auto;
}

.memory-panel-header {
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted, #888);
  border-bottom: 1px solid var(--border, #333);
}

.memory-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border-subtle, #222);
}

.memory-fact {
  flex: 1;
  font-size: 12px;
  color: var(--text, #ccc);
}

.memory-delete-btn {
  background: none;
  border: none;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
  line-height: 1;
}

.memory-delete-btn:hover {
  color: var(--danger, #e06c75);
}

.memory-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--text-muted, #888);
}
```

**Step 3: Add toggle button and MemoryPanel to AgentPanel**

In `AgentPanel.ts`:

1. Add import at top:
```typescript
import { MemoryPanel } from './MemoryPanel';
```

2. Add private field in the class:
```typescript
private memoryPanel: MemoryPanel;
```

3. In the constructor, after `this.chatView = new ChatView(container);`, add:

```typescript
// Header with memory toggle above the chat view
const panelHeader = document.createElement('div');
panelHeader.className = 'agent-panel-header';

const memoryBtn = document.createElement('button');
memoryBtn.className = 'agent-panel-memory-btn';
memoryBtn.textContent = '\u2605 Memory';
memoryBtn.title = 'Toggle memory panel';
panelHeader.appendChild(memoryBtn);
this.container.insertBefore(panelHeader, this.container.firstChild);

const memoryContainer = document.createElement('div');
this.container.insertBefore(memoryContainer, panelHeader.nextSibling);
this.memoryPanel = new MemoryPanel(memoryContainer, this.bridge);

memoryBtn.addEventListener('click', () => this.memoryPanel.toggle());
```

4. Add CSS for the header:
```css
.agent-panel-header {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border, #333);
}

.agent-panel-memory-btn {
  background: none;
  border: none;
  font-size: 11px;
  color: var(--text-muted, #888);
  cursor: pointer;
  padding: 2px 6px;
}

.agent-panel-memory-btn:hover {
  color: var(--text, #ccc);
}
```

**Step 4: Commit**

```bash
git add src/agent/MemoryPanel.ts src/agent/AgentPanel.ts
git commit -m "feat: add MemoryPanel with toggle button in AgentPanel header"
```

---

### Task 7: Unit tests for MemoryManager

**Files:**
- Create: `tests/sidecar/memory-manager.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../sidecar/memory/MemoryManager';

// Mock QmdMemory
const mockAddDocument = vi.fn().mockResolvedValue(undefined);
const mockSearch = vi.fn().mockReturnValue([]);
const mockRemove = vi.fn();

const mockQmdMemory = {
  addDocument: mockAddDocument,
  search: mockSearch,
  remove: mockRemove,
} as any;

// Mock fs/promises so no disk writes in tests
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe('MemoryManager', () => {
  let manager: MemoryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MemoryManager(mockQmdMemory, '/tmp/test-memories.json');
  });

  it('initializes with empty list when index file missing', async () => {
    await manager.initialize();
    expect(manager.list()).toEqual([]);
  });

  it('stores a fact and returns an id', async () => {
    await manager.initialize();
    const id = await manager.store('User prefers dark mode');
    expect(id).toBeTruthy();
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0].fact).toBe('User prefers dark mode');
  });

  it('indexes into QmdMemory on store', async () => {
    await manager.initialize();
    await manager.store('User wakes at 7am');
    expect(mockAddDocument).toHaveBeenCalledWith(
      expect.any(String),
      'User wakes at 7am',
      { title: 'User wakes at 7am' },
    );
  });

  it('calls onMemoryStored callback after successful store', async () => {
    const onStored = vi.fn();
    manager = new MemoryManager(mockQmdMemory, '/tmp/test.json', onStored);
    await manager.initialize();
    const id = await manager.store('Prefers bullet points');
    expect(onStored).toHaveBeenCalledWith('Prefers bullet points', id);
  });

  it('deletes a memory by id', async () => {
    await manager.initialize();
    const id = await manager.store('Some fact');
    await manager.delete(id);
    expect(manager.list()).toHaveLength(0);
    expect(mockRemove).toHaveBeenCalledWith(id);
  });

  it('throws when deleting unknown id', async () => {
    await manager.initialize();
    await expect(manager.delete('nonexistent-id')).rejects.toThrow('Memory not found');
  });

  it('returns search results from QmdMemory', async () => {
    mockSearch.mockReturnValue([{ id: 'a', content: 'dark mode', title: 'dark mode', score: 1 }]);
    await manager.initialize();
    const results = manager.search('dark mode');
    expect(results).toHaveLength(1);
    expect(mockSearch).toHaveBeenCalledWith('dark mode', 5);
  });

  it('returns empty array when search throws', async () => {
    mockSearch.mockImplementation(() => { throw new Error('db error'); });
    await manager.initialize();
    const results = manager.search('anything');
    expect(results).toEqual([]);
  });

  it('continues gracefully when QmdMemory.addDocument fails', async () => {
    mockAddDocument.mockRejectedValue(new Error('index error'));
    await manager.initialize();
    const id = await manager.store('fact that fails to index');
    expect(manager.list()).toHaveLength(1);
    expect(id).toBeTruthy();
  });

  it('list returns a copy, not the internal array', async () => {
    await manager.initialize();
    await manager.store('fact one');
    const list = manager.list();
    list.push({ id: 'fake', fact: 'injected', createdAt: '' });
    expect(manager.list()).toHaveLength(1);
  });
});
```

**Step 2: Run the tests**

```bash
npm run test -- tests/sidecar/memory-manager.test.ts 2>&1
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add tests/sidecar/memory-manager.test.ts
git commit -m "test: add MemoryManager unit tests"
```

---

### Task 8: AgentCore memory integration tests

**Files:**
- Modify: `tests/sidecar/agent-core.test.ts`

**Step 1: Add memory-related test cases**

At the end of the `describe('AgentCore')` block, add a nested describe:

```typescript
describe('memory integration', () => {
  let mockMemoryManager: any;

  beforeEach(() => {
    mockMemoryManager = {
      search: vi.fn().mockReturnValue([]),
      store: vi.fn().mockResolvedValue('mem-id-1'),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockReturnValue([]),
    };
    setupMockModel();
    agentCore.setMemoryManager(mockMemoryManager);
  });

  it('injects memories into system prompt when search returns results', async () => {
    mockMemoryManager.search.mockReturnValue([
      { id: 'a', content: 'User prefers dark mode', title: 'dark mode', score: 1 },
      { id: 'b', content: 'User wakes at 7am', title: '7am', score: 0.8 },
    ]);

    await agentCore.query({ userQuery: 'What time should I set my alarm?' });

    const call = getAgentSystemCall();
    const systemPrompt = call[0].content as string;
    expect(systemPrompt).toContain('## What I remember about you');
    expect(systemPrompt).toContain('User prefers dark mode');
    expect(systemPrompt).toContain('User wakes at 7am');
  });

  it('does not inject memory block when search returns empty', async () => {
    mockMemoryManager.search.mockReturnValue([]);

    await agentCore.query({ userQuery: 'Hello' });

    const call = getAgentSystemCall();
    const systemPrompt = call[0].content as string;
    expect(systemPrompt).not.toContain('## What I remember about you');
  });

  it('executes memory.store tool and returns ok with id', async () => {
    replyQueue = [
      { content: '{"tool":"memory.store","params":{"fact":"User prefers bullet points"}}' },
      { content: 'Got it, I\'ll remember that.' },
    ];

    const result = await agentCore.query({ userQuery: 'I prefer bullet points' });
    expect(mockMemoryManager.store).toHaveBeenCalledWith('User prefers bullet points');
    expect(result.reply).toBe('Got it, I\'ll remember that.');
  });

  it('executes memory.delete tool and returns ok', async () => {
    replyQueue = [
      { content: '{"tool":"memory.delete","params":{"id":"mem-id-1"}}' },
      { content: 'Forgotten.' },
    ];

    await agentCore.query({ userQuery: 'Forget my dark mode preference' });
    expect(mockMemoryManager.delete).toHaveBeenCalledWith('mem-id-1');
  });

  it('returns error result when memory.store called without fact', async () => {
    replyQueue = [
      { content: '{"tool":"memory.store","params":{}}' },
      { content: 'Could not store.' },
    ];

    await agentCore.query({ userQuery: 'remember nothing' });
    const calls = mockInvoke.mock.calls.filter((args: any[]) => isAgentSystemCall(args[0]));
    const secondCall = calls[1];
    expect(JSON.stringify(secondCall)).toContain('"ok":false');
  });

  it('works without memory manager — no injection, no crash', async () => {
    agentCore = new AgentCore(modelManager);
    setupMockModel();
    const result = await agentCore.query({ userQuery: 'Hello' });
    expect(result.reply).toBeTruthy();
    const call = getAgentSystemCall();
    const systemPrompt = call[0].content as string;
    expect(systemPrompt).not.toContain('## What I remember about you');
  });
});
```

**Step 2: Run tests**

```bash
npm run test -- tests/sidecar/agent-core.test.ts 2>&1
```

Expected: all tests (existing + new) pass.

**Step 3: Run full test suite**

```bash
npm run test 2>&1
```

Expected: no regressions.

**Step 4: Commit**

```bash
git add tests/sidecar/agent-core.test.ts
git commit -m "test: add AgentCore memory integration tests"
```

---

## Done

All tasks complete. Verify the feature works end-to-end:

1. Run `npm run dev`
2. Tell the agent "I prefer responses in bullet points" (no explicit "remember")
3. Confirm a `★ Remembered:` chip appears in chat
4. Send a new message — confirm the memory block appears in system prompt (check logs)
5. Click `★ Memory` in the panel header — confirm the memory is listed
6. Delete the memory from the panel — confirm it's removed
