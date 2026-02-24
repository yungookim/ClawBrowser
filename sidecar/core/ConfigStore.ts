import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Provider, ModelRole } from './ModelManager.js';

export interface StoredModelConfig {
  provider: Provider;
  model: string;
  baseUrl?: string;
  temperature?: number;
}

export interface CommandAllowlistEntry {
  command: string;
  argsRegex: string[];
}

export type AgentControlMode = 'max' | 'balanced' | 'strict';
export type AgentFilesystemScope = 'sandbox' | 'workspace_home' | 'unrestricted';
export type AgentClipboardAccess = 'readwrite' | 'write' | 'none';
export type AgentLogDetail = 'full' | 'redacted' | 'minimal';
export type AgentDestructiveConfirm = 'chat' | 'modal' | 'none';

export interface AgentActionLogSettings {
  enabled: boolean;
  detail: AgentLogDetail;
  retentionDays: number;
}

export interface AgentControlSettings {
  enabled: boolean;
  mode: AgentControlMode;
  killSwitch: boolean;
  autoGrantOrigins: boolean;
  autoGrantPagePermissions: boolean;
  allowTerminal: boolean;
  allowFilesystem: boolean;
  filesystemScope: AgentFilesystemScope;
  allowCookies: boolean;
  allowLocalStorage: boolean;
  allowCredentials: boolean;
  allowDownloads: boolean;
  allowFileDialogs: boolean;
  clipboardAccess: AgentClipboardAccess;
  allowWindowControl: boolean;
  allowDevtools: boolean;
  destructiveConfirm: AgentDestructiveConfirm;
  actionLog: AgentActionLogSettings;
  statusIndicator: boolean;
}

export interface AgentRecoverySettings {
  maxRetries: number;
  enabled: boolean;
}

export interface AppConfig {
  onboardingComplete: boolean;
  workspacePath: string | null;
  models: Partial<Record<ModelRole, StoredModelConfig>>;
  commandAllowlist: CommandAllowlistEntry[];
  agentControl: AgentControlSettings;
  agentRecovery: AgentRecoverySettings;
}

export interface ConfigStoreOptions {
  baseDir?: string;
}

const DEFAULT_CONFIG: AppConfig = {
  onboardingComplete: false,
  workspacePath: null,
  models: {},
  commandAllowlist: [
    { command: 'codex', argsRegex: ['^--project$', '^.+$'] },
    { command: 'claude', argsRegex: ['^code$', '^--project$', '^.+$'] },
  ],
  agentRecovery: {
    maxRetries: 2,
    enabled: true,
  },
  agentControl: {
    enabled: true,
    mode: 'max',
    killSwitch: false,
    autoGrantOrigins: true,
    autoGrantPagePermissions: false,
    allowTerminal: true,
    allowFilesystem: true,
    filesystemScope: 'sandbox',
    allowCookies: true,
    allowLocalStorage: true,
    allowCredentials: true,
    allowDownloads: true,
    allowFileDialogs: true,
    clipboardAccess: 'readwrite',
    allowWindowControl: true,
    allowDevtools: true,
    destructiveConfirm: 'chat',
    actionLog: {
      enabled: true,
      detail: 'full',
      retentionDays: 30,
    },
    statusIndicator: true,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const PROVIDERS: Provider[] = ['openai', 'anthropic', 'groq', 'ollama', 'llamacpp'];
const CONTROL_MODES: AgentControlMode[] = ['max', 'balanced', 'strict'];
const FILESYSTEM_SCOPES: AgentFilesystemScope[] = ['sandbox', 'workspace_home', 'unrestricted'];
const CLIPBOARD_ACCESS: AgentClipboardAccess[] = ['readwrite', 'write', 'none'];
const LOG_DETAIL: AgentLogDetail[] = ['full', 'redacted', 'minimal'];
const DESTRUCTIVE_CONFIRM: AgentDestructiveConfirm[] = ['chat', 'modal', 'none'];

function normalizeModel(value: unknown): StoredModelConfig | undefined {
  if (!isRecord(value)) return undefined;
  const provider = typeof value.provider === 'string' ? value.provider : '';
  const model = typeof value.model === 'string' ? value.model : '';
  if (!provider || !model) return undefined;
  if (!PROVIDERS.includes(provider as Provider)) return undefined;
  const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl : undefined;
  const temperature = typeof value.temperature === 'number' ? value.temperature : undefined;
  return { provider: provider as Provider, model, baseUrl, temperature };
}

function normalizeAllowlist(value: unknown): CommandAllowlistEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const command = typeof entry.command === 'string' ? entry.command.trim() : '';
      const argsRegex = Array.isArray(entry.argsRegex)
        ? entry.argsRegex.filter((arg) => typeof arg === 'string') as string[]
        : [];
      if (!command) return null;
      return { command, argsRegex };
    })
    .filter((entry): entry is CommandAllowlistEntry => Boolean(entry));
}

