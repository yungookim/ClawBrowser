# Error-Aware Recovery Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add error-aware recovery to AgentCore and Swarm so the LLM can see and adapt to transient failures instead of dying silently.

**Architecture:** `isRetryable()` classifier + `invokeWithRecovery()` wrapper in AgentCore (reused by Swarm). On retryable error, the error message is injected into the LLM conversation context so it can change strategy. Max 2 retries. ConfigStore gains `agentRecovery` settings. Frontend shows "Retrying..." on `swarmRecoveryAttempted` notification.

**Tech Stack:** TypeScript, LangChain messages, vitest

---

### Task 1: Add `agentRecovery` to ConfigStore

**Files:**
- Modify: `sidecar/core/ConfigStore.ts:52-59` (AppConfig interface)
- Modify: `sidecar/core/ConfigStore.ts:65-99` (DEFAULT_CONFIG)
- Modify: `sidecar/core/ConfigStore.ts:213-253` (normalizeConfig)
- Test: `tests/sidecar/config-store.test.ts`

**Step 1: Write the failing test**

Add to `tests/sidecar/config-store.test.ts`:

```typescript
it('loads default agentRecovery settings', async () => {
  const store = new ConfigStore({ baseDir });
  const config = await store.load();

  expect(config.agentRecovery).toEqual({
    maxRetries: 2,
    enabled: true,
  });
});

it('updates agentRecovery settings', async () => {
  const store = new ConfigStore({ baseDir });
  await store.load();

  await store.update({ agentRecovery: { maxRetries: 0, enabled: false } });
  expect(store.get().agentRecovery).toEqual({ maxRetries: 0, enabled: false });
});

it('normalizes invalid agentRecovery to defaults', async () => {
  const store = new ConfigStore({ baseDir });
  await store.load();

  // Write garbage to config file
  const configPath = path.join(baseDir, '.clawbrowser', 'config.json');
  const raw = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  raw.agentRecovery = { maxRetries: 'banana', enabled: 42 };
  await fs.writeFile(configPath, JSON.stringify(raw));

  const store2 = new ConfigStore({ baseDir });
  const config = await store2.load();
  expect(config.agentRecovery.maxRetries).toBe(2);
  expect(config.agentRecovery.enabled).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/sidecar/config-store.test.ts`
Expected: FAIL — `agentRecovery` property doesn't exist on AppConfig

**Step 3: Implement ConfigStore changes**

In `sidecar/core/ConfigStore.ts`:

1. Add interface after `AgentControlSettings`:

```typescript
export interface AgentRecoverySettings {
  maxRetries: number;
  enabled: boolean;
}
```

2. Add to `AppConfig` interface:

```typescript
agentRecovery: AgentRecoverySettings;
```

3. Add to `DEFAULT_CONFIG`:

```typescript
agentRecovery: {
  maxRetries: 2,
  enabled: true,
},
```

4. Add `normalizeAgentRecovery` function:

```typescript
function normalizeAgentRecovery(value: unknown): AgentRecoverySettings {
  const data = isRecord(value) ? value : {};
  const maxRetriesRaw = Number(data.maxRetries);
  const maxRetries = Number.isFinite(maxRetriesRaw) && maxRetriesRaw >= 0
    ? Math.floor(maxRetriesRaw)
    : DEFAULT_CONFIG.agentRecovery.maxRetries;
  return {
    maxRetries,
    enabled: typeof data.enabled === 'boolean'
      ? data.enabled
      : DEFAULT_CONFIG.agentRecovery.enabled,
  };
}
```

5. Add to `normalizeConfig`:

```typescript
const agentRecovery = normalizeAgentRecovery(data.agentRecovery);
```

And include in the return object.

6. Add to `update()` method:

```typescript
agentRecovery: partial.agentRecovery
  ? normalizeAgentRecovery({ ...current.agentRecovery, ...partial.agentRecovery })
  : current.agentRecovery,
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/sidecar/config-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add sidecar/core/ConfigStore.ts tests/sidecar/config-store.test.ts
git commit -m "feat: add agentRecovery settings to ConfigStore"
```

---

### Task 2: Add `isRetryable` and `invokeWithRecovery` to AgentCore

**Files:**
- Modify: `sidecar/core/AgentCore.ts`
- Test: `tests/sidecar/agent-core.test.ts`

**Step 1: Write the failing tests**

Add to `tests/sidecar/agent-core.test.ts`:

