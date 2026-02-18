import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentCore, type AgentContext } from '../../sidecar/core/AgentCore';
import { ModelManager } from '../../sidecar/core/ModelManager';

describe('AgentCore', () => {
  let modelManager: ModelManager;
  let agentCore: AgentCore;
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    modelManager = new ModelManager();
    agentCore = new AgentCore(modelManager);
    mockInvoke = vi.fn();
  });

  /** Helper: configure model manager and mock the created model's invoke. */
  function setupMockModel(): void {
    modelManager.configure({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      role: 'primary',
    });

    // Spy on createModel to return a mock that uses our mockInvoke
    vi.spyOn(modelManager, 'createModel').mockReturnValue({
      invoke: mockInvoke,
    } as any);
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
    mockInvoke.mockResolvedValue({ content: 'Hello! How can I help you?' });

    const response = await agentCore.query({ userQuery: 'Hello' });
    expect(response.reply).toBe('Hello! How can I help you?');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('should include tab context in system prompt', async () => {
    setupMockModel();
    mockInvoke.mockResolvedValue({ content: 'Response' });

    await agentCore.query({
      userQuery: 'What page am I on?',
      activeTabUrl: 'https://example.com',
      activeTabTitle: 'Example Domain',
      tabCount: 3,
    });

    const callArgs = mockInvoke.mock.calls[0][0];
    const systemMsg = callArgs[0];
    expect(systemMsg.content).toContain('Example Domain');
    expect(systemMsg.content).toContain('https://example.com');
    expect(systemMsg.content).toContain('Open tabs: 3');
  });

  it('should include workspace files in system prompt', async () => {
    setupMockModel();
    mockInvoke.mockResolvedValue({ content: 'Response' });

    await agentCore.query({
      userQuery: 'Test',
      workspaceFiles: {
        'SOUL.md': 'I am Claw, a helpful AI browser assistant.',
        'USER.md': 'User prefers dark mode.',
      },
    });

    const callArgs = mockInvoke.mock.calls[0][0];
    const systemMsg = callArgs[0];
    expect(systemMsg.content).toContain('SOUL.md');
    expect(systemMsg.content).toContain('I am Claw');
    expect(systemMsg.content).toContain('USER.md');
    expect(systemMsg.content).toContain('dark mode');
  });

  it('should maintain conversation history', async () => {
    setupMockModel();
    mockInvoke
      .mockResolvedValueOnce({ content: 'First response' })
      .mockResolvedValueOnce({ content: 'Second response' });

    await agentCore.query({ userQuery: 'First message' });
    expect(agentCore.getHistoryLength()).toBe(2); // user + assistant

    await agentCore.query({ userQuery: 'Second message' });
    expect(agentCore.getHistoryLength()).toBe(4); // 2 user + 2 assistant

    // Second call should include history from first
    // Messages: [system, user1, assistant1, user2] = 4 items
    // (user2 is added to history before invoke, assistant2 after)
    const secondCallArgs = mockInvoke.mock.calls[1][0];
    expect(secondCallArgs).toHaveLength(4); // system + 3 history messages at invoke time
  });

  it('should clear conversation history', async () => {
    setupMockModel();
    mockInvoke.mockResolvedValue({ content: 'Response' });

    await agentCore.query({ userQuery: 'Message' });
    expect(agentCore.getHistoryLength()).toBe(2);

    agentCore.clearHistory();
    expect(agentCore.getHistoryLength()).toBe(0);
  });

  it('should handle model invocation errors gracefully', async () => {
    setupMockModel();
    mockInvoke.mockRejectedValue(new Error('API rate limit exceeded'));

    const response = await agentCore.query({ userQuery: 'Hello' });
    expect(response.reply).toBe('Error: API rate limit exceeded');
  });

  it('should handle non-string content from model', async () => {
    setupMockModel();
    mockInvoke.mockResolvedValue({
      content: [{ type: 'text', text: 'Structured response' }],
    });

    const response = await agentCore.query({ userQuery: 'Hello' });
    // Should JSON.stringify non-string content
    expect(response.reply).toContain('Structured response');
  });

  it('should trim history when exceeding MAX_HISTORY (40)', async () => {
    setupMockModel();
    mockInvoke.mockResolvedValue({ content: 'Response' });

    // Send 25 messages (each creates 2 history entries = 50 > 40)
    for (let i = 0; i < 25; i++) {
      await agentCore.query({ userQuery: `Message ${i}` });
    }

    // History trim happens before invoke (trims to 40), then assistant reply
    // is appended after invoke, so final length is 41 at most.
    // The trim keeps history from growing unbounded.
    expect(agentCore.getHistoryLength()).toBeLessThanOrEqual(41);
  });

  it('should skip empty workspace files in system prompt', async () => {
    setupMockModel();
    mockInvoke.mockResolvedValue({ content: 'Response' });

    await agentCore.query({
      userQuery: 'Test',
      workspaceFiles: {
        'SOUL.md': 'I am Claw.',
        'EMPTY.md': '',
        'WHITESPACE.md': '   ',
      },
    });

    const callArgs = mockInvoke.mock.calls[0][0];
    const systemMsg = callArgs[0];
    expect(systemMsg.content).toContain('SOUL.md');
    expect(systemMsg.content).not.toContain('EMPTY.md');
    expect(systemMsg.content).not.toContain('WHITESPACE.md');
  });

  it('should always include core identity in system prompt', async () => {
    setupMockModel();
    mockInvoke.mockResolvedValue({ content: 'Response' });

    await agentCore.query({ userQuery: 'Hello' });

    const callArgs = mockInvoke.mock.calls[0][0];
    const systemMsg = callArgs[0];
    expect(systemMsg.content).toContain('You are Claw');
    expect(systemMsg.content).toContain('ClawBrowser');
  });
});
