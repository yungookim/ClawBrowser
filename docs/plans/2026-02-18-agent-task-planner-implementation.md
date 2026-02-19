# Multi-Step Agent Task Planner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve the agent from single-tool-call to multi-step task planning and execution, so complex queries like "summarize the top 5 silver price headlines" decompose into planned steps that each execute browser tools.

**Architecture:** Enhance existing `Swarm` (LangGraph planner/executor/synthesizer) with tool execution in executor nodes. Add LLM-based complexity router in `AgentCore` to classify queries as simple (multi-tool loop, max 5) or complex (full Swarm pipeline). Frontend shows plan + step-by-step progress.

**Tech Stack:** TypeScript, LangGraph, Vitest, JSON-RPC 2.0 notifications

---

### Task 1: AgentCore — Combined Router (classifyAndRoute)

**Files:**
- Modify: `sidecar/core/AgentCore.ts:123-160` (replace `selectRole`)
- Test: `tests/sidecar/agent-core.test.ts`

**Step 1: Write the failing test for classifyAndRoute**

Add to `tests/sidecar/agent-core.test.ts`:

```typescript
it('classifies simple queries as simple complexity', async () => {
  setupMockModel();
  mockInvoke.mockImplementation((messages: any[]) => {
    if (isRoutingCall(messages)) {
      return Promise.resolve({
        content: '{"role":"primary","complexity":"simple","reason":"direct question"}',
      });
    }
    return Promise.resolve({ content: 'Response' });
  });

  const result = await (agentCore as any).classifyAndRoute({
    userQuery: 'What time is it?',
  });

  expect(result).toEqual({
    role: 'primary',
    complexity: 'simple',
    reason: 'direct question',
  });
});

it('classifies multi-step queries as complex', async () => {
  setupMockModel();
  mockInvoke.mockImplementation((messages: any[]) => {
    if (isRoutingCall(messages)) {
      return Promise.resolve({
        content: '{"role":"primary","complexity":"complex","reason":"needs search and summarize"}',
      });
    }
    return Promise.resolve({ content: 'Response' });
  });

  const result = await (agentCore as any).classifyAndRoute({
    userQuery: 'Search for silver price news and summarize the top 5',
  });

  expect(result).toEqual({
    role: 'primary',
    complexity: 'complex',
    reason: 'needs search and summarize',
  });
});

it('defaults to simple when router fails', async () => {
  setupMockModel();
  mockInvoke.mockImplementation((messages: any[]) => {
    if (isRoutingCall(messages)) {
      return Promise.reject(new Error('API error'));
    }
    return Promise.resolve({ content: 'Response' });
  });

  const result = await (agentCore as any).classifyAndRoute({
    userQuery: 'Hello',
  });

  expect(result.complexity).toBe('simple');
  expect(result.role).toBe('primary');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sidecar/agent-core.test.ts --reporter=verbose`
Expected: FAIL — `classifyAndRoute` is not a function

**Step 3: Implement classifyAndRoute in AgentCore**

In `sidecar/core/AgentCore.ts`, add the `RouteDecision` interface and replace `selectRole` with `classifyAndRoute`:

```typescript
export interface RouteDecision {
  role: ModelRole;
  complexity: 'simple' | 'complex';
  reason: string;
}

// Replace selectRole() with:
async classifyAndRoute(context: AgentContext): Promise<RouteDecision> {
  const router = this.modelManager.createModel('primary');
  if (!router) return { role: 'primary', complexity: 'simple', reason: 'no model' };

  const routingPrompt = [
    'You are a router that classifies requests and selects which model should handle them.',
    'Choose a role: primary (main chat), secondary (fast/simple), subagent (hard/deep).',
    'Choose complexity: simple (single action or direct answer) or complex (needs multiple sequential browser actions, research, or multi-page browsing).',
    'Examples of complex: "search for X and summarize", "find the cheapest flight", "compare prices across sites".',
    'Examples of simple: "what page am I on", "open google.com", "hello", "what is 2+2".',
    'Respond ONLY with JSON: {"role":"primary|secondary|subagent","complexity":"simple|complex","reason":"..."}',
  ].join('\n');

  const contextBits = [
    context.activeTabTitle ? `Active tab: ${context.activeTabTitle}` : '',
    context.activeTabUrl ? `Active URL: ${context.activeTabUrl}` : '',
    context.tabCount !== undefined ? `Open tabs: ${context.tabCount}` : '',
    `User query: ${context.userQuery}`,
  ].filter(Boolean).join('\n');

  try {
    const response = await router.invoke([
      new SystemMessage(routingPrompt),
      new HumanMessage(contextBits),
    ]);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
    const parsed = this.safeJsonParse(content);
    const role = parsed?.role as ModelRole | undefined;
    const complexity = parsed?.complexity as 'simple' | 'complex' | undefined;
    if ((role === 'primary' || role === 'secondary' || role === 'subagent')
      && (complexity === 'simple' || complexity === 'complex')) {
      return { role, complexity, reason: String(parsed?.reason || '') };
    }
  } catch (err) {
    console.error('[AgentCore] Routing error:', err);
  }
  return { role: 'primary', complexity: 'simple', reason: 'fallback' };
}
```