```typescript
describe('error recovery', () => {
  it('retries on retryable error and injects error context to LLM', async () => {
    setupMockModel();

    let callCount = 0;
    mockInvoke.mockImplementation((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.resolve({ content: '{"role":"primary","complexity":"simple","reason":"default"}' });
      }
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('Request timeout'));
      }
      // Second call should have error context injected
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.content?.includes('previous model call failed')) {
        return Promise.resolve({ content: 'Recovered successfully' });
      }
      return Promise.resolve({ content: 'No recovery context' });
    });

    const response = await agentCore.query({ userQuery: 'Hello' });
    expect(response.reply).toBe('Recovered successfully');
  });

  it('throws immediately on non-retryable error', async () => {
    setupMockModel();

    mockInvoke.mockImplementation((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.resolve({ content: '{"role":"primary","complexity":"simple","reason":"default"}' });
      }
      return Promise.reject(new Error('Sidecar process exited'));
    });

    const response = await agentCore.query({ userQuery: 'Hello' });
    expect(response.reply).toContain('Error: Sidecar process exited');
  });

  it('gives up after max retries and returns error', async () => {
    setupMockModel();

    mockInvoke.mockImplementation((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.resolve({ content: '{"role":"primary","complexity":"simple","reason":"default"}' });
      }
      return Promise.reject(new Error('Request timeout'));
    });

    const response = await agentCore.query({ userQuery: 'Hello' });
    expect(response.reply).toContain('Error:');
    expect(response.reply).toContain('timeout');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/sidecar/agent-core.test.ts`
Expected: First test FAILS (no recovery, returns `Error: Request timeout` immediately). Third test might pass coincidentally since it already returns error.

**Step 3: Implement `isRetryable` and `invokeWithRecovery`**

In `sidecar/core/AgentCore.ts`:

1. Add at module level (after imports):

```typescript
const MAX_RECOVERY_RETRIES = 2;

interface ErrorContext {
  retryable: boolean;
  message: string;
  retriesAttempted: number;
  failedOperation: string;
}

function isRetryable(err: Error): boolean {
  const msg = err.message.toLowerCase();
  if (msg.includes('process exited') || msg.includes('not started') || msg.includes('not configured')) {
    return false;
  }
  return msg.includes('timeout') || msg.includes('rate') || msg.includes('429')
    || msg.includes('503') || msg.includes('500') || msg.includes('failed')
    || msg.includes('econnreset') || msg.includes('econnrefused');
}
```

2. Add `invokeWithRecovery` method to `AgentCore`:

```typescript
private async invokeWithRecovery(
  model: NonNullable<ReturnType<ModelManager['createModel']>>,
  messages: BaseMessage[],
  operation: string,
): Promise<{ content: string }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RECOVERY_RETRIES; attempt++) {
    try {
      const response = await model.invoke(messages);
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
      return { content };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      if (!isRetryable(error) || attempt >= MAX_RECOVERY_RETRIES) {
        throw error;
      }

      console.error(`[AgentCore] Retryable error on ${operation} (attempt ${attempt + 1}/${MAX_RECOVERY_RETRIES}): ${error.message}`);

      // Inject error context so the LLM can adapt
      messages = [
        ...messages,
        new HumanMessage(
          `The previous model call failed: ${error.message}. Adjust your approach — try a simpler action or different tool.`
        ),
      ];
    }
  }

  throw lastError || new Error('Recovery exhausted');
}
```

3. Update `invokeWithTools` to use `invokeWithRecovery` instead of bare `model.invoke`:

Replace line ~208:
```typescript
// Old:
const response = await model.invoke(currentMessages);
const content = typeof response.content === 'string'
  ? response.content
  : JSON.stringify(response.content);

// New:
const { content } = await this.invokeWithRecovery(model, currentMessages, `invokeWithTools iteration ${i}`);
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/sidecar/agent-core.test.ts`
Expected: PASS (all tests including new ones)

**Step 5: Commit**

```bash
git add sidecar/core/AgentCore.ts tests/sidecar/agent-core.test.ts
git commit -m "feat: add error-aware recovery to AgentCore"
```

---

### Task 3: Add recovery to Swarm nodes

**Files:**
- Modify: `sidecar/core/Swarm.ts`
- Test: `tests/sidecar/swarm.test.ts`

**Step 1: Write the failing tests**

Add to `tests/sidecar/swarm.test.ts`:

