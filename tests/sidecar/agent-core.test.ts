import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentCore, type AgentContext, type RouteDecision } from '../../sidecar/core/AgentCore';
import { ModelManager } from '../../sidecar/core/ModelManager';

function isRoutingCall(messages: any[]): boolean {
  const first = messages?.[0];
  return Boolean(first && typeof first.content === 'string'
    && (first.content.includes('router that selects which model')
      || first.content.includes('router that classifies')));
}

function isAgentSystemCall(messages: any[]): boolean {
  const first = messages?.[0];
  return Boolean(first && typeof first.content === 'string' && first.content.includes('You are Claw'));
}

describe('AgentCore', () => {
  let modelManager: ModelManager;
  let agentCore: AgentCore;
  let mockInvoke: ReturnType<typeof vi.fn>;
  let replyContent: any;
  let replyQueue: any[];
  let rejectError: Error | null;

  beforeEach(() => {
    vi.clearAllMocks();
    modelManager = new ModelManager();
    agentCore = new AgentCore(modelManager);
    mockInvoke = vi.fn();
    replyContent = { content: 'Response' };
    replyQueue = [];
    rejectError = null;
  });

  /** Helper: configure model manager and mock the created model's invoke. */
  function setupMockModel(): void {
    modelManager.configure({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      role: 'primary',
    });

    mockInvoke = vi.fn((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.resolve({ content: '{"role":"primary","complexity":"simple","reason":"default"}' });
      }
      if (rejectError) {
        return Promise.reject(rejectError);
      }
      if (replyQueue.length > 0) {
        return Promise.resolve(replyQueue.shift());
      }
      return Promise.resolve(replyContent);
    });

    vi.spyOn(modelManager, 'createModel').mockReturnValue({
      invoke: mockInvoke,
    } as any);
  }

  function getAgentSystemCall(): any[] {
    const call = mockInvoke.mock.calls.find((args) => isAgentSystemCall(args[0]));
    if (!call) throw new Error('Agent system call not found');
    return call;
  }

  function getAgentSystemCalls(): any[][] {
    return mockInvoke.mock.calls.filter((args) => isAgentSystemCall(args[0]));
  }

  it('should return config message when no model is configured', async () => {
    const context: AgentContext = {
      userQuery: 'Hello',
    };

    const response = await agentCore.query(context);
    expect(response.reply).toBe('No AI model configured. Please set up a model in Settings.');
  });

  it('should invoke the model and return reply', async () => {
    setupMockModel();
    replyContent = { content: 'Hello! How can I help you?' };

    const response = await agentCore.query({ userQuery: 'Hello' });
    expect(response.reply).toBe('Hello! How can I help you?');
    expect(mockInvoke).toHaveBeenCalled();
  });

  it('should include tab context in system prompt', async () => {
    setupMockModel();
    replyContent = { content: 'Response' };

    await agentCore.query({
      userQuery: 'What page am I on?',
      activeTabUrl: 'https://example.com',
      activeTabTitle: 'Example Domain',
      tabCount: 3,
    });

    const callArgs = getAgentSystemCall();
    const systemMsg = callArgs[0][0];
    expect(systemMsg.content).toContain('Example Domain');
    expect(systemMsg.content).toContain('https://example.com');
    expect(systemMsg.content).toContain('Open tabs: 3');
  });

  it('should include workspace files in system prompt', async () => {
    setupMockModel();
    replyContent = { content: 'Response' };

    await agentCore.query({
      userQuery: 'Test',
      workspaceFiles: {
        'SOUL.md': 'I am Claw, a helpful AI browser assistant.',
        'USER.md': 'User prefers dark mode.',
      },
    });

    const callArgs = getAgentSystemCall();
    const systemMsg = callArgs[0][0];
    expect(systemMsg.content).toContain('SOUL.md');
    expect(systemMsg.content).toContain('I am Claw');
    expect(systemMsg.content).toContain('USER.md');
    expect(systemMsg.content).toContain('dark mode');
  });

  it('should maintain conversation history', async () => {
    setupMockModel();
    replyQueue = [
      { content: 'First response' },
      { content: 'Second response' },
    ];

    await agentCore.query({ userQuery: 'First message' });
    expect(agentCore.getHistoryLength()).toBe(2); // user + assistant

    await agentCore.query({ userQuery: 'Second message' });
    expect(agentCore.getHistoryLength()).toBe(4); // 2 user + 2 assistant

    const systemCalls = getAgentSystemCalls();
    const secondCallArgs = systemCalls[1];
    expect(secondCallArgs[0]).toHaveLength(4); // system + history
  });

  it('should clear conversation history', async () => {
    setupMockModel();
    replyContent = { content: 'Response' };

    await agentCore.query({ userQuery: 'Message' });
    expect(agentCore.getHistoryLength()).toBe(2);

    agentCore.clearHistory();
    expect(agentCore.getHistoryLength()).toBe(0);
  });

  it('should handle model invocation errors gracefully', async () => {
    setupMockModel();
    rejectError = new Error('API rate limit exceeded');

    const response = await agentCore.query({ userQuery: 'Hello' });
    expect(response.reply).toBe('Error: API rate limit exceeded');
  });

  it('should handle non-string content from model', async () => {
    setupMockModel();
    replyContent = {
      content: [{ type: 'text', text: 'Structured response' }],
    };

    const response = await agentCore.query({ userQuery: 'Hello' });
    // Should JSON.stringify non-string content
    expect(response.reply).toContain('Structured response');
  });

  it('should trim history when exceeding MAX_HISTORY (40)', async () => {
    setupMockModel();
    replyContent = { content: 'Response' };

    // Send 25 messages (each creates 2 history entries = 50 > 40)
    for (let i = 0; i < 25; i++) {
      await agentCore.query({ userQuery: `Message ${i}` });
    }

    // History trim happens before invoke (trims to 40), then assistant reply
    // is appended after invoke, so final length is 41 at most.
    expect(agentCore.getHistoryLength()).toBeLessThanOrEqual(41);
  });

  it('should skip empty workspace files in system prompt', async () => {
    setupMockModel();
    replyContent = { content: 'Response' };

    await agentCore.query({
      userQuery: 'Test',
      workspaceFiles: {
        'SOUL.md': 'I am Claw.',
        'EMPTY.md': '',
        'WHITESPACE.md': '   ',
      },
    });

    const callArgs = getAgentSystemCall();
    const systemMsg = callArgs[0][0];
    expect(systemMsg.content).toContain('SOUL.md');
    expect(systemMsg.content).not.toContain('EMPTY.md');
    expect(systemMsg.content).not.toContain('WHITESPACE.md');
  });

  it('should always include core identity in system prompt', async () => {
    setupMockModel();
    replyContent = { content: 'Response' };

    await agentCore.query({ userQuery: 'Hello' });

    const callArgs = getAgentSystemCall();
    const systemMsg = callArgs[0][0];
    expect(systemMsg.content).toContain('You are Claw');
    expect(systemMsg.content).toContain('ClawBrowser');
  });

  it('executes terminal tool calls and returns follow-up reply', async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
    };

    modelManager = new ModelManager();
    agentCore = new AgentCore(modelManager, executor as any);

    modelManager.configure({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      role: 'primary',
    });

    let nonRouterCount = 0;
    mockInvoke = vi.fn((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.resolve({ content: '{"role":"primary","complexity":"simple","reason":"default"}' });
      }
      if (nonRouterCount === 0) {
        nonRouterCount += 1;
        return Promise.resolve({
          content: '{"tool":"terminalExec","command":"codex","args":["--help"]}',
        });
      }
      return Promise.resolve({ content: 'Done.' });
    });

    vi.spyOn(modelManager, 'createModel').mockReturnValue({
      invoke: mockInvoke,
    } as any);

    const response = await agentCore.query({ userQuery: 'Run codex help' });
    expect(executor.execute).toHaveBeenCalledWith('codex', ['--help'], undefined);
    expect(response.reply).toBe('Done.');
  });

  it('classifies simple queries as simple complexity', async () => {
    setupMockModel();

    // Override mock to return simple classification
    mockInvoke.mockImplementation((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.resolve({
          content: '{"role":"secondary","complexity":"simple","reason":"direct factual question"}',
        });
      }
      return Promise.resolve(replyContent);
    });

    const result = await agentCore.classifyAndRoute({ userQuery: 'What time is it?' });
    expect(result.complexity).toBe('simple');
    expect(result.role).toBe('secondary');
    expect(result.reason).toBe('direct factual question');
  });

  it('classifies multi-step queries as complex', async () => {
    setupMockModel();

    // Override mock to return complex classification
    mockInvoke.mockImplementation((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.resolve({
          content: '{"role":"primary","complexity":"complex","reason":"requires browsing multiple sites and comparing"}',
        });
      }
      return Promise.resolve(replyContent);
    });

    const result = await agentCore.classifyAndRoute({
      userQuery: 'Compare prices of MacBook Pro across Amazon, Best Buy, and B&H Photo',
    });
    expect(result.complexity).toBe('complex');
    expect(result.role).toBe('primary');
    expect(result.reason).toBe('requires browsing multiple sites and comparing');
  });

  it('defaults to simple when router fails', async () => {
    setupMockModel();

    // Override mock to reject on routing call
    mockInvoke.mockImplementation((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.reject(new Error('Router LLM unavailable'));
      }
      return Promise.resolve(replyContent);
    });

    const result = await agentCore.classifyAndRoute({ userQuery: 'Hello' });
    expect(result).toEqual({ role: 'primary', complexity: 'simple', reason: 'fallback' });
  });

  it('falls back to simple on malformed LLM JSON', async () => {
    setupMockModel();

    // Override mock to return invalid JSON from routing
    mockInvoke.mockImplementation((messages: any[]) => {
      if (isRoutingCall(messages)) {
        return Promise.resolve({
          content: 'I am not valid JSON at all {{{',
        });
      }
      return Promise.resolve(replyContent);
    });

    const result = await agentCore.classifyAndRoute({ userQuery: 'test' });
    expect(result).toEqual({ role: 'primary', complexity: 'simple', reason: 'fallback' });
  });
});
