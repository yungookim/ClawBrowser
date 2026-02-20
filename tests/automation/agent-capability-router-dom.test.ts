import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentCapabilityRouter } from '../../src/agent/AgentCapabilityRouter';

/* ── Mocks ───────────────────────────────────────────────────── */

vi.mock('../../src/security/Permissions', () => ({
  Permissions: {
    getOrigin: (url?: string) => {
      if (!url || url === 'about:blank') return null;
      try {
        return new URL(url).origin;
      } catch {
        return null;
      }
    },
    requiresPermission: (origin: string | null) => {
      return !!origin && (origin.startsWith('http://') || origin.startsWith('https://'));
    },
    ensureDomAutomation: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

type NotificationHandler = (method: string, params: any) => void;

function makeSidecar() {
  let handler: NotificationHandler | null = null;
  return {
    onNotification: vi.fn((h: NotificationHandler) => {
      handler = h;
    }),
    send: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue({
      agentControl: { enabled: true, killSwitch: false, destructiveConfirm: 'none' },
    }),
    _emit(method: string, params: any) {
      handler?.(method, params);
    },
  } as any;
}

function makeTabManager() {
  return {
    getActiveTab: vi.fn().mockReturnValue({ id: 'tab-1', url: 'https://example.com', title: 'Ex' }),
    getTabs: vi.fn().mockReturnValue([]),
    getActiveTabId: vi.fn().mockReturnValue('tab-1'),
    getTabById: vi.fn().mockReturnValue({ id: 'tab-1', url: 'https://example.com', title: 'Ex' }),
    injectJs: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeDomAutomation(overrides: Record<string, any> = {}) {
  return {
    executeRequest: vi.fn().mockResolvedValue({
      requestId: 'dom-123',
      ok: true,
      results: [{ type: 'click', value: {} }],
    }),
    ...overrides,
  } as any;
}

/* ── Tests ───────────────────────────────────────────────────── */

describe('AgentCapabilityRouter — dom automation path', () => {
  let sidecar: ReturnType<typeof makeSidecar>;
  let tabManager: ReturnType<typeof makeTabManager>;
  let domAutomation: ReturnType<typeof makeDomAutomation>;

  beforeEach(() => {
    sidecar = makeSidecar();
    tabManager = makeTabManager();
    domAutomation = makeDomAutomation();
  });

  async function sendAgentRequest(params: Record<string, any>) {
    const router = new AgentCapabilityRouter(sidecar, tabManager, { domAutomation });
    router.start();

    sidecar._emit('agentRequest', {
      requestId: 'agent-req-1',
      capability: 'dom',
      action: 'automation',
      params,
    });

    // Allow async handler to complete
    await new Promise(r => setTimeout(r, 50));
    return router;
  }

  it('routes dom.automation requests to DomAutomationBridge', async () => {
    await sendAgentRequest({ actions: [{ type: 'click', target: '#btn' }] });

    expect(domAutomation.executeRequest).toHaveBeenCalledTimes(1);
    const req = domAutomation.executeRequest.mock.calls[0][0];
    expect(req.actions).toEqual([{ type: 'click', target: '#btn' }]);
  });

  it('sends agentResult back to sidecar with data on success', async () => {
    await sendAgentRequest({ actions: [{ type: 'click', target: '#btn' }] });

    expect(sidecar.send).toHaveBeenCalledWith('agentResult', {
      requestId: 'agent-req-1',
      ok: true,
      data: {
        requestId: 'dom-123',
        ok: true,
        results: [{ type: 'click', value: {} }],
      },
    });
  });

  it('passes requestId from params.requestId if present (agent-generated)', async () => {
    await sendAgentRequest({
      requestId: 'custom-dom-id',
      actions: [{ type: 'click', target: '#btn' }],
    });

    const req = domAutomation.executeRequest.mock.calls[0][0];
    expect(req.requestId).toBe('custom-dom-id');
  });

  it('passes undefined requestId when params lacks it (bridge should generate)', async () => {
    await sendAgentRequest({ actions: [{ type: 'click', target: '#btn' }] });

    const req = domAutomation.executeRequest.mock.calls[0][0];
    // requestId should be undefined — DomAutomationBridge.executeRequest will generate one
    expect(req.requestId).toBeUndefined();
  });

  it('passes tabId, timeoutMs, returnMode, descriptorMode from params', async () => {
    await sendAgentRequest({
      actions: [{ type: 'click', target: '#btn' }],
      tabId: 'tab-5',
      timeoutMs: 5000,
      returnMode: 'last',
      descriptorMode: 'balanced',
    });

    const req = domAutomation.executeRequest.mock.calls[0][0];
    expect(req.tabId).toBe('tab-5');
    expect(req.timeoutMs).toBe(5000);
    expect(req.returnMode).toBe('last');
    expect(req.descriptorMode).toBe('balanced');
  });

  it('rejects non-array actions', async () => {
    await sendAgentRequest({ actions: 'not-an-array' });

    expect(sidecar.send).toHaveBeenCalledWith('agentResult', expect.objectContaining({
      requestId: 'agent-req-1',
      ok: false,
      error: expect.objectContaining({ message: expect.stringContaining('actions') }),
    }));
  });

  it('rejects missing actions', async () => {
    await sendAgentRequest({});

    expect(sidecar.send).toHaveBeenCalledWith('agentResult', expect.objectContaining({
      requestId: 'agent-req-1',
      ok: false,
      error: expect.objectContaining({ message: expect.stringContaining('actions') }),
    }));
  });

  it('returns error when domAutomation is not configured', async () => {
    const router = new AgentCapabilityRouter(sidecar, tabManager); // no domAutomation
    router.start();

    sidecar._emit('agentRequest', {
      requestId: 'agent-req-2',
      capability: 'dom',
      action: 'automation',
      params: { actions: [{ type: 'click', target: '#btn' }] },
    });

    await new Promise(r => setTimeout(r, 50));

    expect(sidecar.send).toHaveBeenCalledWith('agentResult', expect.objectContaining({
      requestId: 'agent-req-2',
      ok: false,
      error: expect.objectContaining({ message: expect.stringContaining('unavailable') }),
    }));
  });

  it('returns error when executeRequest throws', async () => {
    const failDom = makeDomAutomation({
      executeRequest: vi.fn().mockRejectedValue(new Error('Injection failed')),
    });
    const router = new AgentCapabilityRouter(sidecar, tabManager, { domAutomation: failDom });
    router.start();

    sidecar._emit('agentRequest', {
      requestId: 'agent-req-3',
      capability: 'dom',
      action: 'automation',
      params: { actions: [{ type: 'click', target: '#btn' }] },
    });

    await new Promise(r => setTimeout(r, 50));

    expect(sidecar.send).toHaveBeenCalledWith('agentResult', expect.objectContaining({
      requestId: 'agent-req-3',
      ok: false,
      error: expect.objectContaining({ message: 'Injection failed' }),
    }));
  });

  it('rejects unsupported dom actions', async () => {
    const router = new AgentCapabilityRouter(sidecar, tabManager, { domAutomation });
    router.start();

    sidecar._emit('agentRequest', {
      requestId: 'agent-req-4',
      capability: 'dom',
      action: 'unknown',
      params: {},
    });

    await new Promise(r => setTimeout(r, 50));

    expect(sidecar.send).toHaveBeenCalledWith('agentResult', expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ message: expect.stringContaining('Unsupported dom action') }),
    }));
  });

  it('ignores non-agentRequest notifications', async () => {
    const router = new AgentCapabilityRouter(sidecar, tabManager, { domAutomation });
    router.start();

    sidecar._emit('someOtherNotification', { foo: 'bar' });

    await new Promise(r => setTimeout(r, 50));

    expect(domAutomation.executeRequest).not.toHaveBeenCalled();
    expect(sidecar.send).not.toHaveBeenCalled();
  });

  it('ignores requests with no requestId', async () => {
    const router = new AgentCapabilityRouter(sidecar, tabManager, { domAutomation });
    router.start();

    sidecar._emit('agentRequest', {
      capability: 'dom',
      action: 'automation',
      params: { actions: [{ type: 'click', target: '#btn' }] },
    });

    await new Promise(r => setTimeout(r, 50));

    expect(domAutomation.executeRequest).not.toHaveBeenCalled();
  });
});