Also update `query()` to call `classifyAndRoute` instead of `selectRole`:

```typescript
async query(context: AgentContext): Promise<AgentResponse> {
  const systemPrompt = this.buildSystemPrompt(context);
  const route = await this.classifyAndRoute(context);
  const model = this.pickModel(route.role);
  // ... rest unchanged for now
}
```

Update the routing-call detection in tests — the new prompt says "router that classifies" instead of "router that selects which model". Update `isRoutingCall`:

```typescript
function isRoutingCall(messages: any[]): boolean {
  const first = messages?.[0];
  return Boolean(first && typeof first.content === 'string'
    && (first.content.includes('router that selects which model')
      || first.content.includes('router that classifies')));
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sidecar/agent-core.test.ts --reporter=verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add sidecar/core/AgentCore.ts tests/sidecar/agent-core.test.ts
git commit -m "feat: add classifyAndRoute to AgentCore for simple/complex routing"
```

---

### Task 2: AgentCore — Multi-Tool Loop (Simple Path)

**Files:**
- Modify: `sidecar/core/AgentCore.ts:162-188` (replace `invokeWithTools`)
- Test: `tests/sidecar/agent-core.test.ts`

**Step 1: Write the failing test for multi-tool loop**

Add to `tests/sidecar/agent-core.test.ts`:

```typescript
it('executes multiple tool calls in a loop (simple path)', async () => {
  const dispatcher = {
    request: vi.fn()
      .mockResolvedValueOnce({ requestId: '1', ok: true, data: { tabId: 'tab1' } })
      .mockResolvedValueOnce({ requestId: '2', ok: true, data: { clicked: true } }),
  };

  const toolRegistry = {
    describeTools: vi.fn().mockReturnValue('- tab.create: Open a new tab.'),
    parseToolCall: vi.fn()
      .mockReturnValueOnce({
        kind: 'agent', tool: 'tab.create', capability: 'tab', action: 'create', params: { url: 'https://google.com' },
      })
      .mockReturnValueOnce({
        kind: 'agent', tool: 'dom.automation', capability: 'dom', action: 'automation', params: { actions: [] },
      })
      .mockReturnValueOnce(null), // no more tool calls
  };

  modelManager = new ModelManager();
  agentCore = new AgentCore(modelManager, undefined, toolRegistry as any, dispatcher as any);

  modelManager.configure({ provider: 'openai', model: 'gpt-4o', apiKey: 'k', role: 'primary' });

  let callCount = 0;
  vi.spyOn(modelManager, 'createModel').mockReturnValue({
    invoke: vi.fn((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.resolve({ content: '{"role":"primary","complexity":"simple","reason":"test"}' });
      }
      callCount++;
      if (callCount === 1) return Promise.resolve({ content: '{"tool":"tab.create","params":{"url":"https://google.com"}}' });
      if (callCount === 2) return Promise.resolve({ content: '{"tool":"dom.automation","params":{"actions":[]}}' });
      return Promise.resolve({ content: 'All done!' });
    }),
  } as any);

  const response = await agentCore.query({ userQuery: 'Open google and click search' });
  expect(response.reply).toBe('All done!');
  expect(dispatcher.request).toHaveBeenCalledTimes(2);
});

it('stops tool loop after max iterations (5)', async () => {
  const dispatcher = {
    request: vi.fn().mockResolvedValue({ requestId: '1', ok: true, data: {} }),
  };

  const toolRegistry = {
    describeTools: vi.fn().mockReturnValue('tools'),
    parseToolCall: vi.fn().mockReturnValue({
      kind: 'agent', tool: 'tab.create', capability: 'tab', action: 'create', params: {},
    }),
  };

  modelManager = new ModelManager();
  agentCore = new AgentCore(modelManager, undefined, toolRegistry as any, dispatcher as any);
  modelManager.configure({ provider: 'openai', model: 'gpt-4o', apiKey: 'k', role: 'primary' });

  vi.spyOn(modelManager, 'createModel').mockReturnValue({
    invoke: vi.fn((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.resolve({ content: '{"role":"primary","complexity":"simple","reason":"test"}' });
      }
      // Always return a tool call — should hit max iterations
      return Promise.resolve({ content: '{"tool":"tab.create","params":{}}' });
    }),
  } as any);

  const response = await agentCore.query({ userQuery: 'Loop forever' });
  // Should have stopped after 5 tool calls and returned last LLM content
  expect(dispatcher.request).toHaveBeenCalledTimes(5);
  expect(response.reply).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sidecar/agent-core.test.ts --reporter=verbose`
Expected: FAIL — current `invokeWithTools` only does 1 tool call

**Step 3: Replace invokeWithTools with a multi-tool loop**

In `sidecar/core/AgentCore.ts`, replace `invokeWithTools`:

