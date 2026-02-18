import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SidecarBridge } from '../../src/agent/SidecarBridge';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  listeners: new Map<string, (event: { payload: any }) => void>(),
  unlistenFns: [] as Array<ReturnType<typeof vi.fn>>,
  sidecarPath: '',
  stdoutHandler: null as null | ((line: string) => void),
  stderrHandler: null as null | ((line: string) => void),
  errorHandler: null as null | ((error: string) => void),
  closeHandler: null as null | ((data: { code: number | null; signal: number | null }) => void),
  child: {
    write: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  },
  spawn: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mocks.invoke(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (payload: any) => void) => {
    mocks.listeners.set(event, handler);
    const unlisten = vi.fn();
    mocks.unlistenFns.push(unlisten);
    return Promise.resolve(unlisten);
  },
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    sidecar: (path: string) => {
      mocks.sidecarPath = path;
      return {
        stdout: {
          on: (_event: string, handler: (line: string) => void) => {
            mocks.stdoutHandler = handler;
          },
        },
        stderr: {
          on: (_event: string, handler: (line: string) => void) => {
            mocks.stderrHandler = handler;
          },
        },
        on: (event: string, handler: (data: any) => void) => {
          if (event === 'error') mocks.errorHandler = handler;
          if (event === 'close') mocks.closeHandler = handler;
        },
        spawn: mocks.spawn,
      };
    },
  },
}));

describe('SidecarBridge', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.listeners.clear();
    mocks.unlistenFns.length = 0;
    mocks.stdoutHandler = null;
    mocks.stderrHandler = null;
    mocks.errorHandler = null;
    mocks.closeHandler = null;
    mocks.child.write.mockClear();
    mocks.child.kill.mockClear();
    mocks.spawn.mockImplementation(async () => mocks.child);
  });

  it('starts, wires listeners, and handles stdout', async () => {
    let nextId = 1;
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'start_sidecar') return undefined;
      if (cmd === 'sidecar_send') return nextId++;
      if (cmd === 'sidecar_receive') return undefined;
      return undefined;
    });

    const bridge = new SidecarBridge();
    await bridge.start();

    expect(mocks.listeners.has('sidecar-request')).toBe(true);
    expect(mocks.listeners.has('sidecar-message')).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith('start_sidecar');
    expect(mocks.sidecarPath).toBe('sidecar/clawbrowser-agent');

    mocks.stdoutHandler?.(' hello ');
    expect(mocks.invoke).toHaveBeenCalledWith('sidecar_receive', { message: 'hello' });
  });

  it('sends requests and resolves responses', async () => {
    let nextId = 1;
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'start_sidecar') return undefined;
      if (cmd === 'sidecar_send') return nextId++;
      return undefined;
    });

    const bridge = new SidecarBridge();
    await bridge.start();

    const responsePromise = bridge.send('ping', { foo: 'bar' });
    expect(mocks.invoke).toHaveBeenCalledWith('sidecar_send', { method: 'ping', params: { foo: 'bar' } });

    await new Promise(resolve => setTimeout(resolve, 0));
    const messageHandler = mocks.listeners.get('sidecar-message');
    messageHandler?.({
      payload: { jsonrpc: '2.0', id: 1, result: { pong: true } },
    });

    await expect(responsePromise).resolves.toEqual({ pong: true });
  });

  it('rejects errors from the sidecar response', async () => {
    let nextId = 1;
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'start_sidecar') return undefined;
      if (cmd === 'sidecar_send') return nextId++;
      return undefined;
    });

    const bridge = new SidecarBridge();
    await bridge.start();

    const responsePromise = bridge.send('fail');
    await new Promise(resolve => setTimeout(resolve, 0));
    const messageHandler = mocks.listeners.get('sidecar-message');
    messageHandler?.({
      payload: { jsonrpc: '2.0', id: 1, error: { code: -1, message: 'nope' } },
    });

    await expect(responsePromise).rejects.toThrow('nope');
  });

  it('writes sidecar-request payloads to stdin', async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const bridge = new SidecarBridge();
    await bridge.start();

    const requestHandler = mocks.listeners.get('sidecar-request');
    requestHandler?.({
      payload: { jsonrpc: '2.0', id: 9, method: 'doThing', params: { a: 1 } },
    });

    expect(mocks.child.write).toHaveBeenCalledWith(
      JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'doThing', params: { a: 1 } }) + '\n'
    );
  });

  it('notifies subscribers on sidecar notifications', async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const bridge = new SidecarBridge();
    await bridge.start();

    const handler = vi.fn();
    bridge.onNotification(handler);

    const messageHandler = mocks.listeners.get('sidecar-message');
    messageHandler?.({ payload: { method: 'agentReady', params: { ok: true } } });

    expect(handler).toHaveBeenCalledWith('agentReady', { ok: true });
  });

  it('rejects pending requests on stop', async () => {
    let nextId = 1;
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'start_sidecar') return undefined;
      if (cmd === 'sidecar_send') return nextId++;
      return undefined;
    });

    const bridge = new SidecarBridge();
    await bridge.start();

    const pending = bridge.send('pending');
    await bridge.stop();

    await expect(pending).rejects.toThrow('Sidecar stopped');
    expect(mocks.child.kill).toHaveBeenCalledTimes(1);
    expect(mocks.unlistenFns.length).toBe(2);
    for (const unlisten of mocks.unlistenFns) {
      expect(unlisten).toHaveBeenCalledTimes(1);
    }
  });

  it('throws when sending before start', async () => {
    const bridge = new SidecarBridge();
    await expect(bridge.send('ping')).rejects.toThrow('Sidecar not started');
  });
});
