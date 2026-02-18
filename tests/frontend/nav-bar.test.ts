import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavBar } from '../../src/navigation/NavBar';
import type { TabManager } from '../../src/tabs/TabManager';

describe('NavBar', () => {
  let container: HTMLElement;
  let handlers: Array<(tabs: unknown[], activeId: string | null) => void>;
  let activeTab: { url: string } | null;
  let tabManager: TabManager & {
    navigate: ReturnType<typeof vi.fn>;
    goBack: ReturnType<typeof vi.fn>;
    goForward: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    handlers = [];
    activeTab = { url: 'https://example.com' };

    tabManager = {
      onChange: (cb: (tabs: unknown[], activeId: string | null) => void) => {
        handlers.push(cb);
      },
      getActiveTab: () => activeTab as any,
      canGoBack: vi.fn(() => true),
      canGoForward: vi.fn(() => false),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
    } as any;
  });

  it('renders controls and updates URL + button states', () => {
    new NavBar(container, tabManager);

    const urlInput = container.querySelector('.url-input') as HTMLInputElement;
    const backBtn = container.querySelector('button[title="Back"]') as HTMLButtonElement;
    const forwardBtn = container.querySelector('button[title="Forward"]') as HTMLButtonElement;
    const refreshBtn = container.querySelector('button[title="Refresh"]') as HTMLButtonElement;
    const agentToggle = container.querySelector('.agent-toggle');

    expect(urlInput.value).toBe('https://example.com');
    expect(backBtn.disabled).toBe(false);
    expect(forwardBtn.disabled).toBe(true);
    expect(refreshBtn.disabled).toBe(false);
    expect(agentToggle).toBeNull();

    activeTab = { url: 'about:blank' };
    handlers[0]?.([], null);
    expect(urlInput.value).toBe('');
  });

  it('does not overwrite URL input while focused', () => {
    new NavBar(container, tabManager);

    const urlInput = container.querySelector('.url-input') as HTMLInputElement;
    urlInput.value = 'typing...';
    urlInput.focus();

    activeTab = { url: 'https://changed.com' };
    handlers[0]?.([], null);

    expect(urlInput.value).toBe('typing...');
  });

  it('navigates on Enter and wires button actions', () => {
    new NavBar(container, tabManager);
    const urlInput = container.querySelector('.url-input') as HTMLInputElement;

    urlInput.value = 'example.com';
    urlInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(tabManager.navigate).toHaveBeenCalledWith('example.com');

    const backBtn = container.querySelector('button[title="Back"]') as HTMLButtonElement;
    backBtn.click();
    expect(tabManager.goBack).toHaveBeenCalledTimes(1);

    tabManager.canGoForward.mockReturnValue(true);
    handlers[0]?.([], null);
    const forwardBtn = container.querySelector('button[title="Forward"]') as HTMLButtonElement;
    forwardBtn.click();
    expect(tabManager.goForward).toHaveBeenCalledTimes(1);
  });
});
