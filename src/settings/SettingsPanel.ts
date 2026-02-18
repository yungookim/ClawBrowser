import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { SidecarBridge } from '../agent/SidecarBridge';
import { applyProviderDefaults, providerRequiresApiKey } from '../shared/providerDefaults';
import modelCatalog from '../shared/modelCatalog.json';
import { TabManager } from '../tabs/TabManager';
import { Combobox } from '../ui/Combobox';
import { Dropdown } from '../ui/Dropdown';
import { Vault } from '../vault/Vault';
import { DEFAULT_AGENT_CONTROL, type AgentControlSettings } from '../agent/types';

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

const MODEL_CATALOG = modelCatalog as Record<string, string[]>;

export class SettingsPanel {
  private container: HTMLElement;
  private bridge: SidecarBridge;
  private tabManager: TabManager;
  private vault: Vault | null;
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
  private modelProviderDropdown!: Dropdown;
  private modelRoleDropdown!: Dropdown;
  private modelCombobox!: Combobox;
  private modelProviderSelect!: HTMLSelectElement;
  private modelInput!: HTMLInputElement;
  private modelApiKeyInput!: HTMLInputElement;
  private modelBaseUrlInput!: HTMLInputElement;
  private modelRoleSelect!: HTMLSelectElement;
  private allowlistForm!: HTMLFormElement;
  private allowlistListEl!: HTMLElement;
  private allowlistCommandInput!: HTMLInputElement;
  private allowlistRegexInput!: HTMLTextAreaElement;
  private allowlist: Array<{ command: string; argsRegex: string[] }> = [];
  private agentControlForm!: HTMLFormElement;
  private agentEnabledInput!: HTMLInputElement;
  private agentModeSelect!: HTMLSelectElement;
  private agentKillSwitchInput!: HTMLInputElement;
  private agentAutoGrantOriginsInput!: HTMLInputElement;
  private agentAutoGrantPermissionsInput!: HTMLInputElement;
  private agentAllowTerminalInput!: HTMLInputElement;
  private agentAllowFilesystemInput!: HTMLInputElement;
  private agentFilesystemScopeSelect!: HTMLSelectElement;
  private agentAllowCookiesInput!: HTMLInputElement;
  private agentAllowLocalStorageInput!: HTMLInputElement;
  private agentAllowCredentialsInput!: HTMLInputElement;
  private agentAllowDownloadsInput!: HTMLInputElement;
  private agentAllowFileDialogsInput!: HTMLInputElement;
  private agentClipboardSelect!: HTMLSelectElement;
  private agentWindowControlInput!: HTMLInputElement;
  private agentDevtoolsInput!: HTMLInputElement;
  private agentDestructiveSelect!: HTMLSelectElement;
  private agentActionLogEnabledInput!: HTMLInputElement;
  private agentLogDetailSelect!: HTMLSelectElement;
  private agentLogRetentionInput!: HTMLInputElement;
  private agentStatusIndicatorInput!: HTMLInputElement;
  private onStartSetupWizard: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    bridge: SidecarBridge,
    tabManager: TabManager,
    vault?: Vault,
    onStartSetupWizard?: () => void,
  ) {
    this.container = container;
    this.bridge = bridge;
    this.tabManager = tabManager;
    this.vault = vault || null;
    this.onStartSetupWizard = onStartSetupWizard || null;
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
            <div class="settings-kicker">smartest child of openclaw</div>
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
              <p>Primary, secondary, and subagent routing. Configure once, reuse everywhere.</p>
            </div>
            <form class="settings-form" data-form="model">
              <label class="settings-field">
                Provider
                <div class="settings-control" data-control="model-provider"></div>
              </label>
              <label class="settings-field">
                Model
                <div class="settings-control" data-control="model-input"></div>
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
                <div class="settings-control" data-control="model-role"></div>
              </label>
              <button class="settings-btn solid" type="submit">Save Model</button>
            </form>
            <div class="settings-list" data-role="model-list"></div>
          </section>

          <section class="settings-card" data-card="allowlist">
            <div class="settings-card-header">
              <h2>Command Allowlist</h2>
              <p>Permit agent-run terminal commands with regex-validated args.</p>
            </div>
            <form class="settings-form" data-form="allowlist">
              <label class="settings-field">
                Command
                <input class="settings-input" name="command" placeholder="codex" required />
              </label>
              <label class="settings-field">
                Args Regex (one per line)
                <textarea class="settings-textarea" name="argsRegex" rows="4" placeholder="^--project$&#10;^.+$"></textarea>
              </label>
              <button class="settings-btn solid" type="submit">Save Allowlist Entry</button>
            </form>
            <div class="settings-list" data-role="allowlist-list"></div>
          </section>

          <section class="settings-card" data-card="agent-control">
            <div class="settings-card-header">
              <h2>Agent Control</h2>
              <p>Define how much control the agent has over the app.</p>
            </div>
            <form class="settings-form" data-form="agent-control">
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Enabled</strong>
                  <span>Allow the agent to act inside the app.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-enabled" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Kill switch engaged</strong>
                  <span>Immediately disables agent control.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-kill-switch" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Persistent indicator</strong>
                  <span>Always show when the agent is active.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-status-indicator" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <label class="settings-field">
                Autonomy mode
                <select class="settings-select" data-role="agent-mode">
                  <option value="max">Max autonomy</option>
                  <option value="balanced">Balanced</option>
                  <option value="strict">Strict</option>
                </select>
              </label>
              <div class="settings-divider"></div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Auto-grant origins</strong>
                  <span>Skip per-origin and cross-origin prompts.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-auto-grant-origins" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Auto-grant camera/mic/geo/screen</strong>
                  <span>Allow page permission prompts automatically.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-auto-grant-perms" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <div class="settings-divider"></div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Terminal access</strong>
                  <span>Allow agent-run commands.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-allow-terminal" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Filesystem access</strong>
                  <span>Allow read/write within scope.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-allow-filesystem" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <label class="settings-field">
                Filesystem scope
                <select class="settings-select" data-role="agent-filesystem-scope">
                  <option value="sandbox">App sandbox + workspace</option>
                  <option value="workspace_home">Workspace + home</option>
                  <option value="unrestricted">Unrestricted</option>
                </select>
              </label>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Cookies</strong>
                  <span>Allow cookie access.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-allow-cookies" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Local storage</strong>
                  <span>Allow localStorage/sessionStorage access.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-allow-localstorage" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Saved credentials</strong>
                  <span>Allow access to stored credentials.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-allow-credentials" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Downloads</strong>
                  <span>Allow download management.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-allow-downloads" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>File dialogs</strong>
                  <span>Auto-accept open/save dialogs.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-allow-filedialogs" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <label class="settings-field">
                Clipboard access
                <select class="settings-select" data-role="agent-clipboard">
                  <option value="readwrite">Read + write</option>
                  <option value="write">Write only</option>
                  <option value="none">Disabled</option>
                </select>
              </label>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Window control</strong>
                  <span>Resize, focus, and manage windows.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-window-control" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Devtools control</strong>
                  <span>Allow opening and closing devtools.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-devtools" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <label class="settings-field">
                Destructive confirmations
                <select class="settings-select" data-role="agent-destructive-confirm">
                  <option value="chat">Chat confirmation</option>
                  <option value="modal">Modal confirmation</option>
                  <option value="none">No confirmation</option>
                </select>
              </label>
              <div class="settings-toggle-row">
                <div class="settings-toggle-copy">
                  <strong>Action log enabled</strong>
                  <span>Record every agent action.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" data-role="agent-log-enabled" />
                  <span class="switch-track"></span>
                </label>
              </div>
              <label class="settings-field">
                Action log detail
                <select class="settings-select" data-role="agent-log-detail">
                  <option value="full">Full detail</option>
                  <option value="redacted">Redacted</option>
                  <option value="minimal">Minimal</option>
                </select>
              </label>
              <label class="settings-field">
                Log retention (days)
                <input class="settings-input" type="number" min="1" data-role="agent-log-retention" />
              </label>
              <button class="settings-btn solid" type="submit">Save Agent Control</button>
            </form>
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
            <div class="settings-row">
              <button class="settings-btn outline" data-action="open-logs" type="button">Open Logs Folder</button>
            </div>
            <div class="settings-columns">
              <div class="settings-list" data-role="log-list"></div>
              <pre class="settings-log-view" data-role="log-content">Select a log to preview.</pre>
            </div>
          </section>

          <section class="settings-card" data-card="setup-wizard">
            <div class="settings-card-header">
              <h2>Setup Wizard</h2>
              <p>Restart the setup wizard and create a fresh vault.</p>
            </div>
            <div class="settings-row">
              <button class="settings-btn outline" data-action="setup-wizard" type="button">Restart Setup Wizard</button>
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

    const providerSlot = root.querySelector('[data-control="model-provider"]') as HTMLElement;
    const modelSlot = root.querySelector('[data-control="model-input"]') as HTMLElement;
    const roleSlot = root.querySelector('[data-control="model-role"]') as HTMLElement;

    this.modelProviderDropdown = new Dropdown({
      options: [
        { value: 'openai', label: 'OpenAI' },
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'groq', label: 'Groq' },
        { value: 'ollama', label: 'Ollama' },
        { value: 'llamacpp', label: 'llama.cpp' },
      ],
      name: 'provider',
      required: true,
      className: 'settings-control-field',
      ariaLabel: 'Provider',
    });
    providerSlot.appendChild(this.modelProviderDropdown.element);
    this.modelProviderSelect = this.modelProviderDropdown.field;

    this.modelCombobox = new Combobox({
      options: [],
      name: 'model',
      required: true,
      placeholder: 'gpt-5.2',
      className: 'settings-control-field',
      ariaLabel: 'Model',
    });
    modelSlot.appendChild(this.modelCombobox.element);
    this.modelInput = this.modelCombobox.field;

    this.modelRoleDropdown = new Dropdown({
      options: [
        { value: 'primary', label: 'Primary' },
        { value: 'secondary', label: 'Secondary' },
        { value: 'subagent', label: 'Subagent' },
      ],
      name: 'role',
      className: 'settings-control-field',
      ariaLabel: 'Role',
    });
    roleSlot.appendChild(this.modelRoleDropdown.element);
    this.modelRoleSelect = this.modelRoleDropdown.field;

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
    this.modelApiKeyInput = this.modelForm.querySelector('input[name="apiKey"]') as HTMLInputElement;
    this.modelBaseUrlInput = this.modelForm.querySelector('input[name="baseUrl"]') as HTMLInputElement;
    this.allowlistForm = root.querySelector('[data-form="allowlist"]') as HTMLFormElement;
    this.allowlistListEl = root.querySelector('[data-role="allowlist-list"]') as HTMLElement;
    this.allowlistCommandInput = this.allowlistForm.querySelector('input[name="command"]') as HTMLInputElement;
    this.allowlistRegexInput = this.allowlistForm.querySelector('textarea[name="argsRegex"]') as HTMLTextAreaElement;

    this.agentControlForm = root.querySelector('[data-form="agent-control"]') as HTMLFormElement;
    this.agentEnabledInput = this.agentControlForm.querySelector('[data-role="agent-enabled"]') as HTMLInputElement;
    this.agentKillSwitchInput = this.agentControlForm.querySelector('[data-role="agent-kill-switch"]') as HTMLInputElement;
    this.agentStatusIndicatorInput = this.agentControlForm.querySelector('[data-role="agent-status-indicator"]') as HTMLInputElement;
    this.agentModeSelect = this.agentControlForm.querySelector('[data-role="agent-mode"]') as HTMLSelectElement;
    this.agentAutoGrantOriginsInput = this.agentControlForm.querySelector('[data-role="agent-auto-grant-origins"]') as HTMLInputElement;
    this.agentAutoGrantPermissionsInput = this.agentControlForm.querySelector('[data-role="agent-auto-grant-perms"]') as HTMLInputElement;
    this.agentAllowTerminalInput = this.agentControlForm.querySelector('[data-role="agent-allow-terminal"]') as HTMLInputElement;
    this.agentAllowFilesystemInput = this.agentControlForm.querySelector('[data-role="agent-allow-filesystem"]') as HTMLInputElement;
    this.agentFilesystemScopeSelect = this.agentControlForm.querySelector('[data-role="agent-filesystem-scope"]') as HTMLSelectElement;
    this.agentAllowCookiesInput = this.agentControlForm.querySelector('[data-role="agent-allow-cookies"]') as HTMLInputElement;
    this.agentAllowLocalStorageInput = this.agentControlForm.querySelector('[data-role="agent-allow-localstorage"]') as HTMLInputElement;
    this.agentAllowCredentialsInput = this.agentControlForm.querySelector('[data-role="agent-allow-credentials"]') as HTMLInputElement;
    this.agentAllowDownloadsInput = this.agentControlForm.querySelector('[data-role="agent-allow-downloads"]') as HTMLInputElement;
    this.agentAllowFileDialogsInput = this.agentControlForm.querySelector('[data-role="agent-allow-filedialogs"]') as HTMLInputElement;
    this.agentClipboardSelect = this.agentControlForm.querySelector('[data-role="agent-clipboard"]') as HTMLSelectElement;
    this.agentWindowControlInput = this.agentControlForm.querySelector('[data-role="agent-window-control"]') as HTMLInputElement;
    this.agentDevtoolsInput = this.agentControlForm.querySelector('[data-role="agent-devtools"]') as HTMLInputElement;
    this.agentDestructiveSelect = this.agentControlForm.querySelector('[data-role="agent-destructive-confirm"]') as HTMLSelectElement;
    this.agentActionLogEnabledInput = this.agentControlForm.querySelector('[data-role="agent-log-enabled"]') as HTMLInputElement;
    this.agentLogDetailSelect = this.agentControlForm.querySelector('[data-role="agent-log-detail"]') as HTMLSelectElement;
    this.agentLogRetentionInput = this.agentControlForm.querySelector('[data-role="agent-log-retention"]') as HTMLInputElement;

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

    const openLogsBtn = root.querySelector('[data-action="open-logs"]') as HTMLButtonElement | null;
    openLogsBtn?.addEventListener('click', () => {
      this.openLogsFolder();
    });

    const setupWizardBtn = root.querySelector('[data-action="setup-wizard"]') as HTMLButtonElement | null;
    setupWizardBtn?.addEventListener('click', () => {
      const confirmed = window.confirm(
        'Restart the setup wizard and create a new vault? This will overwrite your existing vault data.',
      );
      if (!confirmed) return;

      if (!this.onStartSetupWizard) {
        this.setBanner('Setup wizard is unavailable.', 'warn');
        return;
      }

      this.setBanner('Launching setup wizard...', 'good');
      this.onStartSetupWizard();
      this.bridge.updateConfig({ onboardingComplete: false })
        .catch((err) => {
          this.setBanner(`Failed to mark onboarding incomplete: ${String(err)}`, 'warn');
        });
    });

    this.memoryQueryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.searchMemory();
      }
    });

    this.modelProviderSelect.addEventListener('change', () => {
      this.applyModelDefaults();
      this.updateModelOptions();
    });

    this.modelForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitModelForm();
    });

    this.allowlistForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitAllowlistForm();
    });

    this.agentControlForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitAgentControlForm();
    });

    const cards = root.querySelectorAll('.settings-card');
    cards.forEach((card, index) => {
      (card as HTMLElement).style.setProperty('--delay', `${index * 0.06}s`);
    });

    this.applyModelDefaults();
    this.updateModelOptions();
    this.renderAgentControl(DEFAULT_AGENT_CONTROL);

    return root;
  }

  private async refreshAll(): Promise<void> {
    this.setBanner('Syncing settings data...');

    const results = await Promise.allSettled([
      this.bridge.ping(),
      this.bridge.getStatus(),
      this.bridge.getMemory(),
      this.bridge.listModels(),
      this.bridge.getConfig(),
      this.bridge.listLogs(),
    ]);

    const [pingRes, statusRes, memoryRes, modelsRes, configRes, logsRes] = results;

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

    if (configRes.status === 'fulfilled') {
      const config = configRes.value as {
        commandAllowlist: Array<{ command: string; argsRegex: string[] }>;
        agentControl?: AgentControlSettings;
      };
      this.renderAllowlist(config.commandAllowlist || []);
      this.renderAgentControl(config.agentControl || DEFAULT_AGENT_CONTROL);
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

    if (!provider || !model) {
      this.setBanner('Provider and model are required.', 'warn');
      return;
    }

    if (providerRequiresApiKey(provider) && !apiKey) {
      this.setBanner('API key is required for hosted providers.', 'warn');
      return;
    }

    try {
      await this.bridge.configureModel(
        provider,
        model,
        apiKey || undefined,
        role,
        baseUrl || undefined,
      );

      await this.bridge.updateConfig({
        models: {
          [role]: {
            provider,
            model,
            baseUrl: baseUrl || undefined,
          },
        },
      });

      if (apiKey) {
        if (this.vault && this.vault.isUnlocked) {
          await this.vault.set(`apikey:${role}`, apiKey);
          const encrypted = await this.vault.exportEncrypted();
          await this.bridge.saveVault(encrypted);
        } else {
          this.setBanner('Model saved, but vault is locked. API key was not persisted.', 'warn');
        }
      }

      this.setBanner('Model configuration saved.', 'good');
      this.modelForm.reset();
      this.applyModelDefaults();
      const models = await this.bridge.listModels();
      this.renderModels(models);
    } catch (err) {
      this.setBanner(`Failed to save model: ${String(err)}`, 'warn');
    }
  }

  private applyModelDefaults(): void {
    applyProviderDefaults(
      {
        provider: this.modelProviderSelect,
        model: this.modelInput,
        apiKey: this.modelApiKeyInput,
        baseUrl: this.modelBaseUrlInput,
      },
      this.modelProviderSelect.value,
      { force: true },
    );
  }

  private updateModelOptions(): void {
    const provider = this.modelProviderSelect.value;
    const models = MODEL_CATALOG[provider] || [];
    this.modelCombobox.setOptions(models);
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

      item.appendChild(left);
      this.modelListEl.appendChild(item);
    });
  }

  private async submitAllowlistForm(): Promise<void> {
    const command = this.allowlistCommandInput.value.trim();
    if (!command) {
      this.setBanner('Command is required.', 'warn');
      return;
    }

    const argsRegex = this.allowlistRegexInput.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const entry = { command, argsRegex };
    const next = [...this.allowlist];
    const existingIndex = next.findIndex((item) => item.command === command);
    if (existingIndex >= 0) {
      next[existingIndex] = entry;
    } else {
      next.push(entry);
    }

    try {
      await this.bridge.updateConfig({ commandAllowlist: next });
      this.allowlistForm.reset();
      this.renderAllowlist(next);
      this.setBanner('Allowlist updated.', 'good');
    } catch (err) {
      this.setBanner(`Failed to update allowlist: ${String(err)}`, 'warn');
    }
  }

  private renderAllowlist(entries: Array<{ command: string; argsRegex: string[] }>): void {
    this.allowlist = entries;
    this.allowlistListEl.textContent = '';
    if (!entries || entries.length === 0) {
      this.allowlistListEl.textContent = 'No commands allowlisted.';
      return;
    }

    entries.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'settings-list-item';

      const left = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = entry.command;
      const meta = document.createElement('span');
      meta.textContent = entry.argsRegex.length ? entry.argsRegex.join(' | ') : 'no args allowed';
      left.appendChild(title);
      left.appendChild(document.createElement('br'));
      left.appendChild(meta);

      const right = document.createElement('button');
      right.type = 'button';
      right.className = 'settings-btn outline settings-inline-btn';
      right.textContent = 'Remove';
      right.addEventListener('click', async () => {
        const next = this.allowlist.filter((item) => item.command !== entry.command);
        try {
          await this.bridge.updateConfig({ commandAllowlist: next });
          this.renderAllowlist(next);
          this.setBanner('Allowlist updated.', 'good');
        } catch (err) {
          this.setBanner(`Failed to update allowlist: ${String(err)}`, 'warn');
        }
      });

      item.appendChild(left);
      item.appendChild(right);
      this.allowlistListEl.appendChild(item);
    });
  }

  private readAgentControlForm(): AgentControlSettings | null {
    const retentionRaw = Number(this.agentLogRetentionInput.value);
    if (!Number.isFinite(retentionRaw) || retentionRaw <= 0) {
      this.setBanner('Log retention must be a positive number.', 'warn');
      return null;
    }

    return {
      enabled: this.agentEnabledInput.checked,
      mode: this.agentModeSelect.value as AgentControlSettings['mode'],
      killSwitch: this.agentKillSwitchInput.checked,
      autoGrantOrigins: this.agentAutoGrantOriginsInput.checked,
      autoGrantPagePermissions: this.agentAutoGrantPermissionsInput.checked,
      allowTerminal: this.agentAllowTerminalInput.checked,
      allowFilesystem: this.agentAllowFilesystemInput.checked,
      filesystemScope: this.agentFilesystemScopeSelect.value as AgentControlSettings['filesystemScope'],
      allowCookies: this.agentAllowCookiesInput.checked,
      allowLocalStorage: this.agentAllowLocalStorageInput.checked,
      allowCredentials: this.agentAllowCredentialsInput.checked,
      allowDownloads: this.agentAllowDownloadsInput.checked,
      allowFileDialogs: this.agentAllowFileDialogsInput.checked,
      clipboardAccess: this.agentClipboardSelect.value as AgentControlSettings['clipboardAccess'],
      allowWindowControl: this.agentWindowControlInput.checked,
      allowDevtools: this.agentDevtoolsInput.checked,
      destructiveConfirm: this.agentDestructiveSelect.value as AgentControlSettings['destructiveConfirm'],
      actionLog: {
        enabled: this.agentActionLogEnabledInput.checked,
        detail: this.agentLogDetailSelect.value as AgentControlSettings['actionLog']['detail'],
        retentionDays: Math.floor(retentionRaw),
      },
      statusIndicator: this.agentStatusIndicatorInput.checked,
    };
  }

  private async submitAgentControlForm(): Promise<void> {
    const settings = this.readAgentControlForm();
    if (!settings) return;

    try {
      await this.bridge.updateConfig({ agentControl: settings });
      this.setBanner('Agent control updated.', 'good');
    } catch (err) {
      this.setBanner(`Failed to update agent control: ${String(err)}`, 'warn');
    }
  }

  private renderAgentControl(settings: AgentControlSettings): void {
    const control = settings || DEFAULT_AGENT_CONTROL;
    this.agentEnabledInput.checked = control.enabled;
    this.agentKillSwitchInput.checked = control.killSwitch;
    this.agentStatusIndicatorInput.checked = control.statusIndicator;
    this.agentModeSelect.value = control.mode;
    this.agentAutoGrantOriginsInput.checked = control.autoGrantOrigins;
    this.agentAutoGrantPermissionsInput.checked = control.autoGrantPagePermissions;
    this.agentAllowTerminalInput.checked = control.allowTerminal;
    this.agentAllowFilesystemInput.checked = control.allowFilesystem;
    this.agentFilesystemScopeSelect.value = control.filesystemScope;
    this.agentAllowCookiesInput.checked = control.allowCookies;
    this.agentAllowLocalStorageInput.checked = control.allowLocalStorage;
    this.agentAllowCredentialsInput.checked = control.allowCredentials;
    this.agentAllowDownloadsInput.checked = control.allowDownloads;
    this.agentAllowFileDialogsInput.checked = control.allowFileDialogs;
    this.agentClipboardSelect.value = control.clipboardAccess;
    this.agentWindowControlInput.checked = control.allowWindowControl;
    this.agentDevtoolsInput.checked = control.allowDevtools;
    this.agentDestructiveSelect.value = control.destructiveConfirm;
    this.agentActionLogEnabledInput.checked = control.actionLog.enabled;
    this.agentLogDetailSelect.value = control.actionLog.detail;
    this.agentLogRetentionInput.value = String(control.actionLog.retentionDays);
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

  private async openLogsFolder(): Promise<void> {
    try {
      const result = await this.bridge.getLogsDir();
      const logsPath = result?.path || '';
      if (!logsPath) {
        this.setBanner('Logs folder not available.', 'warn');
        return;
      }
      await open(logsPath);
    } catch (err) {
      this.setBanner(`Failed to open logs folder: ${String(err)}`, 'warn');
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
