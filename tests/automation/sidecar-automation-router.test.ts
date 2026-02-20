import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SidecarAutomationRouter } from '../../src/automation/SidecarAutomationRouter';

/* ── Mocks ───────────────────────────────────────────────────── */

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('../../src/security/Permissions', () => ({
  Permissions: {
    getOrigin: () => null,
    requiresPermission: () => false,
    ensureDomAutomation: vi.fn().mockResolvedValue(true),
  },
}));

type NotificationHandler = (method: string, params: any) => void;

function makeSidecar() {
  let handler: NotificationHandler | null = null;
  return {
    onNotification: vi.fn((h: NotificationHandler) => {
      handler = h;
    }),
    send: vi.fn().mockResolvedValue(undefined),
    _emit(method: string, params: any) {
      handler?.(method, params);
    },
  } as any;
}

function makeDomBridge(overrides: Record<string, any> = {}) {
  return {
    executeRequest: vi.fn().mockResolvedValue({
      requestId: 'dom-req-1',
      ok: true,
      results: [{ type: 'click', value: {} }],
    }),
    ...overrides,
  } as any;
}

/* ── Tests ───────────────────────────────────────────────────── */

describe('SidecarAutomationRouter', () => {
  let sidecar: ReturnType<typeof makeSidecar>;
  let dom: ReturnType<typeof makeDomBridge>;

  beforeEach(() => {
    sidecar = makeSidecar();
    dom = makeDomBridge();
  });

  it('routes domAutomationRequest notifications to DomAutomationBridge', async () => {
    const router = new SidecarAutomationRouter(sidecar, dom);
    router.start();

    sidecar._emit('domAutomationRequest', {
      requestId: 'sidecar-req-1',
      actions: [{ type: 'click', target: '#btn' }],
    });

    await new Promise(r => setTimeout(r, 50));

    expect(dom.executeRequest).toHaveBeenCalledTimes(1);
    expect(dom.executeRequest.mock.calls[0][0]).toEqual({
      requestId: 'sidecar-req-1',
      actions: [{ type: 'click', target: '#btn' }],
    });
  });

  it('sends result back to sidecar via domAutomationResult', async () => {
    const router = new SidecarAutomationRouter(sidecar, dom);
    router.start();

    sidecar._emit('domAutomationRequest', {
      requestId: 'sidecar-req-2',
      actions: [{ type: 'getText' }],
    });

    await new Promise(r => setTimeout(r, 50));

    expect(sidecar.send).toHaveBeenCalledWith('domAutomationResult', {
      requestId: 'dom-req-1',
      ok: true,
      results: [{ type: 'click', value: {} }],
    });
  });

  it('sends error result when executeRequest throws', async () => {
    const failDom = makeDomBridge({
      executeRequest: vi.fn().mockRejectedValue(new Error('Tab closed')),
    });
    const router = new SidecarAutomationRouter(sidecar, failDom);
    router.start();

    sidecar._emit('domAutomationRequest', {
      requestId: 'sidecar-req-3',
      actions: [{ type: 'click', target: '#btn' }],
    });

    await new Promise(r => setTimeout(r, 50));

    expect(sidecar.send).toHaveBeenCalledWith('domAutomationResult', expect.objectContaining({
      requestId: 'sidecar-req-3',
      ok: false,
      error: expect.objectContaining({ message: 'Tab closed' }),
    }));
  });

  it('rejects requests with empty actions', async () => {
    const router = new SidecarAutomationRouter(sidecar, dom);
    router.start();

    sidecar._emit('domAutomationRequest', {
      requestId: 'sidecar-req-4',
      actions: [],
    });

    await new Promise(r => setTimeout(r, 50));

    expect(dom.executeRequest).not.toHaveBeenCalled();
    expect(sidecar.send).toHaveBeenCalledWith('domAutomationResult', expect.objectContaining({
      requestId: 'sidecar-req-4',
      ok: false,
      error: expect.objectContaining({ message: expect.stringContaining('missing actions') }),
    }));
  });

  it('rejects requests with no actions field', async () => {
    const router = new SidecarAutomationRouter(sidecar, dom);
    router.start();

    sidecar._emit('domAutomationRequest', {
      requestId: 'sidecar-req-5',
    });

    await new Promise(r => setTimeout(r, 50));

    expect(sidecar.send).toHaveBeenCalledWith('domAutomationResult', expect.objectContaining({
      requestId: 'sidecar-req-5',
      ok: false,
    }));
  });

  it('ignores requests without requestId', async () => {
    const router = new SidecarAutomationRouter(sidecar, dom);
    router.start();

    sidecar._emit('domAutomationRequest', {
      actions: [{ type: 'click', target: '#btn' }],
    });

    await new Promise(r => setTimeout(r, 50));

    expect(dom.executeRequest).not.toHaveBeenCalled();
    expect(sidecar.send).not.toHaveBeenCalled();
  });

  it('ignores non-domAutomationRequest notifications', async () => {
    const router = new SidecarAutomationRouter(sidecar, dom);
    router.start();

    sidecar._emit('someOther', { requestId: 'x', actions: [{ type: 'click' }] });

    await new Promise(r => setTimeout(r, 50));

    expect(dom.executeRequest).not.toHaveBeenCalled();
  });

  it('does not double-register on repeated start', () => {
    const router = new SidecarAutomationRouter(sidecar, dom);
    router.start();
    router.start();

    expect(sidecar.onNotification).toHaveBeenCalledTimes(1);
  });

  it('preserves tabId in error results', async () => {
    const failDom = makeDomBridge({
      executeRequest: vi.fn().mockRejectedValue(new Error('Oops')),
    });
    const router = new SidecarAutomationRouter(sidecar, failDom);
    router.start();

    sidecar._emit('domAutomationRequest', {
      requestId: 'sidecar-req-6',
      tabId: 'tab-42',
      actions: [{ type: 'click', target: '#btn' }],
    });

    await new Promise(r => setTimeout(r, 50));

    expect(sidecar.send).toHaveBeenCalledWith('domAutomationResult', expect.objectContaining({
      meta: expect.objectContaining({ tabId: 'tab-42' }),
    }));
  });
});
