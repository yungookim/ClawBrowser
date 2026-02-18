import { TabManager } from './tabs/TabManager';
import { TabBar } from './tabs/TabBar';
import { NavBar } from './navigation/NavBar';

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

  // Agent panel toggle
  navBar.setAgentToggleHandler(() => {
    agentPanelEl.classList.toggle('open');
  });

  // Create initial tab
  await tabManager.createTab('about:blank');

  console.log('ClawBrowser chrome initialized');
}

bootstrap().catch((err) => {
  console.error('ClawBrowser bootstrap failed:', err);
});
