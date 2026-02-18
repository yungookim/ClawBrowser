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

export interface AppConfig {
  onboardingComplete: boolean;
  workspacePath: string | null;
  models: Partial<Record<ModelRole, StoredModelConfig>>;
  commandAllowlist: CommandAllowlistEntry[];
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const PROVIDERS: Provider[] = ['openai', 'anthropic', 'groq', 'ollama', 'llamacpp'];

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

  return {
    onboardingComplete,
    workspacePath,
    models,
    commandAllowlist: commandAllowlist.length
      ? commandAllowlist
      : hasAllowlistField
        ? []
        : DEFAULT_CONFIG.commandAllowlist,
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
