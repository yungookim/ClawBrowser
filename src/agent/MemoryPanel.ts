import type { SidecarBridge } from './SidecarBridge';

interface MemoryEntry {
  id: string;
  fact: string;
  createdAt: string;
}

/**
 * MemoryPanel displays stored memories and lets users delete them.
 * Toggled from the AgentPanel header.
 */
export class MemoryPanel {
  private container: HTMLElement;
  private bridge: SidecarBridge;
  private listEl: HTMLElement;

  constructor(container: HTMLElement, bridge: SidecarBridge) {
    this.container = container;
    this.bridge = bridge;
    this.container.className = 'memory-panel';
    this.container.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'memory-panel-header';
    header.textContent = 'Memories';
    this.container.appendChild(header);

    this.listEl = document.createElement('div');
    this.listEl.className = 'memory-panel-list';
    this.container.appendChild(this.listEl);
  }

  async show(): Promise<void> {
    this.container.style.display = 'flex';
    await this.load();
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  toggle(): void {
    if (this.container.style.display === 'none') {
      void this.show();
    } else {
      this.hide();
    }
  }

  private async load(): Promise<void> {
    try {
      const result = await this.bridge.send('listMemories', {}) as { memories: MemoryEntry[] };
      this.render(result.memories);
    } catch {
      this.listEl.textContent = 'Failed to load memories.';
    }
  }

  private render(memories: MemoryEntry[]): void {
    this.listEl.replaceChildren();
    if (memories.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'memory-empty';
      empty.textContent = 'No memories yet.';
      this.listEl.appendChild(empty);
      return;
    }
    for (const mem of memories) {
      const row = document.createElement('div');
      row.className = 'memory-row';

      const fact = document.createElement('span');
      fact.className = 'memory-fact';
      fact.textContent = mem.fact;
      row.appendChild(fact);

      const del = document.createElement('button');
      del.className = 'memory-delete-btn';
      del.textContent = '\u00d7';
      del.title = 'Forget this';
      del.addEventListener('click', async () => {
        try {
          await this.bridge.send('deleteMemory', { id: mem.id });
          row.remove();
        } catch {
          // ignore
        }
      });
      row.appendChild(del);

      this.listEl.appendChild(row);
    }
  }
}
