import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  resizeHandler: null as null | (() => void),
  tabManagerInit: vi.fn(),
  createTab: vi.fn(),
  sidecarStart: vi.fn(),
  sidecarAgentQuery: vi.fn(),
  sidecarGetConfig: vi.fn(),
  sidecarLoadVault: vi.fn(),
  sidecarSaveVault: vi.fn(),
  sidecarUpdateConfig: vi.fn(),
  sidecarConfigureModel: vi.fn(),
  voiceOnResult: null as null | ((transcript: string) => void),
  wizardShow: vi.fn(),
  wizardSetOnComplete: vi.fn(),
  wizardOnComplete: null as null | ((result: any) => void),
  vaultStoreGet: vi.fn(),
  vaultStoreSet: vi.fn(),
  vaultStoreExportPlaintext: vi.fn(),
  vaultStoreImportPlaintext: vi.fn(),
}));

const matrixMocks = vi.hoisted(() => ({
  options: null as null | { watermark?: { lines: string[] } },
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
    switchTab = vi.fn();
    closeTab = vi.fn();
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
  },
}));

vi.mock('../../src/agent/SidecarBridge', () => ({
  SidecarBridge: class {
    start = mocks.sidecarStart;
    agentQuery = mocks.sidecarAgentQuery;
    getConfig = mocks.sidecarGetConfig;
    loadVault = mocks.sidecarLoadVault;
    saveVault = mocks.sidecarSaveVault;
    updateConfig = mocks.sidecarUpdateConfig;
    configureModel = mocks.sidecarConfigureModel;
    onNotification = vi.fn();
    tabUpdate = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../src/agent/AgentPanel', () => ({
  AgentPanel: class {
    constructor(_el: HTMLElement, _bridge: unknown, _tm: unknown) {}
  },
}));

vi.mock('../../src/ui/MatrixBackground', () => ({
  MatrixBackground: class {
    constructor(_el: HTMLElement, options?: { watermark?: { lines: string[] } }) {
      matrixMocks.options = options ?? null;
    }
    start = vi.fn();
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

vi.mock('../../src/vault/VaultStore', () => ({
  VaultStore: class {
    get = (...args: any[]) => mocks.vaultStoreGet(...args);
    set = (...args: any[]) => mocks.vaultStoreSet(...args);
    exportPlaintext = (...args: any[]) => mocks.vaultStoreExportPlaintext(...args);
    importPlaintext = (...args: any[]) => mocks.vaultStoreImportPlaintext(...args);
  },
}));

vi.mock('../../src/onboarding/Wizard', () => ({
  Wizard: class {
    constructor(_vault: unknown) {}
    setOnComplete(handler: (result: any) => void): void {
      mocks.wizardSetOnComplete();
      mocks.wizardOnComplete = handler;
    }
    show(): void { mocks.wizardShow(); }
  },
}));

describe('main bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.textContent = '';
    const app = document.createElement('div');
    app.id = 'app';
    const navBar = document.createElement('div');
    navBar.id = 'nav-bar';
    const agentPanel = document.createElement('div');
    agentPanel.id = 'agent-panel';
    app.appendChild(navBar);
    app.appendChild(agentPanel);
    document.body.appendChild(app);
    mocks.invoke.mockResolvedValue(undefined);
    mocks.tabManagerInit.mockResolvedValue(undefined);
    mocks.createTab.mockResolvedValue('tab-1');
    mocks.sidecarStart.mockResolvedValue(undefined);
    mocks.sidecarAgentQuery.mockResolvedValue('ok');
    mocks.sidecarGetConfig.mockResolvedValue({
      onboardingComplete: false,
      workspacePath: null,
      models: {},
      commandAllowlist: [],
      agentControl: {},
    });
    mocks.sidecarLoadVault.mockResolvedValue({ data: null });
    mocks.sidecarSaveVault.mockResolvedValue({ status: 'ok' });
    mocks.sidecarUpdateConfig.mockResolvedValue({ status: 'ok' });
    mocks.sidecarConfigureModel.mockResolvedValue(undefined);
    mocks.vaultStoreGet.mockResolvedValue(undefined);
    mocks.vaultStoreSet.mockResolvedValue(undefined);
    mocks.vaultStoreExportPlaintext.mockResolvedValue('{"entries":{}}');
    mocks.vaultStoreImportPlaintext.mockResolvedValue(undefined);
    mocks.voiceOnResult = null;
    mocks.resizeHandler = null;
    matrixMocks.options = null;
  });

  it('initializes UI and wires handlers', async () => {
    await import('../../src/main');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mocks.tabManagerInit).toHaveBeenCalledTimes(1);
    expect(mocks.createTab).not.toHaveBeenCalled();
    expect(mocks.sidecarStart).toHaveBeenCalledTimes(1);
    expect(mocks.wizardShow).toHaveBeenCalledTimes(1);

    mocks.voiceOnResult?.('hello');
    expect(mocks.sidecarAgentQuery).toHaveBeenCalledWith('hello');

    expect(mocks.resizeHandler).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalledWith('reposition_tabs');
    expect(matrixMocks.options?.watermark?.lines).toEqual([
      'CLAWBROWSER',
      'THE SMARTEST CHILD OF OPENCLAW.',
    ]);
  });

  it('loads vault and configures models when onboarding is complete', async () => {
    mocks.sidecarGetConfig.mockResolvedValueOnce({
      onboardingComplete: true,
      workspacePath: null,
      models: {
        primary: { provider: 'openai', model: 'gpt-4o' },
      },
      commandAllowlist: [],
      agentControl: {},
    });
    mocks.sidecarLoadVault.mockResolvedValueOnce({ data: '{"entries":{"apikey:primary":"sk-test"}}' });
    mocks.vaultStoreGet.mockResolvedValueOnce('sk-test');

    await import('../../src/main');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mocks.vaultStoreImportPlaintext).toHaveBeenCalledWith('{"entries":{"apikey:primary":"sk-test"}}');
    expect(mocks.sidecarConfigureModel).toHaveBeenCalledWith(
      'openai',
      'gpt-4o',
      'sk-test',
      'primary',
      undefined,
      undefined,
    );
  });
});
