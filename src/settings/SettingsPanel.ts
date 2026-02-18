import { invoke } from '@tauri-apps/api/core';
import { SidecarBridge } from '../agent/SidecarBridge';
import { TabManager } from '../tabs/TabManager';

type ModelConfig = {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  role: string;
  temperature?: number;
};

type MemoryDoc = {
  id: string;
  content: string;
  title: string;
  score?: number;
};

type HeartbeatState = {
  lastPulse: string;
  uptime: number;
  activeTabs: number;
  activeTabTitle: string;
  currentContext: string;
  pendingActions: string[];
};

type StatusResponse = {
  uptime: number;
  heartbeat: HeartbeatState;
  modelsConfigured: number;
  historyLength: number;
  memoryStatus?: { totalDocuments: number; needsEmbedding: number } | null;
};

export class SettingsPanel {
  private container: HTMLElement;
  private bridge: SidecarBridge;
  private tabManager: TabManager;
  private root: HTMLElement;
  private visible = false;
  private lastActiveTabId: string | null = null;
  private onVisibilityChange: ((visible: boolean) => void) | null = null;

  private bannerEl!: HTMLElement;
  private modelListEl!: HTMLElement;
  private memoryFilesEl!: HTMLElement;
  private memoryResultsEl!: HTMLElement;
  private logsListEl!: HTMLElement;
  private logContentEl!: HTMLElement;
  private statusTilesEl!: HTMLElement;
  private statusRowsEl!: HTMLElement;
  private memoryQueryInput!: HTMLInputElement;
  private modelForm!: HTMLFormElement;

  constructor(container: HTMLElement, bridge: SidecarBridge, tabManager: TabManager) {
    this.container = container;
    this.bridge = bridge;
    this.tabManager = tabManager;
    this.root = this.build();
    this.container.appendChild(this.root);

    this.tabManager.onChange(() => {
      if (this.visible) {
        this.hide(false);
      }
    });
  }

  setOnVisibilityChange(handler: (visible: boolean) => void): void {
    this.onVisibilityChange = handler;
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    if (this.visible) {
      this.hide(true);
    } else {
      this.show();
    }
  }

  private show(): void {
    if (this.visible) return;
    this.visible = true;
    this.lastActiveTabId = this.tabManager.getActiveTabId();
    this.root.classList.add('visible');
    this.onVisibilityChange?.(true);
    invoke('hide_all_tabs').catch((err) => {
      console.error('Failed to hide tabs:', err);
    });
    this.refreshAll().catch((err) => {
      this.setBanner(`Failed to refresh settings: ${String(err)}`, 'warn');
    });
  }

