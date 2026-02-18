import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabBar } from '../../src/tabs/TabBar';
import type { TabManager, Tab } from '../../src/tabs/TabManager';

describe('TabBar', () => {
  let container: HTMLElement;
  let tabs: Tab[];
  let activeId: string | null;
  let handlers: Array<(tabs: Tab[], activeId: string | null) => void>;
  let tabManager: TabManager & {
    createTab: ReturnType<typeof vi.fn>;
    closeTab: ReturnType<typeof vi.fn>;
    switchTab: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    tabs = [
      { id: 'tab-1', url: 'https://one', title: 'One', history: [], historyIndex: 0 },
      { id: 'tab-2', url: 'https://two', title: 'Two', history: [], historyIndex: 0 },
    ];
    activeId = 'tab-1';
    handlers = [];

    tabManager = {
      onChange: (cb: (t: Tab[], a: string | null) => void) => handlers.push(cb),
      getTabs: () => tabs,
      getActiveTabId: () => activeId,
      createTab: vi.fn(),
      closeTab: vi.fn(),
      switchTab: vi.fn(),
    } as any;
  });

  it('renders tabs with active state and handles tab actions', () => {
    new TabBar(container, tabManager);

    const tabEls = container.querySelectorAll('.tab');
    expect(tabEls).toHaveLength(2);
    expect(tabEls[0].classList.contains('active')).toBe(true);
    expect(tabEls[1].classList.contains('active')).toBe(false);

    (tabEls[1] as HTMLElement).click();
    expect(tabManager.switchTab).toHaveBeenCalledWith('tab-2');

    const closeBtn = tabEls[1].querySelector('.tab-close') as HTMLButtonElement;
    closeBtn.click();
    expect(tabManager.closeTab).toHaveBeenCalledWith('tab-2');
    expect(tabManager.switchTab).toHaveBeenCalledTimes(1);

    const newTabBtn = container.querySelector('.new-tab-btn') as HTMLButtonElement;
    newTabBtn.click();
    expect(tabManager.createTab).toHaveBeenCalledWith('about:blank');
  });

  it('re-renders when tabs change', () => {
    new TabBar(container, tabManager);

    tabs = [
      { id: 'tab-3', url: 'https://three', title: 'Three', history: [], historyIndex: 0 },
    ];
    activeId = 'tab-3';
    handlers[0]?.(tabs, activeId);

    const tabEls = container.querySelectorAll('.tab');
    expect(tabEls).toHaveLength(1);
    expect(tabEls[0].dataset.tabId).toBe('tab-3');
    expect(tabEls[0].classList.contains('active')).toBe(true);
  });
});