```typescript
describe('error recovery', () => {
  it('retries executor model call on retryable error', async () => {
    let callCount = 0;
    const model = {
      invoke: vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('Request timeout'));
        return Promise.resolve({ content: 'Recovered result' });
      }),
    };
    modelManager.createModel.mockImplementation((role: string) =>
      role === 'subagent' ? model : undefined,
    );

    const result = await (swarm as any).executorNode({
      task: 'Task',
      plan: ['Do step'],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
      totalStepsExecuted: 0,
    });

    expect(result.stepResults[0]).toBe('Recovered result');
    expect(model.invoke).toHaveBeenCalledTimes(2);
  });

  it('retries planner model call on retryable error', async () => {
    let callCount = 0;
    const model = {
      invoke: vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('503 Service Unavailable'));
        return Promise.resolve({ content: '["Step A"]' });
      }),
    };
    modelManager.createModel.mockReturnValue(model);

    const result = await (swarm as any).plannerNode({
      task: 'Task',
      plan: [],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
    });

    expect(result.plan).toEqual(['Step A']);
    expect(model.invoke).toHaveBeenCalledTimes(2);
  });

  it('emits swarmRecoveryAttempted notification on retry', async () => {
    const notify = vi.fn();
    const toolSwarm = new Swarm(modelManager as any, undefined, undefined, undefined, notify);

    let callCount = 0;
    const model = {
      invoke: vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('Request timeout'));
        return Promise.resolve({ content: 'Recovered' });
      }),
    };
    modelManager.createModel.mockImplementation((role: string) =>
      role === 'subagent' ? model : undefined,
    );

    await (toolSwarm as any).executorNode({
      task: 'Task',
      plan: ['Step'],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
      totalStepsExecuted: 0,
    });

    expect(notify).toHaveBeenCalledWith('swarmRecoveryAttempted', expect.objectContaining({
      operation: expect.any(String),
      error: 'Request timeout',
      attempt: 1,
    }));
  });

  it('does not retry non-retryable errors in executor', async () => {
    const model = {
      invoke: vi.fn().mockRejectedValue(new Error('Sidecar process exited')),
    };
    modelManager.createModel.mockImplementation((role: string) =>
      role === 'subagent' ? model : undefined,
    );

    const result = await (swarm as any).executorNode({
      task: 'Task',
      plan: ['Do step'],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
      totalStepsExecuted: 0,
    });

    expect(result.stepResults[0]).toContain('Error: Sidecar process exited');
    expect(model.invoke).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/sidecar/swarm.test.ts`
Expected: FAIL — executor doesn't retry, model.invoke called only 1 time

**Step 3: Implement Swarm recovery**

In `sidecar/core/Swarm.ts`:

1. Add at module level (after imports, same as AgentCore):

```typescript
const MAX_RECOVERY_RETRIES = 2;

function isRetryable(err: Error): boolean {
  const msg = err.message.toLowerCase();
  if (msg.includes('process exited') || msg.includes('not started') || msg.includes('not configured')) {
    return false;
  }
  return msg.includes('timeout') || msg.includes('rate') || msg.includes('429')
    || msg.includes('503') || msg.includes('500') || msg.includes('failed')
    || msg.includes('econnreset') || msg.includes('econnrefused');
}
```

2. Add `invokeWithRecovery` method to `Swarm`:

```typescript
private async invokeWithRecovery(
  model: { invoke: (messages: BaseMessage[]) => Promise<{ content: string | unknown }> },
  messages: BaseMessage[],
  operation: string,
  maxRetries: number = MAX_RECOVERY_RETRIES,
): Promise<string> {
  let lastError: Error | null = null;
  let currentMessages = [...messages];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await model.invoke(currentMessages);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      if (!isRetryable(error) || attempt >= maxRetries) {
        throw error;
      }

      console.error(`[Swarm] Retryable error on ${operation} (attempt ${attempt + 1}/${maxRetries}): ${error.message}`);

      this.sendNotification('swarmRecoveryAttempted', {
        operation,
        error: error.message,
        attempt: attempt + 1,
        maxRetries,
      });

      currentMessages = [
        ...currentMessages,
        new HumanMessage(
          `The previous call failed: ${error.message}. Adjust your approach.`
        ),
      ];
    }
  }

  throw lastError || new Error('Recovery exhausted');
}
```

