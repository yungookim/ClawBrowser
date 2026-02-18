import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsPanel } from '../../src/settings/SettingsPanel';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

describe('SettingsPanel', () => {
  let container: HTMLElement;
  let bridge: any;
  let tabManager: any;
  let vault: any;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root') as HTMLElement;

    bridge = {
      ping: vi.fn().mockResolvedValue({ uptime: 0 }),
      getStatus: vi.fn().mockResolvedValue({
        uptime: 0,
        heartbeat: {
          lastPulse: '',
          uptime: 0,
          activeTabs: 0,
          activeTabTitle: '',
          currentContext: '',
          pendingActions: [],
        },
        modelsConfigured: 0,
        historyLength: 0,
      }),
      getMemory: vi.fn().mockResolvedValue({ files: {}, memories: [] }),
      listModels: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue({ commandAllowlist: [] }),
      listLogs: vi.fn().mockResolvedValue([]),
      updateConfig: vi.fn().mockResolvedValue({ status: 'ok' }),
      configureModel: vi.fn().mockResolvedValue(undefined),
      saveVault: vi.fn().mockResolvedValue({ status: 'ok' }),
      triggerReflection: vi.fn().mockResolvedValue({ status: 'ok' }),
      readLog: vi.fn().mockResolvedValue({ date: '', content: '' }),
    };

    tabManager = {
      onChange: vi.fn(),
      getActiveTabId: vi.fn().mockReturnValue(null),
      switchTab: vi.fn(),
    };

    vault = {
      isUnlocked: true,
      set: vi.fn().mockResolvedValue(undefined),
      exportEncrypted: vi.fn().mockResolvedValue('encrypted'),
    };
  });

  it('saves allowlist entries', async () => {
    const panel = new SettingsPanel(container, bridge, tabManager);
    panel.toggle();
    await new Promise(resolve => setTimeout(resolve, 0));

    const commandInput = container.querySelector('input[name="command"]') as HTMLInputElement;
    const regexInput = container.querySelector('textarea[name="argsRegex"]') as HTMLTextAreaElement;
    commandInput.value = 'codex';
    regexInput.value = '^--project$\n^.+$';

    const form = container.querySelector('form[data-form="allowlist"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(bridge.updateConfig).toHaveBeenCalledWith({
      commandAllowlist: [
        { command: 'codex', argsRegex: ['^--project$', '^.+$'] },
      ],
    });

    const removeBtn = container.querySelector('.settings-inline-btn') as HTMLButtonElement;
    removeBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(bridge.updateConfig).toHaveBeenLastCalledWith({
      commandAllowlist: [],
    });
  });

  it('starts setup wizard when confirmed', async () => {
    const onStartSetupWizard = vi.fn();
    const panel = new SettingsPanel(container, bridge, tabManager, undefined, onStartSetupWizard);
    panel.toggle();
    await new Promise(resolve => setTimeout(resolve, 0));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const resetBtn = container.querySelector('[data-action="setup-wizard"]') as HTMLButtonElement;
    resetBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(bridge.updateConfig).toHaveBeenCalledWith({ onboardingComplete: false });
    expect(onStartSetupWizard).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('saves models and persists API keys when vault unlocked', async () => {
    const panel = new SettingsPanel(container, bridge, tabManager, vault);
    panel.toggle();
    await new Promise(resolve => setTimeout(resolve, 0));

    const modelInput = container.querySelector('input[name="model"]') as HTMLInputElement;
    const apiKeyInput = container.querySelector('input[name="apiKey"]') as HTMLInputElement;
    const roleSelect = container.querySelector('select[name="role"]') as HTMLSelectElement;

    modelInput.value = 'gpt-4o';
    apiKeyInput.value = 'sk-test';
    roleSelect.value = 'secondary';

    const form = container.querySelector('form[data-form="model"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(bridge.configureModel).toHaveBeenCalledWith(
      'openai',
      'gpt-4o',
      'sk-test',
      'secondary',
      undefined,
      undefined,
    );

    expect(bridge.updateConfig).toHaveBeenCalledWith({
      models: {
        secondary: {
          provider: 'openai',
          model: 'gpt-4o',
          baseUrl: undefined,
          temperature: undefined,
        },
      },
    });

    expect(vault.set).toHaveBeenCalledWith('apikey:secondary', 'sk-test');
    expect(bridge.saveVault).toHaveBeenCalledWith('encrypted');
  });
});
