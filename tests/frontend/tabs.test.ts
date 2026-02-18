import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri APIs before importing TabManager
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { TabManager } from '../../src/tabs/TabManager';
import { invoke } from '@tauri-apps/api/core';

const mockedInvoke = vi.mocked(invoke);

describe('TabManager', () => {
  let tabManager: TabManager;

  beforeEach(() => {
    vi.clearAllMocks();
    tabManager = new TabManager();
    // Default mock: create_tab returns a UUID
    mockedInvoke.mockImplementation(async (cmd: string, _args?: unknown) => {
      if (cmd === 'create_tab') return 'tab-uuid-1';
      if (cmd === 'close_tab') return undefined;
      if (cmd === 'switch_tab') return undefined;
      if (cmd === 'navigate_tab') return undefined;
      if (cmd === 'run_js_in_tab') return '';
      if (cmd === 'list_tabs') return [];
      if (cmd === 'get_active_tab') return null;
      return undefined;
    });
  });

  it('should create a tab and call invoke', async () => {
    const id = await tabManager.createTab('https://example.com');

    expect(id).toBe('tab-uuid-1');
    expect(mockedInvoke).toHaveBeenCalledWith('create_tab', { url: 'https://example.com' });
    expect(tabManager.getTabs()).toHaveLength(1);
    expect(tabManager.getActiveTabId()).toBe('tab-uuid-1');
  });

  it('should track tab state after creation', async () => {
    await tabManager.createTab('https://example.com');
    const tabs = tabManager.getTabs();

    expect(tabs[0].id).toBe('tab-uuid-1');
    expect(tabs[0].url).toBe('https://example.com');
    expect(tabs[0].title).toBe('New Tab');
    expect(tabs[0].history).toEqual(['https://example.com']);
    expect(tabs[0].historyIndex).toBe(0);
  });

  it('should close a tab and call invoke', async () => {
    await tabManager.createTab('https://example.com');
    await tabManager.closeTab('tab-uuid-1');

    expect(mockedInvoke).toHaveBeenCalledWith('close_tab', { tabId: 'tab-uuid-1' });
    expect(tabManager.getTabs()).toHaveLength(0);
    expect(tabManager.getActiveTabId()).toBeNull();
  });

  it('should switch active tab on close when current tab is closed', async () => {
    let callCount = 0;
    mockedInvoke.mockImplementation(async (cmd: string, _args?: unknown) => {
      if (cmd === 'create_tab') {
        callCount++;
        return `tab-uuid-${callCount}`;
      }
      return undefined;
    });

    await tabManager.createTab('https://first.com');
    await tabManager.createTab('https://second.com');
    // Active tab is now tab-uuid-2
    expect(tabManager.getActiveTabId()).toBe('tab-uuid-2');

    await tabManager.closeTab('tab-uuid-2');
    // Should fall back to remaining tab
    expect(tabManager.getActiveTabId()).toBe('tab-uuid-1');
  });

  it('should switch tabs via switchTab', async () => {
    let callCount = 0;
    mockedInvoke.mockImplementation(async (cmd: string, _args?: unknown) => {
      if (cmd === 'create_tab') {
        callCount++;
        return `tab-uuid-${callCount}`;
      }
      return undefined;
    });

    await tabManager.createTab('https://first.com');
    await tabManager.createTab('https://second.com');
    expect(tabManager.getActiveTabId()).toBe('tab-uuid-2');

    await tabManager.switchTab('tab-uuid-1');
    expect(mockedInvoke).toHaveBeenCalledWith('switch_tab', { tabId: 'tab-uuid-1' });
    expect(tabManager.getActiveTabId()).toBe('tab-uuid-1');
  });

  it('should navigate and update history', async () => {
    await tabManager.createTab('https://start.com');
    await tabManager.navigate('https://page2.com');

    expect(mockedInvoke).toHaveBeenCalledWith('navigate_tab', {
      tabId: 'tab-uuid-1',
      url: 'https://page2.com',
    });

    const tab = tabManager.getActiveTab();
    expect(tab?.url).toBe('https://page2.com');
    expect(tab?.history).toEqual(['https://start.com', 'https://page2.com']);
    expect(tab?.historyIndex).toBe(1);
  });

  it('should resolve URLs correctly', async () => {
    await tabManager.createTab('about:blank');

    // Domain without protocol
    await tabManager.navigate('example.com');
    expect(mockedInvoke).toHaveBeenCalledWith('navigate_tab', {
      tabId: 'tab-uuid-1',
      url: 'https://example.com',
    });

    // Search query
    await tabManager.navigate('how to use tauri');
    expect(mockedInvoke).toHaveBeenCalledWith('navigate_tab', {
      tabId: 'tab-uuid-1',
      url: 'https://www.google.com/search?q=how%20to%20use%20tauri',
    });

    // Full URL
    await tabManager.navigate('https://rust-lang.org');
    expect(mockedInvoke).toHaveBeenCalledWith('navigate_tab', {
      tabId: 'tab-uuid-1',
      url: 'https://rust-lang.org',
    });
  });

  it('should handle back/forward navigation', async () => {
    await tabManager.createTab('https://page1.com');
    await tabManager.navigate('https://page2.com');
    await tabManager.navigate('https://page3.com');

    expect(tabManager.canGoBack()).toBe(true);
    expect(tabManager.canGoForward()).toBe(false);

    await tabManager.goBack();
    expect(tabManager.getActiveTab()?.url).toBe('https://page2.com');
    expect(tabManager.canGoForward()).toBe(true);

    await tabManager.goBack();
    expect(tabManager.getActiveTab()?.url).toBe('https://page1.com');
    expect(tabManager.canGoBack()).toBe(false);

    await tabManager.goForward();
    expect(tabManager.getActiveTab()?.url).toBe('https://page2.com');
  });

  it('should notify listeners on changes', async () => {
    const listener = vi.fn();
    tabManager.onChange(listener);

    await tabManager.createTab('https://example.com');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'tab-uuid-1' })]),
      'tab-uuid-1'
    );
  });

  it('should call injectJs with correct args', async () => {
    mockedInvoke.mockResolvedValue('result');
    const result = await tabManager.injectJs('tab-1', 'document.title');

    expect(mockedInvoke).toHaveBeenCalledWith('run_js_in_tab', {
      tabId: 'tab-1',
      code: 'document.title',
    });
    expect(result).toBe('result');
  });
});