function normalizeAgentControl(value: unknown): AgentControlSettings {
  const data = isRecord(value) ? value : {};
  const actionLog = isRecord(data.actionLog) ? data.actionLog : {};
  const retentionRaw = Number(actionLog.retentionDays);
  const retentionDays = Number.isFinite(retentionRaw) && retentionRaw > 0
    ? Math.floor(retentionRaw)
    : DEFAULT_CONFIG.agentControl.actionLog.retentionDays;

  return {
    enabled: typeof data.enabled === 'boolean'
      ? data.enabled
      : DEFAULT_CONFIG.agentControl.enabled,
    mode: typeof data.mode === 'string' && CONTROL_MODES.includes(data.mode as AgentControlMode)
      ? data.mode as AgentControlMode
      : DEFAULT_CONFIG.agentControl.mode,
    killSwitch: typeof data.killSwitch === 'boolean'
      ? data.killSwitch
      : DEFAULT_CONFIG.agentControl.killSwitch,
    autoGrantOrigins: typeof data.autoGrantOrigins === 'boolean'
      ? data.autoGrantOrigins
      : DEFAULT_CONFIG.agentControl.autoGrantOrigins,
    autoGrantPagePermissions: typeof data.autoGrantPagePermissions === 'boolean'
      ? data.autoGrantPagePermissions
      : DEFAULT_CONFIG.agentControl.autoGrantPagePermissions,
    allowTerminal: typeof data.allowTerminal === 'boolean'
      ? data.allowTerminal
      : DEFAULT_CONFIG.agentControl.allowTerminal,
    allowFilesystem: typeof data.allowFilesystem === 'boolean'
      ? data.allowFilesystem
      : DEFAULT_CONFIG.agentControl.allowFilesystem,
    filesystemScope: typeof data.filesystemScope === 'string' && FILESYSTEM_SCOPES.includes(data.filesystemScope as AgentFilesystemScope)
      ? data.filesystemScope as AgentFilesystemScope
      : DEFAULT_CONFIG.agentControl.filesystemScope,
    allowCookies: typeof data.allowCookies === 'boolean'
      ? data.allowCookies
      : DEFAULT_CONFIG.agentControl.allowCookies,
    allowLocalStorage: typeof data.allowLocalStorage === 'boolean'
      ? data.allowLocalStorage
      : DEFAULT_CONFIG.agentControl.allowLocalStorage,
    allowCredentials: typeof data.allowCredentials === 'boolean'
      ? data.allowCredentials
      : DEFAULT_CONFIG.agentControl.allowCredentials,
    allowDownloads: typeof data.allowDownloads === 'boolean'
      ? data.allowDownloads
      : DEFAULT_CONFIG.agentControl.allowDownloads,
    allowFileDialogs: typeof data.allowFileDialogs === 'boolean'
      ? data.allowFileDialogs
      : DEFAULT_CONFIG.agentControl.allowFileDialogs,
    clipboardAccess: typeof data.clipboardAccess === 'string' && CLIPBOARD_ACCESS.includes(data.clipboardAccess as AgentClipboardAccess)
      ? data.clipboardAccess as AgentClipboardAccess
      : DEFAULT_CONFIG.agentControl.clipboardAccess,
    allowWindowControl: typeof data.allowWindowControl === 'boolean'
      ? data.allowWindowControl
      : DEFAULT_CONFIG.agentControl.allowWindowControl,
    allowDevtools: typeof data.allowDevtools === 'boolean'
      ? data.allowDevtools
      : DEFAULT_CONFIG.agentControl.allowDevtools,
    destructiveConfirm: typeof data.destructiveConfirm === 'string' && DESTRUCTIVE_CONFIRM.includes(data.destructiveConfirm as AgentDestructiveConfirm)
      ? data.destructiveConfirm as AgentDestructiveConfirm
      : DEFAULT_CONFIG.agentControl.destructiveConfirm,
    actionLog: {
      enabled: typeof actionLog.enabled === 'boolean'
        ? actionLog.enabled
        : DEFAULT_CONFIG.agentControl.actionLog.enabled,
      detail: typeof actionLog.detail === 'string' && LOG_DETAIL.includes(actionLog.detail as AgentLogDetail)
        ? actionLog.detail as AgentLogDetail
        : DEFAULT_CONFIG.agentControl.actionLog.detail,
      retentionDays,
    },
    statusIndicator: typeof data.statusIndicator === 'boolean'
      ? data.statusIndicator
      : DEFAULT_CONFIG.agentControl.statusIndicator,
  };
}

