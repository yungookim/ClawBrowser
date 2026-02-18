import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentPanel } from '../../src/agent/AgentPanel';

const chatMocks = vi.hoisted(() => ({
  addMessage: vi.fn(),
  setLoading: vi.fn(),
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
  },
}));

describe('AgentPanel', () => {
  let notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null;

  beforeEach(() => {
    document.body.innerHTML = '';
    chatMocks.addMessage.mockClear();
    chatMocks.setLoading.mockClear();
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
});
