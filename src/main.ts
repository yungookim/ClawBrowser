import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TabManager } from './tabs/TabManager';
import { TabBar } from './tabs/TabBar';
import { NavBar } from './navigation/NavBar';
import { SidecarBridge } from './agent/SidecarBridge';
import { AgentPanel } from './agent/AgentPanel';
import { VoiceInput } from './voice/VoiceInput';
import { SettingsPanel } from './settings/SettingsPanel';
import { DebugCapture } from './debug/DebugCapture';
import { DomAutomationBridge } from './automation/DomAutomationBridge';
import { SidecarAutomationRouter } from './automation/SidecarAutomationRouter';
import { Vault } from './vault/Vault';
import { VaultUI } from './vault/VaultUI';
import { Wizard, type ModelRole } from './onboarding/Wizard';
import { providerRequiresApiKey } from './shared/providerDefaults';

async function bootstrap(): Promise<void> {
  const tabManager = new TabManager();
  await tabManager.init();

  const tabBarEl = document.getElementById('tab-bar');
  const navBarEl = document.getElementById('nav-bar');
  const agentPanelEl = document.getElementById('agent-panel');
  const contentColumnEl = document.getElementById('content-column');
  const contentSpacerEl = document.getElementById('content-spacer');
  const appEl = document.getElementById('app');

  if (!tabBarEl || !navBarEl || !agentPanelEl) {
    throw new Error('Missing required DOM elements');
  }

  const hasLayout = Boolean(contentColumnEl && contentSpacerEl && appEl);

  // Initialize UI components
  const tabBar = new TabBar(tabBarEl, tabManager);

  // Sidecar bridge
  const sidecar = new SidecarBridge();
  try {
    await sidecar.start();
  } catch (err) {
    console.warn('Sidecar not available yet:', err);
  }

  const vault = new Vault(0);
  const vaultUI = new VaultUI(vault);
  vaultUI.hide();
  let vaultLocked = false;
  let vaultRestoreTabId: string | null = null;
  let onboardingActive = false;
  let onboardingRestoreTabId: string | null = null;
  let settingsPanel: SettingsPanel | null = null;

  const configureModelsFromVault = async (config: {
    models: Record<string, { provider: string; model: string; baseUrl?: string; temperature?: number }>;
  }) => {
    const roles: ModelRole[] = ['primary', 'secondary', 'subagent'];
    const missingKeys: Array<{ role: ModelRole; provider: string; model: string }> = [];
    for (const role of roles) {
      const model = config.models?.[role];
      if (!model) continue;
      let apiKey: string | undefined;
      try {
        apiKey = await vault.get(`apikey:${role}`);
      } catch {
        apiKey = undefined;
      }
      if (providerRequiresApiKey(model.provider) && !apiKey) {
        missingKeys.push({ role, provider: model.provider, model: model.model });
        continue;
      }
      await sidecar.configureModel(
        model.provider,
        model.model,
        apiKey,
        role,
        model.baseUrl,
        model.temperature,
      );
    }
    if (missingKeys.length > 0) {
      const summary = missingKeys
        .map((entry) => `${entry.role} ${entry.provider}/${entry.model}`)
        .join(', ');
      console.warn(`Missing API keys for configured models: ${summary}`);
    }
  };

  const enterVaultLockedState = () => {
    vaultLocked = true;
    vaultRestoreTabId = tabManager.getActiveTabId() || tabManager.getTabs()[0]?.id || null;
    tabBar.setLocked(true);
    invoke('hide_all_tabs').catch((err) => {
      console.warn('Failed to hide tabs for vault lock:', err);
    });
  };

  const restoreVaultTabs = async () => {
    vaultLocked = false;
    tabBar.setLocked(false);
    if (settingsPanel?.isVisible()) {
      await invoke('hide_all_tabs');
      vaultRestoreTabId = null;
      return;
    }
    const tabs = tabManager.getTabs();
    const tabIds = new Set(tabs.map((tab) => tab.id));
    const preferredId = vaultRestoreTabId && tabIds.has(vaultRestoreTabId)
      ? vaultRestoreTabId
      : tabManager.getActiveTabId();
    const fallbackId = tabs[0]?.id;
    const targetId = (preferredId && tabIds.has(preferredId)) ? preferredId : fallbackId;

    if (targetId) {
      await tabManager.switchTab(targetId);
    } else {
      await tabManager.createTab('about:blank');
    }
    vaultRestoreTabId = null;
  };

  vault.onLock(() => {
    enterVaultLockedState();
  });

  const setVaultUnlockHandler = (config: {
    models: Record<string, { provider: string; model: string; baseUrl?: string; temperature?: number }>;
  }) => {
    vaultUI.setOnUnlock(() => {
      configureModelsFromVault(config).catch((err) => {
        console.warn('Failed to configure models from vault:', err);
      });
      restoreVaultTabs().catch((err) => {
        console.warn('Failed to restore tabs after vault unlock:', err);
      });
    });
  };

  const restoreContentTabs = async () => {
    try {
      if (settingsPanel?.isVisible()) {
        if (tabManager.getTabs().length === 0) {
          await tabManager.createTab('about:blank');
        }
        await invoke('hide_all_tabs');
        onboardingRestoreTabId = null;
        return;
      }

      const tabs = tabManager.getTabs();
      const tabIds = new Set(tabs.map((tab) => tab.id));
      const preferredId = onboardingRestoreTabId && tabIds.has(onboardingRestoreTabId)
        ? onboardingRestoreTabId
        : tabManager.getActiveTabId();
      const fallbackId = tabs[0]?.id;
      const targetId = (preferredId && tabIds.has(preferredId)) ? preferredId : fallbackId;

      if (targetId) {
        await tabManager.switchTab(targetId);
      } else {
        await tabManager.createTab('about:blank');
      }
    } catch (err) {
      console.warn('Failed to restore tabs after onboarding:', err);
    } finally {
      onboardingRestoreTabId = null;
    }
  };

  const startSetupWizard = async ({ freshVault }: { freshVault: boolean }): Promise<void> => {
    if (onboardingActive) {
      return;
    }
    onboardingActive = true;
    vaultUI.setMissingVaultData(false);
    onboardingRestoreTabId = tabManager.getActiveTabId();
    invoke('hide_all_tabs').catch((err) => {
      console.warn('Failed to hide tabs for onboarding:', err);
    });

    let existingVaultData: string | null = null;
    if (!freshVault) {
      try {
        const { data } = await sidecar.loadVault();
        existingVaultData = data || null;
      } catch (err) {
        console.warn('Failed to load vault data for setup wizard:', err);
      }
    }

    const wizard = new Wizard(vault, existingVaultData);
    wizard.setOnComplete(async (result) => {
      try {
        const modelsPayload: Record<string, { provider: string; model: string; baseUrl?: string; temperature?: number }> = {};
        for (const role of Object.keys(result.models) as ModelRole[]) {
          const model = result.models[role];
          if (!model) continue;
          modelsPayload[role] = {
            provider: model.provider,
            model: model.model,
            baseUrl: model.baseUrl,
            temperature: model.temperature,
          };
        }

        await sidecar.updateConfig({
          onboardingComplete: true,
          workspacePath: result.workspacePath,
          models: modelsPayload,
        });

        const encrypted = await vault.exportEncrypted();
        await sidecar.saveVault(encrypted);
        vaultUI.setEncryptedData(encrypted);
        vaultUI.setMissingVaultData(false);

        try {
          appConfig = await sidecar.getConfig();
          if (appConfig) {
            setVaultUnlockHandler(appConfig);
          }
        } catch (err) {
          console.warn('Failed to refresh config after onboarding:', err);
        }

        for (const role of Object.keys(result.models) as ModelRole[]) {
          const model = result.models[role];
          if (!model) continue;
          await sidecar.configureModel(
            model.provider,
            model.model,
            model.apiKey || undefined,
            role,
            model.baseUrl,
            model.temperature,
          );
        }
      } finally {
        onboardingActive = false;
        await restoreContentTabs();
      }
    });
    wizard.show();
  };

  vaultUI.setOnRecover(() => {
    const shouldRestart = window.confirm(
      'Restart the setup wizard and create a new vault? This will overwrite your existing vault data.'
    );
    if (!shouldRestart) return;
    vaultUI.hide();
    startSetupWizard({ freshVault: true }).catch((err) => {
      console.warn('Failed to start setup wizard:', err);
    });
  });

  let appConfig: {
    onboardingComplete: boolean;
    workspacePath: string | null;
    models: Record<string, { provider: string; model: string; baseUrl?: string; temperature?: number }>;
    commandAllowlist: Array<{ command: string; argsRegex: string[] }>;
  } | null = null;

  try {
    appConfig = await sidecar.getConfig();
  } catch (err) {
    console.warn('Failed to load config:', err);
  }

  if (appConfig && !appConfig.onboardingComplete) {
    await startSetupWizard({ freshVault: false });
  } else if (appConfig) {
    try {
      const { data } = await sidecar.loadVault();
      if (data) {
        vaultUI.setEncryptedData(data);
        vaultUI.setMissingVaultData(false);
      } else {
        vaultUI.setMissingVaultData(true);
      }
    } catch (err) {
      console.warn('Failed to load vault data:', err);
      vaultUI.setMissingVaultData(true);
    }
    setVaultUnlockHandler(appConfig);
    enterVaultLockedState();
    vaultUI.show();
  }

  const debugEnabled = import.meta.env.DEV || localStorage.getItem('claw:debug') === '1';
  const debugCapture = new DebugCapture(sidecar, tabManager, debugEnabled);
  debugCapture.start().catch(() => {
    // Ignore debug capture failures.
  });

  const domAutomation = new DomAutomationBridge(tabManager);
  await domAutomation.start();
  const domAutomationRouter = new SidecarAutomationRouter(sidecar, domAutomation);
  domAutomationRouter.start();

  tabManager.onChange((tabs, activeId) => {
    const active = tabs.find((tab) => tab.id === activeId);
    sidecar.tabUpdate(tabs.length, active?.title || '').catch(() => {
      // Sidecar might be offline; ignore.
    });
  });

  await listen('close-active-tab', () => {
    const activeId = tabManager.getActiveTabId();
    if (!activeId) return;
    tabManager.closeTab(activeId).catch((err) => {
      console.error('Failed to close tab:', err);
    });
  });

  await listen<{ tabId: string; url?: string; reason?: string }>('tab-open-request', (event) => {
    if (onboardingActive) {
      console.warn('Tab open request ignored during onboarding.');
      return;
    }
    if (vaultLocked) {
      console.warn('Tab open request ignored while vault locked.');
      return;
    }
    const { url, reason } = event.payload || {};
    if (!url) {
      console.warn('Tab open request missing URL');
      return;
    }
    tabManager.createTab(url).catch((err) => {
      console.error(`Failed to open new tab (${reason || 'request'}):`, err);
    });
  });

  // Agent panel
  new AgentPanel(agentPanelEl, sidecar, tabManager);

  settingsPanel = hasLayout && contentSpacerEl
    ? new SettingsPanel(contentSpacerEl, sidecar, tabManager, vault, () => {
      startSetupWizard({ freshVault: true }).catch((err) => {
        console.warn('Failed to start setup wizard:', err);
      });
    })
    : null;
  const navBar = new NavBar(navBarEl, tabManager, {
    onSettingsToggle: () => settingsPanel?.toggle(),
  });
  if (settingsPanel) {
    settingsPanel.setOnVisibilityChange((visible) => {
      navBar.setSettingsOpen(visible);
    });
  }

  const registerShortcuts = () => {
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.repeat) return;

      const key = event.key.toLowerCase();
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;

      if (!hasPrimaryModifier || event.altKey) return;

      if (key === 't' && !event.shiftKey) {
        event.preventDefault();
        if (onboardingActive || vaultLocked) {
          return;
        }
        tabManager.createTab('about:blank').catch((err) => {
          console.error('Failed to create tab:', err);
        });
        return;
      }

      if (key === 'l' && !event.shiftKey) {
        event.preventDefault();
        navBar.focusUrlInput();
      }
    });
  };

  registerShortcuts();

  // Voice input (appended to nav bar)
  const voiceInput = new VoiceInput(navBarEl);
  voiceInput.setOnResult((transcript) => {
    // Send voice transcription to agent
    sidecar.agentQuery(transcript).catch((err) => {
      console.error('Voice query failed:', err);
    });
  });

  const getCssPx = (name: string): number => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const syncContentBounds = async () => {
    if (!hasLayout || !contentColumnEl || !appEl) {
      return;
    }
    const appRect = appEl.getBoundingClientRect();
    const columnRect = contentColumnEl.getBoundingClientRect();
    const navRect = navBarEl.getBoundingClientRect();
    if (columnRect.width <= 1) {
      console.warn('[BOUNDS-JS] syncContentBounds SKIPPED: columnRect.width <= 1');
      return;
    }

    const cssAgentWidth = getCssPx('--agent-width');
    const cssTabsWidth = getCssPx('--tabs-width');
    const cssNavHeight = getCssPx('--nav-height');

    const columnOffsetLeft = columnRect.left - appRect.left;
    const columnOffsetTop = columnRect.top - appRect.top;

    let left = columnOffsetLeft;
    const cssLeft = cssAgentWidth + cssTabsWidth;
    if (cssLeft > 1 && left < cssLeft * 0.5) {
      left = cssLeft;
    }

    let navHeight = cssNavHeight;
    if (navHeight <= 1) {
      navHeight = navRect.height;
    }
    if (navHeight <= 1) {
      console.warn('[BOUNDS-JS] syncContentBounds SKIPPED: navHeight <= 1');
      return;
    }

    const top = columnOffsetTop + navHeight;
    const width = columnRect.width;
    const height = Math.max(0, columnRect.height - navHeight);

    const dpr = window.devicePixelRatio || 1;
    console.log(`[BOUNDS-JS] syncContentBounds:
  appRect: top=${appRect.top} left=${appRect.left} w=${appRect.width} h=${appRect.height}
  columnRect: top=${columnRect.top} left=${columnRect.left} w=${columnRect.width} h=${columnRect.height}
  navRect: top=${navRect.top} left=${navRect.left} w=${navRect.width} h=${navRect.height} bottom=${navRect.bottom}
  css: agent=${cssAgentWidth} tabs=${cssTabsWidth} nav=${cssNavHeight}
  columnOffsetLeft=${columnOffsetLeft} columnOffsetTop=${columnOffsetTop}
  SENDING bounds: left=${left} top=${top} width=${width} height=${height}
  devicePixelRatio=${dpr}
  window.innerWidth=${window.innerWidth} window.innerHeight=${window.innerHeight}
  navRect.bottom - appRect.top = ${navRect.bottom - appRect.top}`);

    await invoke('set_content_bounds', {
      bounds: { left, top, width, height },
    });
  };

  let pendingBounds = false;
  const scheduleSync = () => {
    if (pendingBounds) return;
    pendingBounds = true;
    requestAnimationFrame(() => {
      pendingBounds = false;
      syncContentBounds().catch((err) => {
        console.error('Reposition failed:', err);
      });
    });
  };

  if (hasLayout && contentColumnEl && appEl) {
    const resizeObserver = new ResizeObserver(() => scheduleSync());
    resizeObserver.observe(appEl);
    resizeObserver.observe(contentColumnEl);
    resizeObserver.observe(navBarEl);

    window.addEventListener('load', () => scheduleSync(), { once: true });
    scheduleSync();
  }

  // Window resize: reposition content webviews
  await listen('tauri://resize', () => {
    if (hasLayout) {
      scheduleSync();
      return;
    }
    invoke('reposition_tabs').catch((err) => {
      console.error('Reposition failed:', err);
    });
  });

  // Create initial tab
  if (!onboardingActive && !vaultLocked && tabManager.getTabs().length === 0) {
    await tabManager.createTab('about:blank');
  }

  console.log('ClawBrowser chrome initialized');
}

bootstrap().catch((err) => {
  console.error('ClawBrowser bootstrap failed:', err);
});
