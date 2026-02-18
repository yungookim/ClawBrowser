import { TabManager } from '../tabs/TabManager';

export class NavBar {
  private container: HTMLElement;
  private tabManager: TabManager;
  private urlInput!: HTMLInputElement;
  private backBtn!: HTMLButtonElement;
  private forwardBtn!: HTMLButtonElement;
  private refreshBtn!: HTMLButtonElement;
  private agentToggleBtn!: HTMLButtonElement;
  private settingsBtn!: HTMLButtonElement;
  private onSettingsToggle: (() => void) | null = null;
  private onAgentToggle: (() => void) | null = null;

  constructor(container: HTMLElement, tabManager: TabManager, options?: { onSettingsToggle?: () => void }) {
    this.container = container;
    this.tabManager = tabManager;
    this.onSettingsToggle = options?.onSettingsToggle ?? null;
    this.build();

    // Subscribe to tab changes to update URL bar
    this.tabManager.onChange((_tabs, _activeId) => {
      this.updateState();
    });
  }

  private build(): void {
    // Back button
    this.backBtn = document.createElement('button');
    this.backBtn.className = 'nav-btn';
    this.backBtn.textContent = '\u2190';
    this.backBtn.title = 'Back';
    this.backBtn.addEventListener('click', () => {
      this.tabManager.goBack();
    });
    this.container.appendChild(this.backBtn);

    // Forward button
    this.forwardBtn = document.createElement('button');
    this.forwardBtn.className = 'nav-btn';
    this.forwardBtn.textContent = '\u2192';
    this.forwardBtn.title = 'Forward';
    this.forwardBtn.addEventListener('click', () => {
      this.tabManager.goForward();
    });
    this.container.appendChild(this.forwardBtn);

    // Refresh button
    this.refreshBtn = document.createElement('button');
    this.refreshBtn.className = 'nav-btn';
    this.refreshBtn.textContent = '\u21BB';
    this.refreshBtn.title = 'Refresh';
    this.refreshBtn.addEventListener('click', () => {
      const tab = this.tabManager.getActiveTab();
      if (tab) {
        this.tabManager.navigate(tab.url);
      }
    });
    this.container.appendChild(this.refreshBtn);

    // Agent toggle button
    this.agentToggleBtn = document.createElement('button');
    this.agentToggleBtn.className = 'nav-btn agent-toggle';
    this.agentToggleBtn.textContent = 'Agent';
    this.agentToggleBtn.title = 'Toggle Agent Panel';
    this.agentToggleBtn.addEventListener('click', () => {
      this.onAgentToggle?.();
    });
    this.container.appendChild(this.agentToggleBtn);

    // URL input
    this.urlInput = document.createElement('input');
    this.urlInput.className = 'url-input';
    this.urlInput.type = 'text';
    this.urlInput.placeholder = 'Search or enter URL';
    this.urlInput.spellcheck = false;
    this.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = this.urlInput.value.trim();
        if (value) {
          this.tabManager.navigate(value);
          this.urlInput.blur();
        }
      }
    });
    this.urlInput.addEventListener('focus', () => {
      this.urlInput.select();
    });
    this.container.appendChild(this.urlInput);

    // Settings button
    this.settingsBtn = document.createElement('button');
    this.settingsBtn.className = 'nav-btn settings-btn';
    this.settingsBtn.textContent = 'Settings';
    this.settingsBtn.title = 'Settings';
    this.settingsBtn.addEventListener('click', () => {
      if (this.onSettingsToggle) {
        this.onSettingsToggle();
      }
    });
    this.container.appendChild(this.settingsBtn);

    this.updateState();
  }

  setAgentToggleHandler(handler: () => void): void {
    this.onAgentToggle = handler;
  }

  focusUrlInput(): void {
    if (!this.urlInput) return;
    this.urlInput.focus();
    this.urlInput.select();
  }

  setSettingsOpen(open: boolean): void {
    if (!this.settingsBtn) return;
    this.settingsBtn.classList.toggle('active', open);
  }

  private updateState(): void {
    const tab = this.tabManager.getActiveTab();
    if (tab) {
      // Only update URL if the input is not focused (user might be typing)
      if (document.activeElement !== this.urlInput) {
        this.urlInput.value = tab.url === 'about:blank' ? '' : tab.url;
      }
    } else {
      this.urlInput.value = '';
    }

    this.backBtn.disabled = !this.tabManager.canGoBack();
    this.forwardBtn.disabled = !this.tabManager.canGoForward();
    this.refreshBtn.disabled = !tab;
  }
}