```typescript
private static readonly MAX_SIMPLE_TOOL_ITERATIONS = 5;

private async invokeWithTools(
  model: NonNullable<ReturnType<ModelManager['createModel']>>,
  messages: BaseMessage[],
): Promise<string> {
  let currentMessages = [...messages];
  let lastContent = '';

  for (let i = 0; i < AgentCore.MAX_SIMPLE_TOOL_ITERATIONS; i++) {
    const response = await model.invoke(currentMessages);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
    lastContent = content;

    const toolCall = this.toolRegistry.parseToolCall(content);
    if (!toolCall) {
      return content;
    }

    const toolResult = await this.executeToolCall(toolCall);

    currentMessages = [
      ...currentMessages,
      new AIMessage(content),
      new HumanMessage(JSON.stringify(toolResult)),
    ];
  }

  // Max iterations reached — return whatever the LLM last said
  return lastContent;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sidecar/agent-core.test.ts --reporter=verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add sidecar/core/AgentCore.ts tests/sidecar/agent-core.test.ts
git commit -m "feat: multi-tool loop in AgentCore simple path (max 5 iterations)"
```

---

### Task 3: Swarm — Accept Tool Dependencies

**Files:**
- Modify: `sidecar/core/Swarm.ts:50-57` (constructor + execute signature)
- Test: `tests/sidecar/swarm.test.ts`

**Step 1: Write the failing test for new constructor**

Add to `tests/sidecar/swarm.test.ts`:

```typescript
it('accepts tool dependencies in constructor', () => {
  const toolRegistry = { describeTools: vi.fn().mockReturnValue('tools'), parseToolCall: vi.fn() };
  const dispatcher = { request: vi.fn() };
  const executor = { execute: vi.fn() };
  const notify = vi.fn();

  const toolSwarm = new Swarm(modelManager as any, toolRegistry as any, dispatcher as any, executor as any, notify);
  expect(toolSwarm).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sidecar/swarm.test.ts --reporter=verbose`
Expected: FAIL — Swarm constructor only takes modelManager

**Step 3: Update Swarm constructor**

In `sidecar/core/Swarm.ts`:

```typescript
import type { ToolRegistry, ParsedToolCall } from './ToolRegistry.js';
import type { AgentDispatcher } from './AgentDispatcher.js';
import type { CommandExecutor } from './CommandExecutor.js';

type Notify = (method: string, params?: Record<string, unknown>) => void;

export interface SwarmBrowserContext {
  activeTabUrl?: string;
  activeTabTitle?: string;
  tabCount?: number;
}

export class Swarm {
  private modelManager: ModelManager;
  private toolRegistry: ToolRegistry | null;
  private dispatcher: AgentDispatcher | null;
  private commandExecutor: CommandExecutor | null;
  private notify: Notify | null;
  private aborted = false;

  constructor(
    modelManager: ModelManager,
    toolRegistry?: ToolRegistry,
    dispatcher?: AgentDispatcher,
    commandExecutor?: CommandExecutor,
    notify?: Notify,
  ) {
    this.modelManager = modelManager;
    this.toolRegistry = toolRegistry || null;
    this.dispatcher = dispatcher || null;
    this.commandExecutor = commandExecutor || null;
    this.notify = notify || null;
  }

  cancel(): void {
    this.aborted = true;
  }

  async execute(
    task: string,
    context: Record<string, string> = {},
    browserContext?: SwarmBrowserContext,
  ): Promise<string> {
    this.aborted = false;
    // ... rest of existing execute(), pass browserContext into state
  }
}
```

Also update `boot()` in `sidecar/main.ts` to pass the new dependencies:

```typescript
swarm = new Swarm(modelManager, toolRegistry, agentDispatcher, commandExecutor, sendNotification);
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sidecar/swarm.test.ts --reporter=verbose`
Expected: ALL PASS (existing tests still work because new params are optional)

**Step 5: Fix existing test that constructs Swarm with old signature**

The existing `beforeEach` creates `new Swarm(modelManager as any)` — this still works since new params are optional. Verify all existing tests pass.