function normalizeAgentRecovery(value: unknown): AgentRecoverySettings {
  const data = isRecord(value) ? value : {};
  const maxRetriesRaw = Number(data.maxRetries);
  const maxRetries = Number.isFinite(maxRetriesRaw) && maxRetriesRaw >= 0
    ? Math.floor(maxRetriesRaw)
    : DEFAULT_CONFIG.agentRecovery.maxRetries;
  return {
    maxRetries,
    enabled: typeof data.enabled === 'boolean'
      ? data.enabled
      : DEFAULT_CONFIG.agentRecovery.enabled,
  };
}

function normalizeConfig(input: unknown): AppConfig {
  const data = isRecord(input) ? input : {};
  const onboardingComplete = typeof data.onboardingComplete === 'boolean'
    ? data.onboardingComplete
    : DEFAULT_CONFIG.onboardingComplete;
  const workspacePath = typeof data.workspacePath === 'string'
    ? data.workspacePath
    : data.workspacePath === null
      ? null
      : DEFAULT_CONFIG.workspacePath;

  const models: Partial<Record<ModelRole, StoredModelConfig>> = {};
  if (isRecord(data.models)) {
    const primary = normalizeModel(data.models.primary);
    const secondary = normalizeModel(data.models.secondary);
    const subagent = normalizeModel(data.models.subagent);
    if (primary) models.primary = primary;
    if (secondary) models.secondary = secondary;
    if (subagent) models.subagent = subagent;
  }

  const commandAllowlist = normalizeAllowlist(data.commandAllowlist);
  const hasAllowlistField = Object.prototype.hasOwnProperty.call(data, 'commandAllowlist');
  const agentControl = normalizeAgentControl(data.agentControl);
  const agentRecovery = normalizeAgentRecovery(data.agentRecovery);

  return {
    onboardingComplete,
    workspacePath,
    models,
    commandAllowlist: commandAllowlist.length
      ? commandAllowlist
      : hasAllowlistField
        ? []
        : DEFAULT_CONFIG.commandAllowlist,
    agentControl,
    agentRecovery,
  };
}

export class ConfigStore {
  private config: AppConfig = DEFAULT_CONFIG;
  private configDir: string;
  private configPath: string;
  private vaultPath: string;

  constructor(options: ConfigStoreOptions = {}) {
    const baseDir = options.baseDir || os.homedir();
    this.configDir = path.join(baseDir, '.clawbrowser');
    this.configPath = path.join(this.configDir, 'config.json');
    this.vaultPath = path.join(this.configDir, 'vault.json');
  }

  async load(): Promise<AppConfig> {
    await fs.mkdir(this.configDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      this.config = normalizeConfig(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[ConfigStore] Failed to read config, using defaults:', err);
      }
      this.config = normalizeConfig(DEFAULT_CONFIG);
      await this.save(this.config);
    }
    return this.config;
  }

  get(): AppConfig {
    return this.config;
  }

  async save(config: AppConfig): Promise<void> {
    this.config = config;
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  async update(partial: Partial<AppConfig>): Promise<AppConfig> {
    const current = this.config;

    const models = { ...current.models };
    if (partial.models) {
      for (const [role, value] of Object.entries(partial.models)) {
        const normalized = normalizeModel(value);
        if (normalized) {
          models[role as ModelRole] = normalized;
        }
      }
    }

    const updated: AppConfig = {
      onboardingComplete: typeof partial.onboardingComplete === 'boolean'
        ? partial.onboardingComplete
        : current.onboardingComplete,
      workspacePath: partial.workspacePath !== undefined
        ? partial.workspacePath
        : current.workspacePath,
      models,
      commandAllowlist: partial.commandAllowlist
        ? normalizeAllowlist(partial.commandAllowlist)
        : current.commandAllowlist,
      agentControl: partial.agentControl
        ? normalizeAgentControl({
          ...current.agentControl,
          ...partial.agentControl,
          actionLog: {
            ...current.agentControl.actionLog,
            ...(isRecord(partial.agentControl.actionLog) ? partial.agentControl.actionLog : {}),
          },
        })
        : current.agentControl,
      agentRecovery: partial.agentRecovery
        ? normalizeAgentRecovery({ ...current.agentRecovery, ...partial.agentRecovery })
        : current.agentRecovery,
    };

    await this.save(updated);
    return updated;
  }

  async loadVault(): Promise<string | null> {
    try {
      return await fs.readFile(this.vaultPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[ConfigStore] Failed to read vault:', err);
      }
      return null;
    }
  }

  async saveVault(data: string): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(this.vaultPath, data, 'utf-8');
  }
}
