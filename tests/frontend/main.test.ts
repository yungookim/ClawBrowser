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
  vaultUIShow: vi.fn(),
  vaultUIHide: vi.fn(),
  vaultUISetEncryptedData: vi.fn(),
  vaultUISetOnUnlock: vi.fn(),
  vaultUISetMissingVaultData: vi.fn(),
  vaultUISetOnRecover: vi.fn(),
  vaultOnUnlock: null as null | (() => void),
  vaultOnRecover: null as null | (() => void),
  wizardShow: vi.fn(),
  wizardSetOnComplete: vi.fn(),
  wizardOnComplete: null as null | ((result: any) => void),
  vaultGet: vi.fn(),
  vaultSet: vi.fn(),
  vaultExport: vi.fn(),
  vaultImport: vi.fn(),
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
    tabUpdate = vi.fn();
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

vi.mock('../../src/vault/Vault', () => ({
  Vault: class {
    isUnlocked = true;
    unlock = vi.fn();
    get = (...args: any[]) => mocks.vaultGet(...args);
    set = (...args: any[]) => mocks.vaultSet(...args);
    exportEncrypted = (...args: any[]) => mocks.vaultExport(...args);
    importEncrypted = (...args: any[]) => mocks.vaultImport(...args);
  },
}));

vi.mock('../../src/vault/VaultUI', () => ({
  VaultUI: class {
    constructor(_vault: unknown) {}
    show(): void { mocks.vaultUIShow(); }
    hide(): void { mocks.vaultUIHide(); }
    setEncryptedData(data: string | null): void { mocks.vaultUISetEncryptedData(data); }
    setMissingVaultData(missing: boolean): void { mocks.vaultUISetMissingVaultData(missing); }
    setOnUnlock(handler: () => void): void {
      mocks.vaultUISetOnUnlock();
      mocks.vaultOnUnlock = handler;
    }
    setOnRecover(handler: () => void): void {
      mocks.vaultUISetOnRecover();
      mocks.vaultOnRecover = handler;
    }
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
    mocks.sidecarGetConfig.mockResolvedValue({
      onboardingComplete: false,
      workspacePath: null,
      models: {},
      commandAllowlist: [],
    });
    mocks.sidecarLoadVault.mockResolvedValue({ data: null });
    mocks.sidecarSaveVault.mockResolvedValue({ status: 'ok' });
    mocks.sidecarUpdateConfig.mockResolvedValue({ status: 'ok' });
    mocks.sidecarConfigureModel.mockResolvedValue(undefined);
    mocks.vaultGet.mockResolvedValue(undefined);
    mocks.vaultSet.mockResolvedValue(undefined);
    mocks.vaultExport.mockResolvedValue('encrypted');
    mocks.vaultImport.mockResolvedValue(undefined);
    mocks.voiceOnResult = null;
    mocks.resizeHandler = null;
    mocks.vaultOnUnlock = null;
    mocks.vaultOnRecover = null;
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

    mocks.resizeHandler?.();
    expect(mocks.invoke).toHaveBeenCalledWith('reposition_tabs');
  });

  it('shows vault UI when onboarding is complete and configures models on unlock', async () => {
    mocks.sidecarGetConfig.mockResolvedValueOnce({
      onboardingComplete: true,
      workspacePath: null,
      models: {
        primary: { provider: 'openai', model: 'gpt-4o' },
      },
      commandAllowlist: [],
    });
    mocks.sidecarLoadVault.mockResolvedValueOnce({ data: 'vault-data' });
    mocks.vaultGet.mockResolvedValueOnce('sk-test');

    await import('../../src/main');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mocks.vaultUISetEncryptedData).toHaveBeenCalledWith('vault-data');
    expect(mocks.vaultUIShow).toHaveBeenCalled();

    mocks.vaultOnUnlock?.();
    await new Promise(resolve => setTimeout(resolve, 0));

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