Run: `npx vitest run tests/sidecar/swarm.test.ts --reporter=verbose`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add sidecar/core/Swarm.ts sidecar/main.ts tests/sidecar/swarm.test.ts
git commit -m "feat: Swarm accepts tool dependencies and cancel method"
```

---

### Task 4: Swarm — Tool-Enabled Executor Node

**Files:**
- Modify: `sidecar/core/Swarm.ts:136-189` (executorNode)
- Test: `tests/sidecar/swarm.test.ts`

**Step 1: Write the failing test for tool execution in executor**

Add to `tests/sidecar/swarm.test.ts`:

```typescript
describe('tool-enabled executor', () => {
  it('executes tool calls within a step', async () => {
    const toolRegistry = {
      describeTools: vi.fn().mockReturnValue('- tab.navigate: Navigate.'),
      parseToolCall: vi.fn()
        .mockReturnValueOnce({
          kind: 'agent', tool: 'tab.navigate', capability: 'tab', action: 'navigate',
          params: { url: 'https://google.com' },
        })
        .mockReturnValueOnce(null), // second LLM call has no tool
    };
    const dispatcher = {
      request: vi.fn().mockResolvedValue({ requestId: '1', ok: true, data: { tabId: 't1' } }),
    };
    const notify = vi.fn();

    const toolSwarm = new Swarm(
      modelManager as any, toolRegistry as any, dispatcher as any, undefined, notify,
    );

    let callCount = 0;
    const model = {
      invoke: vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ content: '{"tool":"tab.navigate","params":{"url":"https://google.com"}}' });
        return Promise.resolve({ content: 'Navigated to Google successfully.' });
      }),
    };
    modelManager.createModel.mockImplementation((role: string) =>
      role === 'subagent' ? model : undefined,
    );

    const result = await (toolSwarm as any).executorNode({
      task: 'Search Google',
      plan: ['Navigate to Google'],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
    });

    expect(dispatcher.request).toHaveBeenCalledTimes(1);
    expect(result.stepResults[0]).toContain('Navigated to Google');
    expect(result.currentStep).toBe(1);
  });

  it('respects max tool iterations per step (10)', async () => {
    const toolRegistry = {
      describeTools: vi.fn().mockReturnValue('tools'),
      parseToolCall: vi.fn().mockReturnValue({
        kind: 'agent', tool: 'tab.create', capability: 'tab', action: 'create', params: {},
      }),
    };
    const dispatcher = {
      request: vi.fn().mockResolvedValue({ requestId: '1', ok: true, data: {} }),
    };
    const notify = vi.fn();

    const toolSwarm = new Swarm(
      modelManager as any, toolRegistry as any, dispatcher as any, undefined, notify,
    );

    const model = {
      invoke: vi.fn().mockResolvedValue({ content: '{"tool":"tab.create","params":{}}' }),
    };
    modelManager.createModel.mockImplementation((role: string) =>
      role === 'subagent' ? model : undefined,
    );

    const result = await (toolSwarm as any).executorNode({
      task: 'Loop task',
      plan: ['Looping step'],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
    });

    expect(dispatcher.request).toHaveBeenCalledTimes(10);
    expect(result.currentStep).toBe(1);
  });

  it('sends progress notifications during execution', async () => {
    const toolRegistry = {
      describeTools: vi.fn().mockReturnValue('tools'),
      parseToolCall: vi.fn().mockReturnValueOnce(null),
    };
    const notify = vi.fn();

    const toolSwarm = new Swarm(
      modelManager as any, toolRegistry as any, undefined, undefined, notify,
    );

    const model = {
      invoke: vi.fn().mockResolvedValue({ content: 'Done with step' }),
    };
    modelManager.createModel.mockImplementation((role: string) =>
      role === 'subagent' ? model : undefined,
    );

    await (toolSwarm as any).executorNode({
      task: 'Task',
      plan: ['Do thing'],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
    });

    expect(notify).toHaveBeenCalledWith('swarmStepStarted', expect.objectContaining({
      stepIndex: 0,
    }));
    expect(notify).toHaveBeenCalledWith('swarmStepCompleted', expect.objectContaining({
      stepIndex: 0,
    }));
  });

  it('stops execution when aborted', async () => {
    const toolRegistry = {
      describeTools: vi.fn().mockReturnValue('tools'),
      parseToolCall: vi.fn().mockReturnValue({
        kind: 'agent', tool: 'tab.create', capability: 'tab', action: 'create', params: {},
      }),
    };
    const dispatcher = {
      request: vi.fn().mockResolvedValue({ requestId: '1', ok: true, data: {} }),
    };
    const notify = vi.fn();

    const toolSwarm = new Swarm(
      modelManager as any, toolRegistry as any, dispatcher as any, undefined, notify,
    );

    const model = {
      invoke: vi.fn().mockImplementation(() => {
        // Cancel after first call
        toolSwarm.cancel();
        return Promise.resolve({ content: '{"tool":"tab.create","params":{}}' });
      }),
    };
    modelManager.createModel.mockImplementation((role: string) =>
      role === 'subagent' ? model : undefined,
    );

    const result = await (toolSwarm as any).executorNode({
      task: 'Task',
      plan: ['Step'],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
    });

    // Should have stopped after 1 tool call due to abort
    expect(dispatcher.request).toHaveBeenCalledTimes(1);
    expect(result.currentStep).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sidecar/swarm.test.ts --reporter=verbose`
Expected: FAIL — executor doesn't call dispatcher

**Step 3: Implement tool-enabled executor node**

Replace `executorNode` in `sidecar/core/Swarm.ts`:

```typescript
private static readonly MAX_TOOL_ITERATIONS_PER_STEP = 10;

private async executorNode(state: SwarmStateType): Promise<Partial<SwarmStateType>> {
  const model = this.modelManager.createModel('subagent')
    || this.modelManager.createModel('primary');

  if (!model) {
    return {
      stepResults: [`[Step ${state.currentStep + 1}] No model available`],
      currentStep: state.currentStep + 1,
    };
  }

  const step = state.plan[state.currentStep];

  // Notify step started
  this.notify?.('swarmStepStarted', {
    stepIndex: state.currentStep,
    description: step,
    totalSteps: state.plan.length,
  });

  const previousSteps = state.stepResults
    .map((r, i) => `Step ${i + 1}: ${r}`)
    .join('\n');

  const contextStr = Object.entries(state.context)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const toolDescriptions = this.toolRegistry?.describeTools() || '';

  const systemPrompt = [
    EXECUTOR_SYSTEM_PROMPT,
    toolDescriptions ? `\nAvailable tools:\n${toolDescriptions}` : '',
    'If you need to perform an action, respond ONLY with a single JSON tool call.',
    'Format: {"tool":"<tool-name>","params":{...}}',
    'When the step is complete, respond with a text summary (no JSON).',
  ].filter(Boolean).join('\n');

  const userMessage = [
    `Overall task: ${state.task}`,
    contextStr ? `\nContext:\n${contextStr}` : '',
    previousSteps ? `\nCompleted steps:\n${previousSteps}` : '',
    `\nCurrent step (${state.currentStep + 1}/${state.plan.length}): ${step}`,
  ].filter(Boolean).join('\n');

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage),
  ];

  let lastContent = '';

  try {
    for (let i = 0; i < Swarm.MAX_TOOL_ITERATIONS_PER_STEP; i++) {
      if (this.aborted) break;

      const response = await model.invoke(messages);
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
      lastContent = content;

      const toolCall = this.toolRegistry?.parseToolCall(content);
      if (!toolCall) {
        // No tool call — step is done
        break;
      }

      const toolResult = await this.executeToolCall(toolCall);

      this.notify?.('swarmToolExecuted', {
        stepIndex: state.currentStep,
        tool: toolCall.kind === 'invalid' ? (toolCall.tool || 'unknown') : toolCall.tool,
        ok: toolResult.ok,
      });

      messages.push(new AIMessage(content));
      messages.push(new HumanMessage(JSON.stringify(toolResult)));
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Swarm/Executor] Step ${state.currentStep + 1} error:`, errMsg);
    lastContent = `Error: ${errMsg}`;
  }

  console.error(`[Swarm/Executor] Step ${state.currentStep + 1} complete`);

  this.notify?.('swarmStepCompleted', {
    stepIndex: state.currentStep,
    result: lastContent.substring(0, 200),
  });

  return {
    stepResults: [lastContent],
    currentStep: state.currentStep + 1,
  };
}

private async executeToolCall(toolCall: ParsedToolCall): Promise<{
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}> {
  if (toolCall.kind === 'invalid') {
    return { tool: toolCall.tool || 'unknown', ok: false, error: toolCall.error };
  }

  if (toolCall.kind === 'terminal') {
    if (!this.commandExecutor) {
      return { tool: toolCall.tool, ok: false, error: 'Command execution unavailable.' };
    }
    try {
      const result = await this.commandExecutor.execute(toolCall.command, toolCall.args, toolCall.cwd);
      return { tool: toolCall.tool, ok: result.exitCode === 0, ...result };
    } catch (err) {
      return { tool: toolCall.tool, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (!this.dispatcher) {
    return { tool: toolCall.tool, ok: false, error: 'Agent dispatcher unavailable.' };
  }

  try {
    const result = await this.dispatcher.request({
      capability: toolCall.capability,
      action: toolCall.action,
      params: toolCall.params,
      destructive: toolCall.destructive,
    });
    if (result.ok) {
      return { tool: toolCall.tool, ok: true, data: result.data };
    }
    return { tool: toolCall.tool, ok: false, error: result.error?.message || 'Action failed' };
  } catch (err) {
    return { tool: toolCall.tool, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sidecar/swarm.test.ts --reporter=verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add sidecar/core/Swarm.ts tests/sidecar/swarm.test.ts
git commit -m "feat: tool-enabled Swarm executor with loop, notifications, and cancel"
```

---

### Task 5: Swarm — Enhanced Planner with Tool Descriptions

**Files:**
- Modify: `sidecar/core/Swarm.ts:94-133` (plannerNode)
- Test: `tests/sidecar/swarm.test.ts`

**Step 1: Write the failing test**

Add to `tests/sidecar/swarm.test.ts`:

```typescript
it('includes tool descriptions in planner prompt', async () => {
  const toolRegistry = {
    describeTools: vi.fn().mockReturnValue('- tab.create: Open a new tab.\n- tab.navigate: Navigate.'),
    parseToolCall: vi.fn(),
  };
  const notify = vi.fn();

  const toolSwarm = new Swarm(modelManager as any, toolRegistry as any, undefined, undefined, notify);

  const model = { invoke: vi.fn().mockResolvedValue({ content: '["Step 1"]' }) };
  modelManager.createModel.mockReturnValue(model);

  await (toolSwarm as any).plannerNode({
    task: 'Do something',
    plan: [],
    currentStep: 0,
    stepResults: [],
    finalResult: '',
    context: {},
  });

  const systemMsg = model.invoke.mock.calls[0][0][0];
  expect(systemMsg.content).toContain('tab.create');
  expect(systemMsg.content).toContain('tab.navigate');
});

it('sends swarmPlanReady notification', async () => {
  const notify = vi.fn();
  const toolSwarm = new Swarm(modelManager as any, undefined, undefined, undefined, notify);

  const model = { invoke: vi.fn().mockResolvedValue({ content: '["Step A", "Step B"]' }) };
  modelManager.createModel.mockReturnValue(model);

  await (toolSwarm as any).plannerNode({
    task: 'Task',
    plan: [],
    currentStep: 0,
    stepResults: [],
    finalResult: '',
    context: {},
  });

  expect(notify).toHaveBeenCalledWith('swarmPlanReady', {
    steps: ['Step A', 'Step B'],
    task: 'Task',
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sidecar/swarm.test.ts --reporter=verbose`
Expected: FAIL — planner doesn't include tools or send notification

**Step 3: Update plannerNode**

In `sidecar/core/Swarm.ts`, update `plannerNode`:

```typescript
private async plannerNode(state: SwarmStateType): Promise<Partial<SwarmStateType>> {
  const model = this.modelManager.createModel('primary');
  if (!model) {
    return { plan: [state.task], currentStep: 0 };
  }

  const toolDescriptions = this.toolRegistry?.describeTools() || '';

  const systemPrompt = [
    PLANNER_SYSTEM_PROMPT,
    toolDescriptions ? `\nAvailable browser tools:\n${toolDescriptions}` : '',
    'Plan steps that use these tools to accomplish the task.',
  ].filter(Boolean).join('\n');

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(state.task),
  ];

  try {
    const response = await model.invoke(messages);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const steps: string[] = JSON.parse(jsonMatch[0]);
      console.error(`[Swarm/Planner] ${steps.length} steps planned`);

      this.notify?.('swarmPlanReady', { steps, task: state.task });

      return { plan: steps, currentStep: 0 };
    }
  } catch (err) {
    console.error('[Swarm/Planner] Error:', err);
  }

  return { plan: [state.task], currentStep: 0 };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sidecar/swarm.test.ts --reporter=verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add sidecar/core/Swarm.ts tests/sidecar/swarm.test.ts
git commit -m "feat: Swarm planner includes tool descriptions and sends plan notification"
```

---

### Task 6: Sidecar Main — Route Complex Queries to Swarm

**Files:**
- Modify: `sidecar/main.ts:267-292` (agentQuery handler)
- Modify: `sidecar/main.ts:139-140` (Swarm constructor call)
- Add handler: `swarmCancel`
- Test: (manual integration — the unit tests for routing are in AgentCore)

**Step 1: Update Swarm construction in boot()**

In `sidecar/main.ts`, update the `boot()` function where Swarm is constructed:

```typescript
// Change from:
swarm = new Swarm(modelManager);
// To:
swarm = new Swarm(modelManager, toolRegistry, agentDispatcher, commandExecutor, sendNotification);
```

**Step 2: Expose classifyAndRoute from AgentCore**

Make `classifyAndRoute` public in `AgentCore.ts` (change `async classifyAndRoute` — it should already be public from Task 1, verify).

**Step 3: Update agentQuery handler to route complex queries**

In `sidecar/main.ts`, modify the `agentQuery` handler:

```typescript
handlers.set('agentQuery', async (params) => {
  const userQuery = params.userQuery as string || '';
  const activeTabUrl = params.activeTabUrl as string | undefined;
  const activeTabTitle = params.activeTabTitle as string | undefined;
  const tabCount = params.tabCount as number | undefined;

  await dailyLog.log(`User query: ${userQuery}`);

  const workspaceFiles = await workspace.loadAll();

  const context = {
    userQuery,
    activeTabUrl,
    activeTabTitle,
    tabCount,
    workspaceFiles,
  };

  // Route based on complexity
  const route = await agentCore.classifyAndRoute(context);

  let response: { reply: string };

  if (route.complexity === 'complex') {
    console.error(`[sidecar] Routing to Swarm (reason: ${route.reason})`);
    const result = await swarm.execute(userQuery, {}, {
      activeTabUrl,
      activeTabTitle,
      tabCount,
    });
    sendNotification('swarmComplete', { task: userQuery });
    response = { reply: result };
  } else {
    response = await agentCore.query(context);
  }

  await dailyLog.log(`Agent reply: ${response.reply.substring(0, 100)}...`);
  return response;
});
```

**Step 4: Add swarmCancel handler**

```typescript
handlers.set('swarmCancel', async () => {
  swarm.cancel();
  return { status: 'ok' };
});
```

**Step 5: Run all sidecar tests**

Run: `npx vitest run tests/sidecar/ --reporter=verbose`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add sidecar/main.ts sidecar/core/AgentCore.ts
git commit -m "feat: route complex queries to Swarm, add swarmCancel handler"
```

---

### Task 7: SidecarBridge — Add swarmCancel Method

**Files:**
- Modify: `src/agent/SidecarBridge.ts`
- Test: `tests/agent/sidecar-bridge.test.ts`

**Step 1: Write the failing test**

Add to `tests/agent/sidecar-bridge.test.ts`:

```typescript
it('sends swarmCancel request', async () => {
  // Assuming existing test patterns for SidecarBridge
  const bridge = /* create bridge with mock */;
  await bridge.swarmCancel();
  // Verify the JSON-RPC request was sent with method 'swarmCancel'
});
```

Note: check existing `sidecar-bridge.test.ts` for patterns first — adapt to match.

**Step 2: Add swarmCancel to SidecarBridge**

In `src/agent/SidecarBridge.ts`, add:

```typescript
async swarmCancel(): Promise<void> {
  await this.send('swarmCancel', {});
}
```

**Step 3: Run test**

Run: `npx vitest run tests/agent/sidecar-bridge.test.ts --reporter=verbose`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/agent/SidecarBridge.ts tests/agent/sidecar-bridge.test.ts
git commit -m "feat: add swarmCancel method to SidecarBridge"
```

---

### Task 8: ChatView — Plan Display and Step Progress

**Files:**
- Modify: `src/agent/ChatView.ts`
- Test: `tests/frontend/chat-view.test.ts`

**Step 1: Write the failing tests**

Add to `tests/frontend/chat-view.test.ts`:

```typescript
it('renders a plan message with numbered steps', () => {
  const chat = new ChatView(container);
  chat.addPlanMessage(['Search Google', 'Open results', 'Summarize']);

  const planEl = container.querySelector('.chat-plan') as HTMLElement;
  expect(planEl).toBeTruthy();

  const steps = planEl.querySelectorAll('.chat-plan-step');
  expect(steps.length).toBe(3);
  expect(steps[0].textContent).toContain('Search Google');
  expect(steps[1].textContent).toContain('Open results');
  expect(steps[2].textContent).toContain('Summarize');
});

it('updates step status to active and done', () => {
  const chat = new ChatView(container);
  chat.addPlanMessage(['Step A', 'Step B']);

  chat.updateStepStatus(0, 'active');
  const step0 = container.querySelectorAll('.chat-plan-step')[0] as HTMLElement;
  expect(step0.classList.contains('active')).toBe(true);

  chat.updateStepStatus(0, 'done');
  expect(step0.classList.contains('done')).toBe(true);
  expect(step0.classList.contains('active')).toBe(false);
});

it('adds tool activity under a step', () => {
  const chat = new ChatView(container);
  chat.addPlanMessage(['Step A']);

  chat.addToolActivity(0, 'tab.navigate', 'google.com');
  const activity = container.querySelector('.chat-tool-activity') as HTMLElement;
  expect(activity).toBeTruthy();
  expect(activity.textContent).toContain('tab.navigate');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/chat-view.test.ts --reporter=verbose`
Expected: FAIL — `addPlanMessage` is not a function

**Step 3: Implement plan display in ChatView**

Add to `src/agent/ChatView.ts`:

```typescript
private activePlan: HTMLElement | null = null;

addPlanMessage(steps: string[]): void {
  const planEl = document.createElement('div');
  planEl.className = 'chat-plan';

  steps.forEach((step, i) => {
    const stepEl = document.createElement('div');
    stepEl.className = 'chat-plan-step pending';
    stepEl.dataset.stepIndex = String(i);

    const indicator = document.createElement('span');
    indicator.className = 'step-indicator';
    indicator.textContent = `${i + 1}.`;
    stepEl.appendChild(indicator);

    const label = document.createElement('span');
    label.className = 'step-label';
    label.textContent = step;
    stepEl.appendChild(label);

    planEl.appendChild(stepEl);
  });

  this.messageList.appendChild(planEl);
  this.messageList.scrollTop = this.messageList.scrollHeight;
  this.activePlan = planEl;
}

updateStepStatus(index: number, status: 'pending' | 'active' | 'done' | 'error'): void {
  if (!this.activePlan) return;
  const step = this.activePlan.querySelector(`[data-step-index="${index}"]`) as HTMLElement | null;
  if (!step) return;
  step.classList.remove('pending', 'active', 'done', 'error');
  step.classList.add(status);
  this.messageList.scrollTop = this.messageList.scrollHeight;
}

addToolActivity(stepIndex: number, toolName: string, brief: string): void {
  if (!this.activePlan) return;
  const step = this.activePlan.querySelector(`[data-step-index="${stepIndex}"]`) as HTMLElement | null;
  if (!step) return;

  const activity = document.createElement('div');
  activity.className = 'chat-tool-activity';
  activity.textContent = `> ${toolName}: ${brief}`;
  step.appendChild(activity);
  this.messageList.scrollTop = this.messageList.scrollHeight;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frontend/chat-view.test.ts --reporter=verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/agent/ChatView.ts tests/frontend/chat-view.test.ts
git commit -m "feat: ChatView plan display with step progress and tool activity"
```

---

### Task 9: AgentPanel — Handle Swarm Notifications

**Files:**
- Modify: `src/agent/AgentPanel.ts`
- Test: `tests/frontend/agent-panel.test.ts`

**Step 1: Write the failing tests**

Add to `tests/frontend/agent-panel.test.ts`:

```typescript
it('displays plan when swarmPlanReady notification arrives', async () => {
  const bridge = {
    agentQuery: vi.fn().mockResolvedValue('final result'),
    onNotification: (handler: (method: string, params: Record<string, unknown>) => void) => {
      notificationHandler = handler;
    },
    swarmCancel: vi.fn(),
  } as any;

  const tabManager = {
    getActiveTab: () => null,
    getTabs: () => [],
  } as any;

  const container = document.createElement('div');
  new AgentPanel(container, bridge, tabManager);

  notificationHandler?.('swarmPlanReady', {
    steps: ['Search Google', 'Open results'],
    task: 'Find info',
  });

  const planEl = container.querySelector('.chat-plan');
  expect(planEl).toBeTruthy();
});

it('updates step status on swarmStepStarted/Completed', async () => {
  const bridge = {
    agentQuery: vi.fn().mockResolvedValue('done'),
    onNotification: (handler: (method: string, params: Record<string, unknown>) => void) => {
      notificationHandler = handler;
    },
    swarmCancel: vi.fn(),
  } as any;

  const tabManager = {
    getActiveTab: () => null,
    getTabs: () => [],
  } as any;

  const container = document.createElement('div');
  new AgentPanel(container, bridge, tabManager);

  // First show the plan
  notificationHandler?.('swarmPlanReady', {
    steps: ['Step A'],
    task: 'Task',
  });

  // Then start step
  notificationHandler?.('swarmStepStarted', { stepIndex: 0, description: 'Step A' });
  const step = container.querySelector('.chat-plan-step') as HTMLElement;
  expect(step?.classList.contains('active')).toBe(true);

  // Then complete step
  notificationHandler?.('swarmStepCompleted', { stepIndex: 0, result: 'Done' });
  expect(step?.classList.contains('done')).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/agent-panel.test.ts --reporter=verbose`
Expected: FAIL — AgentPanel doesn't handle swarm notifications

**Step 3: Update AgentPanel notification handling**

In `src/agent/AgentPanel.ts`, update the notification handler:

```typescript
this.bridge.onNotification((method, params) => {
  if (method === 'heartbeatPulse') {
    // status indicator
  } else if (method === 'agentReady') {
    this.chatView.addMessage('agent', 'Agent ready.');
  } else if (method === 'reflectionComplete') {
    const summary = (params as { summary?: string }).summary || 'Reflection complete.';
    this.chatView.addMessage('agent', summary);
  } else if (method === 'swarmPlanReady') {
    const { steps } = params as { steps: string[]; task: string };
    this.chatView.addPlanMessage(steps);
  } else if (method === 'swarmStepStarted') {
    const { stepIndex } = params as { stepIndex: number };
    this.chatView.updateStepStatus(stepIndex, 'active');
  } else if (method === 'swarmToolExecuted') {
    const { stepIndex, tool, ok } = params as { stepIndex: number; tool: string; ok: boolean };
    this.chatView.addToolActivity(stepIndex, tool, ok ? 'ok' : 'failed');
  } else if (method === 'swarmStepCompleted') {
    const { stepIndex } = params as { stepIndex: number };
    this.chatView.updateStepStatus(stepIndex, 'done');
  } else if (method === 'swarmComplete') {
    // Final result comes via the agentQuery response
  }
});
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frontend/agent-panel.test.ts --reporter=verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/agent/AgentPanel.ts tests/frontend/agent-panel.test.ts
git commit -m "feat: AgentPanel handles swarm progress notifications"
```

---

### Task 10: CSS Styles for Plan Display

**Files:**
- Modify: `src/styles/agent-panel.css`

**Step 1: Add plan display styles**

Add to `src/styles/agent-panel.css`:

```css
/* Plan display */
.chat-plan {
  margin: 8px 0;
  padding: 8px 12px;
  border: 1px solid var(--border);
  background: var(--bg-secondary, rgba(255,255,255,0.03));
}

.chat-plan-step {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
  color: var(--text-secondary, #888);
  font-size: 13px;
  transition: color 0.2s;
}

.chat-plan-step.active {
  color: var(--text-primary, #fff);
}

.chat-plan-step.done {
  color: var(--text-secondary, #888);
  text-decoration: line-through;
  opacity: 0.7;
}

.chat-plan-step.error {
  color: var(--error, #f44);
}

.step-indicator {
  min-width: 20px;
  font-weight: bold;
}

.chat-plan-step.active .step-indicator::after {
  content: ' ...';
  animation: pulse 1.5s infinite;
}

.chat-plan-step.done .step-indicator::after {
  content: ' \2713';
}

.chat-plan-step.error .step-indicator::after {
  content: ' \2717';
}

.chat-tool-activity {
  width: 100%;
  padding-left: 28px;
  font-size: 11px;
  color: var(--text-tertiary, #666);
  font-family: monospace;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

**Step 2: Verify no border-radius (per CLAUDE.md)**

Review the CSS to confirm zero use of `border-radius`. Confirmed: none used.

**Step 3: Commit**

```bash
git add src/styles/agent-panel.css
git commit -m "feat: CSS styles for plan display and step progress indicators"
```

---

### Task 11: Run Full Test Suite

**Step 1: Run all tests**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS

**Step 2: If failures, fix and re-run**

Address any failures from integration between new and existing code.

**Step 3: Final commit if any fixes**

```bash
git add -A
git commit -m "fix: test suite integration fixes for task planner"
```

---

## Summary of Changes

| # | Task | Files | Tests |
|---|------|-------|-------|
| 1 | classifyAndRoute router | AgentCore.ts | agent-core.test.ts |
| 2 | Multi-tool loop (simple) | AgentCore.ts | agent-core.test.ts |
| 3 | Swarm constructor + cancel | Swarm.ts, main.ts | swarm.test.ts |
| 4 | Tool-enabled executor | Swarm.ts | swarm.test.ts |
| 5 | Enhanced planner | Swarm.ts | swarm.test.ts |
| 6 | Sidecar routing | main.ts | (integration) |
| 7 | SidecarBridge.swarmCancel | SidecarBridge.ts | sidecar-bridge.test.ts |
| 8 | ChatView plan display | ChatView.ts | chat-view.test.ts |
| 9 | AgentPanel notifications | AgentPanel.ts | agent-panel.test.ts |
| 10 | CSS styles | agent-panel.css | (visual) |
| 11 | Full test suite | all | all |
