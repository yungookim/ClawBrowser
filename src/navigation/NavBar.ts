import { TabManager } from '../tabs/TabManager';

export class NavBar {
  private container: HTMLElement;
  private tabManager: TabManager;
  private urlInput: HTMLInputElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private forwardBtn: HTMLButtonElement | null = null;
  private refreshBtn: HTMLButtonElement | null = null;
  private openSessionBtn!: HTMLButtonElement;
  private settingsBtn!: HTMLButtonElement;
  private onSettingsToggle: (() => void) | null = null;
  private onOpenSession: (() => void) | null = null;
  private showNavigation: boolean;

  constructor(
    container: HTMLElement,
    tabManager: TabManager,
    options?: { onSettingsToggle?: () => void; onOpenSession?: () => void; showNavigation?: boolean },
  ) {
    this.container = container;
    this.tabManager = tabManager;
    this.onSettingsToggle = options?.onSettingsToggle ?? null;
    this.onOpenSession = options?.onOpenSession ?? null;
    this.showNavigation = options?.showNavigation ?? true;
    this.container.classList.toggle('nav-bar-compact', !this.showNavigation);
    this.build();

    // Subscribe to tab changes to update URL bar
    this.tabManager.onChange((_tabs, _activeId) => {
      this.updateState();
    });
  }

  private build(): void {
    if (this.showNavigation) {
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

      // URL input
      this.urlInput = document.createElement('input');
      this.urlInput.className = 'url-input';
      this.urlInput.type = 'text';
      this.urlInput.placeholder = 'Search or enter URL';
      this.urlInput.spellcheck = false;
      this.urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const value = this.urlInput?.value.trim();
          if (value) {
            this.tabManager.navigate(value);
            this.urlInput?.blur();
          }
        }
      });
      this.urlInput.addEventListener('focus', () => {
        this.urlInput?.select();
      });
      this.container.appendChild(this.urlInput);
    }

    // Open Session button
    this.openSessionBtn = document.createElement('button');
    this.openSessionBtn.className = 'nav-btn session-btn';
    this.openSessionBtn.textContent = 'Open Session';
    this.openSessionBtn.title = 'Open browser session for login';
    this.openSessionBtn.disabled = !this.onOpenSession;
    this.openSessionBtn.addEventListener('click', () => {
      if (this.onOpenSession) {
        this.onOpenSession();
      }
    });
    this.container.appendChild(this.openSessionBtn);

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
    if (!this.showNavigation) {
      return;
    }
    const tab = this.tabManager.getActiveTab();
    if (tab) {
      // Only update URL if the input is not focused (user might be typing)
      if (this.urlInput && document.activeElement !== this.urlInput) {
        this.urlInput.value = tab.url === 'about:blank' ? '' : tab.url;
      }
    } else if (this.urlInput) {
      this.urlInput.value = '';
    }

    if (this.backBtn) {
      this.backBtn.disabled = !this.tabManager.canGoBack();
    }
    if (this.forwardBtn) {
      this.forwardBtn.disabled = !this.tabManager.canGoForward();
    }
    if (this.refreshBtn) {
      this.refreshBtn.disabled = !tab;
    }
  }
}
