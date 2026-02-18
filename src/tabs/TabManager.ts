import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface Tab {
  id: string;
  url: string;
  title: string;
  history: string[];
  historyIndex: number;
}

export type TabChangeListener = (tabs: Tab[], activeId: string | null) => void;

export class TabManager {
  private tabs: Map<string, Tab> = new Map();
  private activeTabId: string | null = null;
  private listeners: TabChangeListener[] = [];

  async init(): Promise<void> {
    await listen<{ tabId: string; url: string; title: string }>('tab-loaded', (event) => {
      const { tabId, url, title } = event.payload;
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.url = url;
        tab.title = title;
        this.notify();
      }
    });

    await listen<{ tabId: string; url: string }>('tab-navigated', (event) => {
      const { tabId, url } = event.payload;
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.url = url;
        // Push to history if it's a new navigation (not back/forward)
        if (tab.historyIndex === tab.history.length - 1) {
          tab.history.push(url);
          tab.historyIndex = tab.history.length - 1;
        }
        this.notify();
      }
    });
  }

  onChange(listener: TabChangeListener): void {
    this.listeners.push(listener);
  }

  private notify(): void {
    const tabArray = Array.from(this.tabs.values());
    for (const listener of this.listeners) {
      listener(tabArray, this.activeTabId);
    }
  }

  getTabs(): Tab[] {
    return Array.from(this.tabs.values());
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  getActiveTab(): Tab | undefined {
    if (!this.activeTabId) return undefined;
    return this.tabs.get(this.activeTabId);
  }

  async createTab(url: string = 'about:blank'): Promise<string> {
    const id: string = await invoke('create_tab', { url });
    const tab: Tab = {
      id,
      url,
      title: 'New Tab',
      history: [url],
      historyIndex: 0,
    };
    this.tabs.set(id, tab);
    this.activeTabId = id;
    this.notify();
    return id;
  }

  async closeTab(id: string): Promise<void> {
    await invoke('close_tab', { tabId: id });
    this.tabs.delete(id);

    if (this.activeTabId === id) {
      const remaining = Array.from(this.tabs.keys());
      this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }

    this.notify();
  }

  async switchTab(id: string): Promise<void> {
    if (!this.tabs.has(id)) return;
    await invoke('switch_tab', { tabId: id });
    this.activeTabId = id;
    this.notify();
  }

  async navigate(url: string): Promise<void> {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;

    const resolved = this.resolveUrl(url);
    await invoke('navigate_tab', { tabId: this.activeTabId, url: resolved });
    tab.url = resolved;

    // Truncate forward history and push new entry
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(resolved);
    tab.historyIndex = tab.history.length - 1;

    this.notify();
  }

  async goBack(): Promise<void> {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab || tab.historyIndex <= 0) return;

    tab.historyIndex--;
    const url = tab.history[tab.historyIndex];
    await invoke('navigate_tab', { tabId: this.activeTabId, url });
    tab.url = url;
    this.notify();
  }

  async goForward(): Promise<void> {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;

    tab.historyIndex++;
    const url = tab.history[tab.historyIndex];
    await invoke('navigate_tab', { tabId: this.activeTabId, url });
    tab.url = url;
    this.notify();
  }

  async injectJs(tabId: string, code: string): Promise<string> {
    return invoke('run_js_in_tab', { tabId, code });
  }

  canGoBack(): boolean {
    const tab = this.getActiveTab();
    return !!tab && tab.historyIndex > 0;
  }

  canGoForward(): boolean {
    const tab = this.getActiveTab();
    return !!tab && tab.historyIndex < tab.history.length - 1;
  }

  private resolveUrl(input: string): string {
    const trimmed = input.trim();
    // Already a full URL
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    // Looks like a domain (contains a dot, no spaces)
    if (/^[^\s]+\.[^\s]+$/.test(trimmed)) {
      return `https://${trimmed}`;
    }
    // Treat as search query
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }
}
