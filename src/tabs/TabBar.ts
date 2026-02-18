import { TabManager, Tab } from './TabManager';

export class TabBar {
  private container: HTMLElement;
  private tabManager: TabManager;

  constructor(container: HTMLElement, tabManager: TabManager) {
    this.container = container;
    this.tabManager = tabManager;

    // Subscribe to tab changes
    this.tabManager.onChange((tabs, activeId) => {
      this.render(tabs, activeId);
    });

    // Initial render
    this.render(this.tabManager.getTabs(), this.tabManager.getActiveTabId());
  }

  private render(tabs: Tab[], activeId: string | null): void {
    // Clear existing content
    this.container.textContent = '';

    // Tabs container (scrollable)
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'tabs-container';

    for (const tab of tabs) {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab' + (tab.id === activeId ? ' active' : '');
      tabEl.dataset.tabId = tab.id;

      // Prevent tab from being draggable (window drag region)
      tabEl.style.webkitAppRegion = 'no-drag';
      // Cast for TypeScript compatibility with -webkit-app-region
      (tabEl.style as Record<string, string>)['appRegion'] = 'no-drag';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.title || 'New Tab';
      tabEl.appendChild(titleSpan);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '\u00D7';
      closeBtn.title = 'Close tab';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.tabManager.closeTab(tab.id);
      });
      tabEl.appendChild(closeBtn);

      tabEl.addEventListener('click', () => {
        this.tabManager.switchTab(tab.id);
      });

      tabsContainer.appendChild(tabEl);
    }

    this.container.appendChild(tabsContainer);

    // New tab button
    const newTabBtn = document.createElement('button');
    newTabBtn.className = 'new-tab-btn';
    newTabBtn.textContent = '+';
    newTabBtn.title = 'New tab';
    newTabBtn.style.webkitAppRegion = 'no-drag';
    (newTabBtn.style as Record<string, string>)['appRegion'] = 'no-drag';
    newTabBtn.addEventListener('click', () => {
      this.tabManager.createTab('about:blank');
    });
    this.container.appendChild(newTabBtn);
  }
}