  private hide(restoreTab: boolean): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('visible');
    this.onVisibilityChange?.(false);
    if (restoreTab && this.lastActiveTabId) {
      this.tabManager.switchTab(this.lastActiveTabId).catch((err) => {
        console.error('Failed to restore tab:', err);
      });
    }
  }

  private build(): HTMLElement {
    const root = document.createElement('section');
    root.className = 'settings-panel';

    root.innerHTML = `
      <div class="settings-shell">
        <header class="settings-hero">
          <div class="settings-hero-copy">
            <div class="settings-kicker">ClawBrowser Control</div>
            <h1 class="settings-title">Settings</h1>
            <p class="settings-subtitle">Configure models, automation, memory, logs, and system status from one console.</p>
          </div>
          <div class="settings-hero-actions">
            <button class="settings-btn outline" data-action="refresh" type="button">Refresh</button>
            <button class="settings-btn solid" data-action="reflection" type="button">Run Reflection</button>
          </div>
        </header>
        <div class="settings-status-banner" data-role="status-banner">Ready.</div>
        <div class="settings-grid">
          <section class="settings-card" data-card="models">
            <div class="settings-card-header">
              <h2>Models</h2>
              <p>Primary and subagent routing. Configure once, reuse everywhere.</p>
            </div>
            <form class="settings-form" data-form="model">
              <label class="settings-field">
                Provider
                <select class="settings-select" name="provider" required>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="groq">Groq</option>
                  <option value="ollama">Ollama</option>
                  <option value="llamacpp">llama.cpp</option>
                </select>
              </label>
              <label class="settings-field">
                Model
                <input class="settings-input" name="model" placeholder="gpt-5.2" required />
              </label>
              <label class="settings-field">
                API Key
                <input class="settings-input" name="apiKey" placeholder="optional" type="password" />
              </label>
              <label class="settings-field">
                Base URL
                <input class="settings-input" name="baseUrl" placeholder="http://localhost:11434/v1" />
              </label>
              <label class="settings-field">
                Role
                <select class="settings-select" name="role">
                  <option value="primary">Primary</option>
                  <option value="subagent">Subagent</option>
                </select>
              </label>
              <label class="settings-field">
                Temperature
                <input class="settings-input" name="temperature" type="number" min="0" max="2" step="0.1" placeholder="0.7" />
              </label>
              <button class="settings-btn solid" type="submit">Save Model</button>
            </form>
            <div class="settings-list" data-role="model-list"></div>
          </section>

          <section class="settings-card" data-card="cron">
            <div class="settings-card-header">
              <h2>Cron Jobs</h2>
              <p>Automations that keep memory fresh and context current.</p>
            </div>
            <div class="cron-grid">
              <div class="cron-card">
                <div class="cron-header">
                  <div>
                    <div class="cron-title">Heartbeat</div>
                    <div class="cron-desc">Writes HEARTBEAT.md every minute.</div>
                  </div>
                  <label class="switch">
                    <input type="checkbox" checked disabled />
                    <span class="switch-track"></span>
                  </label>
                </div>
                <div class="cron-meta">
                  <span>Schedule</span>
                  <input class="settings-input settings-mono" value="* * * * *" disabled />
                </div>
              </div>
              <div class="cron-card">
                <div class="cron-header">
                  <div>
                    <div class="cron-title">Nightly Reflection</div>
                    <div class="cron-desc">Summarizes the day and adds memories.</div>
                  </div>
                  <label class="switch">
                    <input type="checkbox" checked disabled />
                    <span class="switch-track"></span>
                  </label>
                </div>
                <div class="cron-meta">
                  <span>Schedule</span>
                  <input class="settings-input settings-mono" value="0 0 * * *" disabled />
                </div>
                <button class="settings-btn outline" data-action="reflection" type="button">Run Now</button>
              </div>
            </div>
          </section>

          <section class="settings-card" data-card="memory">
            <div class="settings-card-header">
              <h2>Memory</h2>
              <p>Workspace files and semantic memory index.</p>
            </div>
            <div class="settings-row">
              <input class="settings-input" data-role="memory-query" placeholder="Search memory index" />
              <button class="settings-btn outline" data-action="memory-search" type="button">Search</button>
            </div>
            <div class="settings-list" data-role="memory-results"></div>
            <div class="settings-divider"></div>
            <div class="settings-list" data-role="memory-files"></div>
          </section>

          <section class="settings-card" data-card="logs">
            <div class="settings-card-header">
              <h2>Logs</h2>
              <p>Daily activity logs written by the sidecar.</p>
            </div>
            <div class="settings-columns">
              <div class="settings-list" data-role="log-list"></div>
              <pre class="settings-log-view" data-role="log-content">Select a log to preview.</pre>
            </div>
          </section>

          <section class="settings-card" data-card="status">
            <div class="settings-card-header">
              <h2>System Status</h2>
              <p>Health signals, uptime, and runtime context.</p>
            </div>
            <div class="status-grid" data-role="status-tiles"></div>
            <div class="status-rows" data-role="status-rows"></div>
          </section>
        </div>
      </div>
    `;

    this.bannerEl = root.querySelector('[data-role="status-banner"]') as HTMLElement;
    this.modelListEl = root.querySelector('[data-role="model-list"]') as HTMLElement;
    this.memoryFilesEl = root.querySelector('[data-role="memory-files"]') as HTMLElement;
    this.memoryResultsEl = root.querySelector('[data-role="memory-results"]') as HTMLElement;
    this.logsListEl = root.querySelector('[data-role="log-list"]') as HTMLElement;
    this.logContentEl = root.querySelector('[data-role="log-content"]') as HTMLElement;
    this.statusTilesEl = root.querySelector('[data-role="status-tiles"]') as HTMLElement;
    this.statusRowsEl = root.querySelector('[data-role="status-rows"]') as HTMLElement;
    this.memoryQueryInput = root.querySelector('[data-role="memory-query"]') as HTMLInputElement;
    this.modelForm = root.querySelector('[data-form="model"]') as HTMLFormElement;

    const refreshBtn = root.querySelector('[data-action="refresh"]') as HTMLButtonElement | null;
    refreshBtn?.addEventListener('click', () => {
      this.refreshAll().catch((err) => {
        this.setBanner(`Refresh failed: ${String(err)}`, 'warn');
      });
    });

    const reflectionButtons = root.querySelectorAll('[data-action="reflection"]');
    reflectionButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.runReflection();
      });
    });

    const memorySearchBtn = root.querySelector('[data-action="memory-search"]') as HTMLButtonElement | null;
    memorySearchBtn?.addEventListener('click', () => {
      this.searchMemory();
    });

    this.memoryQueryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.searchMemory();
      }
    });

    this.modelForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitModelForm();
    });

    const cards = root.querySelectorAll('.settings-card');
    cards.forEach((card, index) => {
      (card as HTMLElement).style.setProperty('--delay', `${index * 0.06}s`);
    });

    return root;
  }

  private async refreshAll(): Promise<void> {
    this.setBanner('Syncing settings data...');

    const results = await Promise.allSettled([
      this.bridge.ping(),
      this.bridge.getStatus(),
      this.bridge.getMemory(),
      this.bridge.listModels(),
      this.bridge.listLogs(),
    ]);

    const [pingRes, statusRes, memoryRes, modelsRes, logsRes] = results;

    if (pingRes.status === 'fulfilled') {
      const ping = pingRes.value as { uptime: number };
      const uptime = this.formatDuration(ping.uptime);
      this.setBanner(`Sidecar online. Uptime ${uptime}.`, 'good');
    } else {
      this.setBanner('Sidecar offline or unreachable.', 'warn');
    }

    if (statusRes.status === 'fulfilled') {
      this.renderStatus(statusRes.value as StatusResponse);
    }

    if (memoryRes.status === 'fulfilled') {
      const memory = memoryRes.value as { files: Record<string, string>; memories: MemoryDoc[] };
      this.renderWorkspaceFiles(memory.files);
      this.renderMemoryResults(memory.memories);
    }

    if (modelsRes.status === 'fulfilled') {
      this.renderModels(modelsRes.value as ModelConfig[]);
    }

    if (logsRes.status === 'fulfilled') {
      this.renderLogs(logsRes.value as string[]);
    }
  }

  private async searchMemory(): Promise<void> {
    const query = this.memoryQueryInput.value.trim();
    if (!query) {
      this.memoryResultsEl.textContent = 'Enter a query to search semantic memory.';
      return;
    }

    try {
      const result = await this.bridge.getMemory(query);
      this.renderMemoryResults(result.memories || []);
    } catch (err) {
      this.memoryResultsEl.textContent = 'Memory search failed.';
      this.setBanner(`Memory search failed: ${String(err)}`, 'warn');
    }
  }

  private async runReflection(): Promise<void> {
    this.setBanner('Triggering reflection...', 'good');
    try {
      const result = await this.bridge.triggerReflection();
      const summary = (result as { summary?: string; memoriesAdded?: number }).summary || 'Reflection complete.';
      this.setBanner(`${summary}`, 'good');
    } catch (err) {
      this.setBanner(`Reflection failed: ${String(err)}`, 'warn');
    }
  }

  private async submitModelForm(): Promise<void> {
    const formData = new FormData(this.modelForm);
    const provider = String(formData.get('provider') || '').trim();
    const model = String(formData.get('model') || '').trim();
    const apiKey = String(formData.get('apiKey') || '').trim();
    const baseUrl = String(formData.get('baseUrl') || '').trim();
    const role = String(formData.get('role') || 'primary');
    const temperatureRaw = String(formData.get('temperature') || '').trim();
    const temperature = temperatureRaw ? Number(temperatureRaw) : undefined;

    if (!provider || !model) {
      this.setBanner('Provider and model are required.', 'warn');
      return;
    }

    try {
      await this.bridge.configureModel(
        provider,
        model,
        apiKey || undefined,
        role === 'primary',
        baseUrl || undefined,
        Number.isFinite(temperature) ? temperature : undefined,
      );
      this.setBanner('Model configuration saved.', 'good');
      this.modelForm.reset();
      const models = await this.bridge.listModels();
      this.renderModels(models);
    } catch (err) {
      this.setBanner(`Failed to save model: ${String(err)}`, 'warn');
    }
  }

  private renderModels(models: ModelConfig[]): void {
    this.modelListEl.textContent = '';
    if (!models || models.length === 0) {
      this.modelListEl.textContent = 'No models configured yet.';
      return;
    }

    models.forEach((model) => {
      const item = document.createElement('div');
      item.className = 'settings-list-item';

      const left = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${model.provider}/${model.model}`;
      const meta = document.createElement('span');
      meta.textContent = `role: ${model.role}${model.baseUrl ? ` | ${model.baseUrl}` : ''}`;
      left.appendChild(title);
      left.appendChild(document.createElement('br'));
      left.appendChild(meta);

      const right = document.createElement('div');
      right.className = 'settings-mono';
      right.textContent = model.temperature !== undefined ? `temp ${model.temperature}` : 'temp default';

      item.appendChild(left);
      item.appendChild(right);
      this.modelListEl.appendChild(item);
    });
  }

  private renderWorkspaceFiles(files: Record<string, string>): void {
    this.memoryFilesEl.textContent = '';
    const entries = Object.entries(files || {});
    if (entries.length === 0) {
      this.memoryFilesEl.textContent = 'No workspace files found.';
      return;
    }

    entries.forEach(([name, content]) => {
      const item = document.createElement('div');
      item.className = 'settings-list-item';

      const left = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = name;
      const snippet = document.createElement('span');
      snippet.textContent = this.truncate(content.replace(/\s+/g, ' '), 110);
      left.appendChild(title);
      left.appendChild(document.createElement('br'));
      left.appendChild(snippet);

      const right = document.createElement('div');
      right.className = 'settings-mono';
      right.textContent = `${content.length} chars`;

      item.appendChild(left);
      item.appendChild(right);
      this.memoryFilesEl.appendChild(item);
    });
  }

  private renderMemoryResults(memories: MemoryDoc[]): void {
    this.memoryResultsEl.textContent = '';
    if (!memories || memories.length === 0) {
      this.memoryResultsEl.textContent = 'No memory hits yet.';
      return;
    }

    memories.forEach((memory) => {
      const item = document.createElement('div');
      item.className = 'settings-list-item';

      const left = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = memory.title || memory.id;
      const snippet = document.createElement('span');
      snippet.textContent = this.truncate(memory.content.replace(/\s+/g, ' '), 110);
      left.appendChild(title);
      left.appendChild(document.createElement('br'));
      left.appendChild(snippet);

      const right = document.createElement('div');
      right.className = 'settings-mono';
      right.textContent = memory.score !== undefined ? `score ${memory.score.toFixed(2)}` : 'score n/a';

      item.appendChild(left);
      item.appendChild(right);
      this.memoryResultsEl.appendChild(item);
    });
  }

  private renderLogs(logs: string[]): void {
    this.logsListEl.textContent = '';
    if (!logs || logs.length === 0) {
      this.logsListEl.textContent = 'No logs available.';
      return;
    }

    logs.slice().reverse().forEach((date) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'settings-list-item';
      item.textContent = date;
      item.addEventListener('click', () => {
        this.loadLog(date);
      });
      this.logsListEl.appendChild(item);
    });

    const latest = logs[logs.length - 1];
    if (latest) {
      this.loadLog(latest).catch(() => {
        // Ignore preview errors.
      });
    }
  }

  private async loadLog(date: string): Promise<void> {
    try {
      const result = await this.bridge.readLog(date);
      this.logContentEl.textContent = result.content || 'Log is empty.';
    } catch (err) {
      this.logContentEl.textContent = 'Failed to load log.';
      this.setBanner(`Failed to load log: ${String(err)}`, 'warn');
    }
  }

  private renderStatus(status: StatusResponse): void {
    this.statusTilesEl.textContent = '';
    this.statusRowsEl.textContent = '';

    const tiles: Array<{ label: string; value: string; meta?: string }> = [
      { label: 'Uptime', value: this.formatDuration(status.uptime) },
      { label: 'Models', value: String(status.modelsConfigured) },
      { label: 'History', value: String(status.historyLength) },
      { label: 'Memories', value: status.memoryStatus ? String(status.memoryStatus.totalDocuments) : 'n/a' },
    ];

    tiles.forEach((tile) => {
      const tileEl = document.createElement('div');
      tileEl.className = 'status-tile';
      const label = document.createElement('div');
      label.className = 'status-label';
      label.textContent = tile.label;
      const value = document.createElement('div');
      value.className = 'status-value';
      value.textContent = tile.value;
      tileEl.appendChild(label);
      tileEl.appendChild(value);
      if (tile.meta) {
        const meta = document.createElement('div');
        meta.className = 'status-meta';
        meta.textContent = tile.meta;
        tileEl.appendChild(meta);
      }
      this.statusTilesEl.appendChild(tileEl);
    });

    const rows: Array<[string, string]> = [
      ['Last pulse', status.heartbeat?.lastPulse ? this.formatTimestamp(status.heartbeat.lastPulse) : 'unknown'],
      ['Active tabs', String(status.heartbeat?.activeTabs ?? 0)],
      ['Active tab', status.heartbeat?.activeTabTitle || 'none'],
      ['Context', status.heartbeat?.currentContext || 'idle'],
    ];

    if (status.memoryStatus) {
      rows.push(['Needs embeddings', String(status.memoryStatus.needsEmbedding)]);
    }

    rows.forEach(([labelText, valueText]) => {
      const row = document.createElement('div');
      row.className = 'status-row';
      const label = document.createElement('span');
      label.textContent = labelText;
      const value = document.createElement('span');
      value.textContent = valueText;
      row.appendChild(label);
      row.appendChild(value);
      this.statusRowsEl.appendChild(row);
    });
  }

  private setBanner(message: string, tone: 'good' | 'warn' | 'neutral' = 'neutral'): void {
    this.bannerEl.textContent = message;
    this.bannerEl.classList.remove('good', 'warn');
    if (tone === 'good') {
      this.bannerEl.classList.add('good');
    } else if (tone === 'warn') {
      this.bannerEl.classList.add('warn');
    }
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  private formatTimestamp(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString();
  }

  private truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max) + '...';
  }
}