3. Update `executorNode` — replace bare `model.invoke(messages)` calls with `this.invokeWithRecovery(model, messages, 'executor')`. There are two call sites in executorNode:
   - The text-only fallback path (line ~294): wrap in try/catch using invokeWithRecovery
   - The tool-enabled loop (line ~352): wrap `model.invoke(messages)` with invokeWithRecovery

4. Update `plannerNode` — wrap `model.invoke(messages)` with `this.invokeWithRecovery(model, messages, 'planner', 1)` (1 retry for planning nodes).

5. Update `evaluatorNode` — wrap `model.invoke(...)` with `this.invokeWithRecovery(model, [...], 'evaluator', 1)`.

6. Update `replannerNode` — wrap `model.invoke(...)` with `this.invokeWithRecovery(model, [...], 'replanner', 1)`.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/sidecar/swarm.test.ts`
Expected: PASS (all tests including new recovery tests)

**Step 5: Run full sidecar test suite**

Run: `npm test -- tests/sidecar/`
Expected: PASS (no regressions)

**Step 6: Commit**

```bash
git add sidecar/core/Swarm.ts tests/sidecar/swarm.test.ts
git commit -m "feat: add error-aware recovery to Swarm nodes"
```

---

### Task 4: Handle `swarmRecoveryAttempted` in AgentPanel

**Files:**
- Modify: `src/agent/AgentPanel.ts:20-49` (notification handler)
- Modify: `src/agent/ChatView.ts` (add `showRecoveryIndicator` method)
- Test: `tests/frontend/agent-panel.test.ts`

**Step 1: Write the failing test**

Add to `tests/frontend/agent-panel.test.ts`:

First, add to `chatMocks`:
```typescript
showRecoveryIndicator: vi.fn(),
```

And add it to the mock class, then add the test:

```typescript
it('shows recovery indicator on swarmRecoveryAttempted', () => {
  const bridge = {
    agentQuery: vi.fn().mockResolvedValue('done'),
    onNotification: (handler: (method: string, params: Record<string, unknown>) => void) => {
      notificationHandler = handler;
    },
  } as any;

  const tabManager = { getActiveTab: () => null, getTabs: () => [] } as any;
  const container = document.createElement('div');
  new AgentPanel(container, bridge, tabManager);

  notificationHandler?.('swarmRecoveryAttempted', {
    operation: 'executor',
    error: 'Request timeout',
    attempt: 1,
    maxRetries: 2,
  });

  expect(chatMocks.addToolActivity).toHaveBeenCalledWith(
    expect.any(Number),
    'recovery',
    expect.stringContaining('Retrying'),
  );
});
```

Actually, since the recovery can happen outside of an active step context, let's keep it simpler — just add a message:

```typescript
it('shows retry message on swarmRecoveryAttempted', () => {
  const bridge = {
    agentQuery: vi.fn().mockResolvedValue('done'),
    onNotification: (handler: (method: string, params: Record<string, unknown>) => void) => {
      notificationHandler = handler;
    },
  } as any;

  const tabManager = { getActiveTab: () => null, getTabs: () => [] } as any;
  const container = document.createElement('div');
  new AgentPanel(container, bridge, tabManager);

  notificationHandler?.('swarmRecoveryAttempted', {
    operation: 'executor',
    error: 'Request timeout',
    attempt: 1,
    maxRetries: 2,
  });

  expect(chatMocks.addMessage).toHaveBeenCalledWith('agent', expect.stringContaining('Retrying'));
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/frontend/agent-panel.test.ts`
Expected: FAIL — no handler for `swarmRecoveryAttempted`

**Step 3: Implement the handler**

In `src/agent/AgentPanel.ts`, add to the notification handler (after `swarmComplete`):

```typescript
} else if (method === 'swarmRecoveryAttempted') {
  const { operation, error, attempt, maxRetries } = params as {
    operation: string;
    error: string;
    attempt: number;
    maxRetries: number;
  };
  this.chatView.addMessage('agent', `Retrying ${operation} (attempt ${attempt}/${maxRetries}): ${error}`);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/frontend/agent-panel.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/AgentPanel.ts tests/frontend/agent-panel.test.ts
git commit -m "feat: show recovery status in AgentPanel"
```

---

### Task 5: Integration verification

**Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass (pre-existing failures in command-executor, vault-ui, wizard, main are known)

**Step 2: Verify the exported types**

Ensure `AgentRecoverySettings` is exported from `ConfigStore.ts` and available to consumers.

**Step 3: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: fixups from integration verification"
```
