import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentPanel } from '../../src/agent/AgentPanel';

const chatMocks = vi.hoisted(() => ({
  addMessage: vi.fn(),
  setLoading: vi.fn(),
  addPlanMessage: vi.fn(),
  updateStepStatus: vi.fn(),
  addToolActivity: vi.fn(),
  onSend: null as null | ((message: string) => void),
}));

vi.mock('../../src/agent/ChatView', () => ({
  ChatView: class {
    constructor(_container: HTMLElement) {}
    setOnSend(handler: (message: string) => void): void {
      chatMocks.onSend = handler;
    }
    addMessage = chatMocks.addMessage;
    setLoading = chatMocks.setLoading;
    addPlanMessage = chatMocks.addPlanMessage;
    updateStepStatus = chatMocks.updateStepStatus;
    addToolActivity = chatMocks.addToolActivity;
  },
}));

describe('AgentPanel', () => {
  let notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null;

  beforeEach(() => {
    document.body.innerHTML = '';
    chatMocks.addMessage.mockClear();
    chatMocks.setLoading.mockClear();
    chatMocks.addPlanMessage.mockClear();
    chatMocks.updateStepStatus.mockClear();
    chatMocks.addToolActivity.mockClear();
    chatMocks.onSend = null;
    notificationHandler = null;
  });

  it('handles user messages and agent replies', async () => {
    const bridge = {
      agentQuery: vi.fn().mockResolvedValue('reply'),
      onNotification: (handler: (method: string, params: Record<string, unknown>) => void) => {
        notificationHandler = handler;
      },
    } as any;

    const tabManager = {
      getActiveTab: () => ({ url: 'https://example.com', title: 'Example' }),
      getTabs: () => [{ id: '1' }, { id: '2' }],
    } as any;

    const container = document.createElement('div');
    new AgentPanel(container, bridge, tabManager);

    chatMocks.onSend?.('Hello');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chatMocks.addMessage).toHaveBeenCalledWith('user', 'Hello');
    expect(chatMocks.setLoading).toHaveBeenCalledWith(true);
    expect(bridge.agentQuery).toHaveBeenCalledWith('Hello', 'https://example.com', 'Example', 2);
    expect(chatMocks.addMessage).toHaveBeenCalledWith('agent', 'reply');
    expect(chatMocks.setLoading).toHaveBeenCalledWith(false);

    notificationHandler?.('agentReady', {});
    expect(chatMocks.addMessage).toHaveBeenCalledWith('agent', 'Agent ready.');

    notificationHandler?.('reflectionComplete', { summary: 'Done' });
    expect(chatMocks.addMessage).toHaveBeenCalledWith('agent', 'Done');
  });

  it('reports errors from the sidecar bridge', async () => {
    const bridge = {
      agentQuery: vi.fn().mockRejectedValue(new Error('Boom')),
      onNotification: (handler: (method: string, params: Record<string, unknown>) => void) => {
        notificationHandler = handler;
      },
    } as any;

    const tabManager = {
      getActiveTab: () => null,
      getTabs: () => [],
    } as any;

    const container = document.createElement('div');
    new AgentPanel(container, bridge, tabManager);

    chatMocks.onSend?.('Hello');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chatMocks.addMessage).toHaveBeenCalledWith('agent', 'Error: Boom');
    expect(chatMocks.setLoading).toHaveBeenCalledWith(false);
  });

  it('displays plan when swarmPlanReady notification arrives', () => {
    const bridge = {
      agentQuery: vi.fn().mockResolvedValue('done'),
      onNotification: (handler: (method: string, params: Record<string, unknown>) => void) => {
        notificationHandler = handler;
      },
      swarmCancel: vi.fn(),
    } as any;

    const tabManager = { getActiveTab: () => null, getTabs: () => [] } as any;
    const container = document.createElement('div');
    new AgentPanel(container, bridge, tabManager);

    notificationHandler?.('swarmPlanReady', {
      steps: ['Search Google', 'Open results'],
      task: 'Find info',
    });

    expect(chatMocks.addPlanMessage).toHaveBeenCalledWith(['Search Google', 'Open results']);
  });

  it('updates step status on swarmStepStarted and swarmStepCompleted', () => {
    const bridge = {
      agentQuery: vi.fn().mockResolvedValue('done'),
      onNotification: (handler: (method: string, params: Record<string, unknown>) => void) => {
        notificationHandler = handler;
      },
      swarmCancel: vi.fn(),
    } as any;

    const tabManager = { getActiveTab: () => null, getTabs: () => [] } as any;
    const container = document.createElement('div');
    new AgentPanel(container, bridge, tabManager);

    notificationHandler?.('swarmStepStarted', { stepIndex: 0, description: 'Step A', totalSteps: 2 });
    expect(chatMocks.updateStepStatus).toHaveBeenCalledWith(0, 'active');

    notificationHandler?.('swarmStepCompleted', { stepIndex: 0, result: 'Done' });
    expect(chatMocks.updateStepStatus).toHaveBeenCalledWith(0, 'done');
  });

  it('shows tool activity on swarmToolExecuted', () => {
    const bridge = {
      agentQuery: vi.fn().mockResolvedValue('done'),
      onNotification: (handler: (method: string, params: Record<string, unknown>) => void) => {
        notificationHandler = handler;
      },
      swarmCancel: vi.fn(),
    } as any;

    const tabManager = { getActiveTab: () => null, getTabs: () => [] } as any;
    const container = document.createElement('div');
    new AgentPanel(container, bridge, tabManager);

    notificationHandler?.('swarmToolExecuted', { stepIndex: 1, tool: 'tab.navigate', ok: true });
    expect(chatMocks.addToolActivity).toHaveBeenCalledWith(1, 'tab.navigate', 'ok');
  });

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
});
