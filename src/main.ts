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

async function bootstrap(): Promise<void> {
  const tabManager = new TabManager();
  await tabManager.init();

  const tabBarEl = document.getElementById('tab-bar');
  const navBarEl = document.getElementById('nav-bar');
  const agentPanelEl = document.getElementById('agent-panel');
  const contentColumnEl = document.getElementById('content-column');
  const contentSpacerEl = document.getElementById('content-spacer');
  const appEl = document.getElementById('app');

  if (!tabBarEl || !navBarEl || !agentPanelEl || !contentColumnEl || !contentSpacerEl || !appEl) {
    throw new Error('Missing required DOM elements');
  }

  // Initialize UI components
  new TabBar(tabBarEl, tabManager);

  // Sidecar bridge
  const sidecar = new SidecarBridge();
  try {
    await sidecar.start();
  } catch (err) {
    console.warn('Sidecar not available yet:', err);
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

  // Agent panel
  const agentPanel = new AgentPanel(agentPanelEl, sidecar, tabManager);

  const settingsPanel = new SettingsPanel(contentSpacerEl, sidecar, tabManager);
  const navBar = new NavBar(navBarEl, tabManager, {
    onSettingsToggle: () => settingsPanel.toggle(),
  });
  settingsPanel.setOnVisibilityChange((visible) => {
    navBar.setSettingsOpen(visible);
  });

  const registerShortcuts = () => {
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.repeat) return;

      const key = event.key.toLowerCase();
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;

      if (!hasPrimaryModifier || event.altKey) return;

      if (key === 't' && !event.shiftKey) {
        event.preventDefault();
        tabManager.createTab('about:blank').catch((err) => {
          console.error('Failed to create tab:', err);
        });
        return;
      }

      if (key === 'w' && !event.shiftKey) {
        event.preventDefault();
        const activeId = tabManager.getActiveTabId();
        if (activeId) {
          tabManager.closeTab(activeId).catch((err) => {
            console.error('Failed to close tab:', err);
          });
        }
        return;
      }

      if (key === 'l' && !event.shiftKey) {
        event.preventDefault();
        agentPanel.focusPrompt();
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

  const resizeObserver = new ResizeObserver(() => scheduleSync());
  resizeObserver.observe(appEl);
  resizeObserver.observe(contentColumnEl);
  resizeObserver.observe(navBarEl);

  window.addEventListener('load', () => scheduleSync(), { once: true });
  scheduleSync();

  // Window resize: reposition content webviews
  await listen('tauri://resize', () => scheduleSync());

  // Create initial tab
  await tabManager.createTab('about:blank');

  console.log('ClawBrowser chrome initialized');
}

bootstrap().catch((err) => {
  console.error('ClawBrowser bootstrap failed:', err);
});
