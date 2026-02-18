import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TabManager } from './tabs/TabManager';
import { TabBar } from './tabs/TabBar';
import { NavBar } from './navigation/NavBar';
import { SidecarBridge } from './agent/SidecarBridge';
import { AgentPanel } from './agent/AgentPanel';
import { VoiceInput } from './voice/VoiceInput';

async function bootstrap(): Promise<void> {
  const tabManager = new TabManager();
  await tabManager.init();

  const tabBarEl = document.getElementById('tab-bar');
  const navBarEl = document.getElementById('nav-bar');
  const agentPanelEl = document.getElementById('agent-panel');

  if (!tabBarEl || !navBarEl || !agentPanelEl) {
    throw new Error('Missing required DOM elements');
  }

  // Initialize UI components
  new TabBar(tabBarEl, tabManager);
  const navBar = new NavBar(navBarEl, tabManager);

  // Sidecar bridge
  const sidecar = new SidecarBridge();
  try {
    await sidecar.start();
  } catch (err) {
    console.warn('Sidecar not available yet:', err);
  }

  // Agent panel
  new AgentPanel(agentPanelEl, sidecar, tabManager);

  // Agent panel toggle
  navBar.setAgentToggleHandler(() => {
    agentPanelEl.classList.toggle('open');
  });

  // Voice input (appended to nav bar)
  const voiceInput = new VoiceInput(navBarEl);
  voiceInput.setOnResult((transcript) => {
    // Send voice transcription to agent
    sidecar.agentQuery(transcript).catch((err) => {
      console.error('Voice query failed:', err);
    });
  });

  // Window resize: reposition content webviews
  await listen('tauri://resize', () => {
    invoke('reposition_tabs').catch((err) => {
      console.error('Reposition failed:', err);
    });
  });

  // Create initial tab
  await tabManager.createTab('about:blank');

  console.log('ClawBrowser chrome initialized');
}

bootstrap().catch((err) => {
  console.error('ClawBrowser bootstrap failed:', err);
});
