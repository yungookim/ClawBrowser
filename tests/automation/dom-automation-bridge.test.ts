import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DomAutomationBridge } from '../../src/automation/DomAutomationBridge';

/* ── Tauri mocks ─────────────────────────────────────────────── */

const mocks = vi.hoisted(() => ({
  listenCallback: null as null | ((event: { payload: any }) => void),
  unlisten: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (_event: string, handler: (event: { payload: any }) => void) => {
    mocks.listenCallback = handler;
    return Promise.resolve(mocks.unlisten);
  },
}));

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

/* ── Helpers ─────────────────────────────────────────────────── */

function makeTabManager(overrides: Record<string, any> = {}) {
  return {
    getActiveTabId: vi.fn().mockReturnValue('tab-1'),
    getTabById: vi.fn().mockReturnValue({ id: 'tab-1', url: 'https://example.com', title: 'Example' }),
    injectJs: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function makeActions() {
  return [{ type: 'click', target: '#btn' }];
}

function emitResult(payload: any) {
  mocks.listenCallback?.({ payload });
}

/* ── Tests ───────────────────────────────────────────────────── */

describe('DomAutomationBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listenCallback = null;
    mocks.unlisten.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /* ── Lifecycle ───────────────────────────────────────────── */

  describe('start / stop', () => {
    it('registers Tauri event listener on start', async () => {
      const bridge = new DomAutomationBridge(makeTabManager());
      await bridge.start();
      expect(mocks.listenCallback).toBeTypeOf('function');
    });

    it('does not double-register on repeated start', async () => {
      const bridge = new DomAutomationBridge(makeTabManager());
      await bridge.start();
      const first = mocks.listenCallback;
      await bridge.start();
      expect(mocks.listenCallback).toBe(first);
    });

    it('unregisters listener and rejects pending on stop', async () => {
      const bridge = new DomAutomationBridge(makeTabManager());
      await bridge.start();

      const pending = bridge.execute(makeActions());
      await bridge.stop();

      expect(mocks.unlisten).toHaveBeenCalledTimes(1);
      await expect(pending).rejects.toThrow('Dom automation stopped');
    });
  });

  /* ── requestId generation (THE BUG FIX) ──────────────────── */

  describe('requestId generation', () => {
    it('generates requestId when executeRequest receives request without one', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      const promise = bridge.executeRequest({ actions: makeActions() });

      // The script injected should contain a generated requestId
      expect(tm.injectJs).toHaveBeenCalledTimes(1);
      const injectedScript: string = tm.injectJs.mock.calls[0][1];
      // Script should contain a UUID-like requestId — not "undefined"
      expect(injectedScript).not.toContain('"requestId":undefined');
      expect(injectedScript).not.toContain('undefined');

      // Extract the requestId from the JSON payload embedded in the script
      const payloadMatch = injectedScript.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
      expect(payloadMatch).not.toBeNull();
      const payload = JSON.parse(payloadMatch![1]);
      expect(payload.requestId).toBeTruthy();
      expect(typeof payload.requestId).toBe('string');
      expect(payload.requestId.length).toBeGreaterThan(0);

      // Complete the request by emitting a matching result
      emitResult({
        requestId: payload.requestId,
        ok: true,
        results: [{ type: 'click', value: {} }],
      });

      const result = await promise;
      expect(result.ok).toBe(true);
    });

    it('preserves requestId when one is provided', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      const myId = 'custom-request-id-123';
      const promise = bridge.executeRequest({ requestId: myId, actions: makeActions() });

      const script: string = tm.injectJs.mock.calls[0][1];
      const payloadMatch = script.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
      const payload = JSON.parse(payloadMatch![1]);
      expect(payload.requestId).toBe(myId);

      emitResult({ requestId: myId, ok: true, results: [] });
      const result = await promise;
      expect(result.ok).toBe(true);
    });

    it('generates unique requestIds for consecutive calls', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      bridge.executeRequest({ actions: makeActions() });
      bridge.executeRequest({ actions: makeActions() });

      const ids = tm.injectJs.mock.calls.map((call: any[]) => {
        const script: string = call[1];
        const match = script.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
        return JSON.parse(match![1]).requestId;
      });

      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  /* ── execute() convenience method ────────────────────────── */

  describe('execute()', () => {
    it('generates a requestId and calls executeRequest', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      const promise = bridge.execute(makeActions());

      const script: string = tm.injectJs.mock.calls[0][1];
      const payloadMatch = script.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
      const payload = JSON.parse(payloadMatch![1]);
      expect(payload.requestId).toBeTruthy();

      emitResult({ requestId: payload.requestId, ok: true, results: [] });
      const result = await promise;
      expect(result.ok).toBe(true);
    });

    it('passes options through (tabId, timeoutMs, returnMode, descriptorMode)', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      bridge.execute(makeActions(), {
        tabId: 'tab-99',
        timeoutMs: 5000,
        returnMode: 'last',
        descriptorMode: 'balanced',
      });

      const script: string = tm.injectJs.mock.calls[0][1];
      const payloadMatch = script.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
      const payload = JSON.parse(payloadMatch![1]);
      expect(payload.tabId).toBe('tab-99');
      expect(payload.timeoutMs).toBe(5000);
      expect(payload.returnMode).toBe('last');
      expect(payload.descriptorMode).toBe('balanced');
    });
  });

  /* ── Result matching ─────────────────────────────────────── */

  describe('result matching', () => {
    it('resolves correct pending request by requestId', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      const p1 = bridge.executeRequest({ requestId: 'req-A', actions: makeActions() });
      const p2 = bridge.executeRequest({ requestId: 'req-B', actions: makeActions() });

      emitResult({ requestId: 'req-B', ok: true, results: [{ type: 'done' }] });
      const r2 = await p2;
      expect(r2.ok).toBe(true);

      emitResult({ requestId: 'req-A', ok: true, results: [{ type: 'also-done' }] });
      const r1 = await p1;
      expect(r1.ok).toBe(true);
    });

    it('ignores results with no requestId', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      const promise = bridge.executeRequest({ requestId: 'req-X', actions: makeActions() });

      // Emit result without requestId — should be dropped
      emitResult({ ok: true, results: [] });

      // The promise should NOT have resolved
      let resolved = false;
      promise.then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);

      // Now emit correct result
      emitResult({ requestId: 'req-X', ok: true, results: [] });
      await expect(promise).resolves.toBeDefined();
    });

    it('ignores results with unknown requestId', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      const promise = bridge.executeRequest({ requestId: 'req-Y', actions: makeActions() });

      emitResult({ requestId: 'unknown-id', ok: true, results: [] });

      let resolved = false;
      promise.then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);

      emitResult({ requestId: 'req-Y', ok: true, results: [] });
      await expect(promise).resolves.toBeDefined();
    });

    it('ignores null/undefined payloads', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      // These should not throw
      emitResult(null);
      emitResult(undefined);
      emitResult({});
    });
  });

  /* ── Timeout ─────────────────────────────────────────────── */

  describe('timeout', () => {
    it('rejects with timeout error after default 30s', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      const promise = bridge.executeRequest({ requestId: 'req-T', actions: makeActions() });

      await vi.advanceTimersByTimeAsync(30_000);

      await expect(promise).rejects.toThrow('Dom automation timeout');
      await expect(promise).rejects.toThrow('req-T');
    });

    it('rejects with timeout using custom timeoutMs', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      const promise = bridge.executeRequest({
        requestId: 'req-CT',
        actions: makeActions(),
        timeoutMs: 2000,
      });

      await vi.advanceTimersByTimeAsync(1999);
      // Should not have rejected yet
      let rejected = false;
      promise.catch(() => { rejected = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(rejected).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).rejects.toThrow('Dom automation timeout');
    });

    it('cancels timeout when result arrives in time', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      const promise = bridge.executeRequest({ requestId: 'req-OK', actions: makeActions() });

      await vi.advanceTimersByTimeAsync(1000);
      emitResult({ requestId: 'req-OK', ok: true, results: [] });

      const result = await promise;
      expect(result.ok).toBe(true);

      // Advancing past 30s should not cause issues
      await vi.advanceTimersByTimeAsync(60_000);
    });
  });

  /* ── Tab resolution ──────────────────────────────────────── */

  describe('tab resolution', () => {
    it('uses active tab when no tabId in request', async () => {
      const tm = makeTabManager({ getActiveTabId: vi.fn().mockReturnValue('active-tab') });
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      bridge.executeRequest({ requestId: 'req-1', actions: makeActions() });

      expect(tm.injectJs).toHaveBeenCalledWith('active-tab', expect.any(String));
    });

    it('uses specified tabId over active tab', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      bridge.executeRequest({ requestId: 'req-1', tabId: 'specified-tab', actions: makeActions() });

      expect(tm.injectJs).toHaveBeenCalledWith('specified-tab', expect.any(String));
    });

    it('throws when no tab is available', async () => {
      const tm = makeTabManager({ getActiveTabId: vi.fn().mockReturnValue(null) });
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      await expect(
        bridge.executeRequest({ actions: makeActions() }),
      ).rejects.toThrow('No active tab for dom automation');
    });
  });

  /* ── Injection failure ───────────────────────────────────── */

  describe('injection failure', () => {
    it('throws on injectJs failure and cleans up pending', async () => {
      const tm = makeTabManager({
        injectJs: vi.fn().mockRejectedValue(new Error('Webview unavailable')),
      });
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      await expect(
        bridge.executeRequest({ requestId: 'req-inj', actions: makeActions() }),
      ).rejects.toThrow('Dom automation injection failed: Webview unavailable');
    });
  });

  /* ── Activity tracking ───────────────────────────────────── */

  describe('activity tracking', () => {
    it('calls onActivityChange when activity starts and stops', async () => {
      const onChange = vi.fn();
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm, { onActivityChange: onChange });
      await bridge.start();

      const promise = bridge.executeRequest({ requestId: 'act-1', actions: makeActions() });

      // Activity started (1 pending)
      expect(onChange).toHaveBeenCalledWith(true, 1);

      emitResult({ requestId: 'act-1', ok: true, results: [] });
      await promise;

      // Activity stopped (0 pending)
      expect(onChange).toHaveBeenCalledWith(false, 0);
    });

    it('tracks multiple concurrent requests', async () => {
      const onChange = vi.fn();
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm, { onActivityChange: onChange });
      await bridge.start();

      const p1 = bridge.executeRequest({ requestId: 'c-1', actions: makeActions() });
      expect(onChange).toHaveBeenLastCalledWith(true, 1);

      bridge.executeRequest({ requestId: 'c-2', actions: makeActions() });
      expect(onChange).toHaveBeenLastCalledWith(true, 2);

      emitResult({ requestId: 'c-1', ok: true, results: [] });
      await p1;
      expect(onChange).toHaveBeenLastCalledWith(true, 1);
    });
  });

  /* ── Script content ──────────────────────────────────────── */

  describe('script content', () => {
    it('includes bootstrap and run call with serialized request', async () => {
      const tm = makeTabManager();
      const bridge = new DomAutomationBridge(tm);
      await bridge.start();

      bridge.executeRequest({ requestId: 'sc-1', actions: makeActions() });

      const script: string = tm.injectJs.mock.calls[0][1];
      expect(script).toContain('window.__CLAW_DOM__');
      expect(script).toContain('window.__CLAW_DOM__.run(');
      expect(script).toContain('"requestId":"sc-1"');
      expect(script).toContain('"actions"');
    });
  });
});
