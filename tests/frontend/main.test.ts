import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  resizeHandler: null as null | (() => void),
  tabManagerInit: vi.fn(),
  createTab: vi.fn(),
  sidecarStart: vi.fn(),
  sidecarAgentQuery: vi.fn(),
  agentToggleHandler: null as null | (() => void),
  voiceOnResult: null as null | ((transcript: string) => void),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mocks.invoke(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: () => void) => {
    if (event === 'tauri://resize') {
      mocks.resizeHandler = handler;
    }
    return Promise.resolve(() => {});
  },
}));

vi.mock('../../src/tabs/TabManager', () => ({
  TabManager: class {
    init = mocks.tabManagerInit;
    createTab = mocks.createTab;
    getTabs = vi.fn().mockReturnValue([]);
    getActiveTabId = vi.fn().mockReturnValue(null);
    getActiveTab = vi.fn().mockReturnValue(null);
    onChange = vi.fn();
    canGoBack = vi.fn().mockReturnValue(false);
    canGoForward = vi.fn().mockReturnValue(false);
    navigate = vi.fn();
    goBack = vi.fn();
    goForward = vi.fn();
  },
}));

vi.mock('../../src/tabs/TabBar', () => ({
  TabBar: class {
    constructor(_el: HTMLElement, _tm: unknown) {}
  },
}));

vi.mock('../../src/navigation/NavBar', () => ({
  NavBar: class {
    constructor(_el: HTMLElement, _tm: unknown) {}
    setAgentToggleHandler(handler: () => void): void {
      mocks.agentToggleHandler = handler;
    }
  },
}));

vi.mock('../../src/agent/SidecarBridge', () => ({
  SidecarBridge: class {
    start = mocks.sidecarStart;
    agentQuery = mocks.sidecarAgentQuery;
    onNotification = vi.fn();
  },
}));

vi.mock('../../src/agent/AgentPanel', () => ({
  AgentPanel: class {
    constructor(_el: HTMLElement, _bridge: unknown, _tm: unknown) {}
  },
}));

vi.mock('../../src/voice/VoiceInput', () => ({
  VoiceInput: class {
    constructor(_el: HTMLElement) {}
    setOnResult(handler: (transcript: string) => void): void {
      mocks.voiceOnResult = handler;
    }
  },
}));

describe('main bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <div id="tab-bar"></div>
      <div id="nav-bar"></div>
      <div id="agent-panel"></div>
    `;
    mocks.invoke.mockResolvedValue(undefined);
    mocks.tabManagerInit.mockResolvedValue(undefined);
    mocks.createTab.mockResolvedValue('tab-1');
    mocks.sidecarStart.mockResolvedValue(undefined);
    mocks.sidecarAgentQuery.mockResolvedValue('ok');
    mocks.agentToggleHandler = null;
    mocks.voiceOnResult = null;
    mocks.resizeHandler = null;
  });

  it('initializes UI and wires handlers', async () => {
    await import('../../src/main');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mocks.tabManagerInit).toHaveBeenCalledTimes(1);
    expect(mocks.createTab).toHaveBeenCalledWith('about:blank');
    expect(mocks.sidecarStart).toHaveBeenCalledTimes(1);

    const panel = document.getElementById('agent-panel') as HTMLElement;
    expect(panel.classList.contains('open')).toBe(false);
    mocks.agentToggleHandler?.();
    expect(panel.classList.contains('open')).toBe(true);

    mocks.voiceOnResult?.('hello');
    expect(mocks.sidecarAgentQuery).toHaveBeenCalledWith('hello');

    mocks.resizeHandler?.();
    expect(mocks.invoke).toHaveBeenCalledWith('reposition_tabs');
  });
});
