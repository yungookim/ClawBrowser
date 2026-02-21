import { Stagehand } from '@browserbasehq/stagehand';
import { z, type ZodTypeAny } from 'zod';
import type { ModelManager } from '../core/ModelManager.js';
import type { ConfigStore, StoredModelConfig } from '../core/ConfigStore.js';
import type { SystemLogger } from '../logging/SystemLogger.js';

type StagehandStatus = {
  active: boolean;
  initializing: boolean;
  lastUsedAt: number | null;
  idleMs: number | null;
  lastError: string | null;
  browserPid: number | null;
  wsEndpoint: string | null;
};

type StagehandBridgeOptions = {
  idleTimeoutMs?: number;
  createStagehand?: (options: StagehandInitOptions) => StagehandLike;
  systemLogger?: SystemLogger | null;
};

type StagehandPageLike = {
  goto?: (url: string) => Promise<void>;
  url?: () => string;
  title?: () => Promise<string>;
  screenshot?: (opts?: { fullPage?: boolean }) => Promise<unknown>;
  act?: (instruction: string) => Promise<unknown>;
  extract?: (instructionOrOptions?: unknown) => Promise<unknown>;
  observe?: (instructionOrOptions?: unknown) => Promise<unknown>;
};

type StagehandLike = {
  init: () => Promise<unknown>;
  close: () => Promise<void>;
  page?: StagehandPageLike;
  context?: {
    pages?: () => StagehandPageLike[];
    newPage?: () => Promise<StagehandPageLike>;
    browser?: () => {
      process?: () => { pid?: number } | null;
      wsEndpoint?: () => string;
    } | null;
    isClosed?: () => boolean;
  };
  isClosed?: boolean | (() => boolean);
  act?: (instruction: string) => Promise<unknown>;
  extract?: (instruction: string, schema?: unknown) => Promise<unknown>;
  observe?: (instruction: string) => Promise<unknown>;
  browser?: {
    process?: () => { pid?: number } | null;
    wsEndpoint?: () => string;
  } | null;
};

type StagehandInitOptions = {
  env: 'LOCAL';
  modelName?: string;
  model?: string;
  modelClientOptions?: {
    apiKey?: string;
    baseURL?: string;
  };
  localBrowserLaunchOptions: { headless: boolean };
  logger?: (logLine: any) => void;
  disablePino?: boolean;
};

const DEFAULT_MODEL = 'openai/gpt-4o';
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export class StagehandBridge {
  private modelManager: ModelManager;
  private configStore: ConfigStore;
  private stagehand: StagehandLike | null = null;
  private initPromise: Promise<StagehandLike> | null = null;
  private idleTimeoutMs: number;
  private createStagehand: (options: StagehandInitOptions) => StagehandLike;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastUsedAt: number | null = null;
  private lastError: string | null = null;
  private systemLogger: SystemLogger | null;
  private lastModelSignature: string | null = null;

  constructor(modelManager: ModelManager, configStore: ConfigStore, options: StagehandBridgeOptions = {}) {
    this.modelManager = modelManager;
    this.configStore = configStore;
    this.idleTimeoutMs = typeof options.idleTimeoutMs === 'number'
      ? options.idleTimeoutMs
      : DEFAULT_IDLE_TIMEOUT_MS;
    this.createStagehand = options.createStagehand
      ? options.createStagehand
      : (stagehandOptions) => new Stagehand(stagehandOptions) as unknown as StagehandLike;
    this.systemLogger = options.systemLogger || null;
  }

  isActive(): boolean {
    if (!this.stagehand) return false;
    return this.isStagehandHealthy(this.stagehand);
  }

  getStatus(): StagehandStatus {
    const active = this.stagehand ? this.isStagehandHealthy(this.stagehand) : false;
    const browserInfo = this.stagehand ? this.getBrowserInfo(this.stagehand) : { browserPid: null, wsEndpoint: null };
    const idleMs = this.lastUsedAt ? Date.now() - this.lastUsedAt : null;
    return {
      active,
      initializing: Boolean(this.initPromise),
      lastUsedAt: this.lastUsedAt,
      idleMs,
      lastError: this.lastError,
      browserPid: browserInfo.browserPid,
      wsEndpoint: browserInfo.wsEndpoint,
    };
  }

  async navigate(url: string): Promise<{ url: string; title?: string | null }> {
    if (!url || typeof url !== 'string') {
      throw new Error('navigate requires a url');
    }
    return this.runWithRecovery(async (stagehand) => {
      const page = await this.openNewTab(stagehand, url);
      if (!page || typeof page.goto !== 'function') {
        throw new Error('Stagehand page unavailable');
      }
      const finalUrl = typeof page.url === 'function' ? page.url() : url;
      const title = typeof page.title === 'function' ? await page.title() : null;
      return { url: finalUrl, title };
    });
  }

  async act(instruction: string): Promise<unknown> {
    if (!instruction || typeof instruction !== 'string') {
      throw new Error('act requires an instruction');
    }
    return this.runWithRecovery(async (stagehand) => {
      const navUrl = this.extractUrlFromInstruction(instruction);
      const page = navUrl ? await this.openNewTab(stagehand, navUrl) : await this.getActivePage(stagehand);
      if (page && typeof page.act === 'function') {
        return page.act(instruction);
      }
      if (stagehand.act) {
        return stagehand.act(instruction);
      }
      throw new Error('Stagehand act unavailable');
    });
  }

  async extract(instruction: string, schema?: unknown): Promise<unknown> {
    if (!instruction || typeof instruction !== 'string') {
      throw new Error('extract requires an instruction');
    }
    return this.runWithRecovery(async (stagehand) => {
      const navUrl = this.extractUrlFromInstruction(instruction);
      const pageForAction = navUrl ? await this.openNewTab(stagehand, navUrl) : await this.getActivePage(stagehand);
      const normalizedSchema = this.normalizeSchema(schema);
      if (schema !== undefined && !normalizedSchema) {
        this.logSchemaWarning();
      }
      const { schema: extractSchema, unwrap } = this.coerceSchema(normalizedSchema);
      const page = pageForAction;
      if (page && typeof page.extract === 'function') {
        if (extractSchema) {
          const result = await page.extract({ instruction, schema: extractSchema } as any);
          return unwrap ? this.unwrapSchemaResult(result) : result;
        }
        return page.extract(instruction);
      }
      if (stagehand.extract) {
        if (extractSchema) {
          const result = await stagehand.extract(instruction, extractSchema as any);
          return unwrap ? this.unwrapSchemaResult(result) : result;
        }
        return stagehand.extract(instruction);
      }
      throw new Error('Stagehand extract unavailable');
    });
  }

  async observe(instruction: string): Promise<unknown> {
    if (!instruction || typeof instruction !== 'string') {
      throw new Error('observe requires an instruction');
    }
    return this.runWithRecovery(async (stagehand) => {
      const navUrl = this.extractUrlFromInstruction(instruction);
      const page = navUrl ? await this.openNewTab(stagehand, navUrl) : await this.getActivePage(stagehand);
      if (page && typeof page.observe === 'function') {
        return page.observe(instruction);
      }
      if (stagehand.observe) {
        return stagehand.observe(instruction);
      }
      throw new Error('Stagehand observe unavailable');
    });
  }

  async screenshot(fullPage?: boolean): Promise<{ mime: string; dataBase64: string; byteLength: number }> {
    return this.runWithRecovery(async (stagehand) => {
      const page = await this.getActivePage(stagehand);
      if (!page || typeof page.screenshot !== 'function') {
        throw new Error('Stagehand page unavailable');
      }
      const result = await page.screenshot({ fullPage: fullPage === true });
      const buffer = Buffer.isBuffer(result) ? result : Buffer.from(result as any);
      return {
        mime: 'image/png',
        dataBase64: buffer.toString('base64'),
        byteLength: buffer.byteLength,
      };
    });
  }

  async close(): Promise<void> {
    this.clearIdleTimer();
    const initPromise = this.initPromise;

    if (initPromise) {
      try {
        const stagehand = await initPromise;
        await stagehand.close();
      } catch (err) {
        console.error('[StagehandBridge] Close during init failed:', err);
      } finally {
        this.initPromise = null;
      }
    } else if (this.stagehand) {
      try {
        await this.stagehand.close();
      } catch (err) {
        console.error('[StagehandBridge] Close failed:', err);
      }
    }

    this.stagehand = null;
    this.lastUsedAt = null;
  }

  private async runWithRecovery<T>(fn: (stagehand: StagehandLike) => Promise<T>): Promise<T> {
    const stagehand = await this.ensureHealthy();
    this.markUsed();
    try {
      return await fn(stagehand);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.lastError = error.message;

      if (this.isCrashError(error)) {
        console.warn('[StagehandBridge] Detected crashed browser, reinitializing');
        await this.resetStagehand();
        const recovered = await this.ensureHealthy();
        this.markUsed();
        return await fn(recovered);
      }

      throw error;
    }
  }

  private async ensureHealthy(): Promise<StagehandLike> {
    if (this.stagehand && this.shouldReinitializeForModelChange()) {
      const message = '[StagehandBridge] Model configuration changed; reinitializing Stagehand.';
      console.warn(message);
      if (this.systemLogger) {
        this.systemLogger.log('info', message).catch(() => {
          // Ignore logging failures.
        });
      }
      await this.resetStagehand();
    }

    const stagehand = await this.ensureInitialized();
    if (this.isStagehandHealthy(stagehand)) {
      return stagehand;
    }

    console.warn('[StagehandBridge] Stagehand unhealthy, reinitializing');
    await this.resetStagehand();
    return this.ensureInitialized();
  }

  private async ensureInitialized(): Promise<StagehandLike> {
    if (this.stagehand) {
      return this.stagehand;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initStagehand();
    return this.initPromise;
  }

  private async initStagehand(): Promise<StagehandLike> {
    const modelConfig = this.resolveModelConfig();
    const modelClientOptions = this.buildModelClientOptions(modelConfig);
    this.logModelConfig(modelConfig);
    const stagehand = this.createStagehand({
      env: 'LOCAL',
      modelName: modelConfig.modelName,
      model: modelConfig.modelName,
      ...(modelClientOptions ? { modelClientOptions } : {}),
      localBrowserLaunchOptions: { headless: false },
      logger: this.buildLogger(),
      disablePino: true,
    });

    try {
      await stagehand.init();
      this.stagehand = stagehand;
      this.lastError = null;
      this.lastModelSignature = this.getModelSignature(modelConfig);
      return stagehand;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.lastError = error.message;
      throw error;
    } finally {
      this.initPromise = null;
    }
  }

  private resolveModelConfig(): {
    modelName: string;
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
  } {
    const configured = this.modelManager.getConfig('primary');
    if (configured) {
      return {
        modelName: `${configured.provider}/${configured.model}`,
        provider: configured.provider,
        apiKey: configured.apiKey,
        baseUrl: configured.baseUrl,
      };
    }

    const stored = this.configStore.get().models.primary as StoredModelConfig | undefined;
    if (stored) {
      return {
        modelName: `${stored.provider}/${stored.model}`,
        provider: stored.provider,
        baseUrl: stored.baseUrl,
      };
    }

    return { modelName: DEFAULT_MODEL };
  }

  private isStagehandHealthy(stagehand: StagehandLike): boolean {
    if (typeof stagehand.isClosed === 'boolean') {
      return !stagehand.isClosed;
    }
    if (typeof stagehand.isClosed === 'function' && stagehand.isClosed()) {
      return false;
    }
    const context = stagehand.context;
    if (context && typeof context.isClosed === 'function' && context.isClosed()) return false;
    return Boolean(stagehand);
  }

  private getBrowserInfo(stagehand: StagehandLike): { browserPid: number | null; wsEndpoint: string | null } {
    const browser = stagehand.browser
      || (stagehand.context && typeof stagehand.context.browser === 'function'
        ? stagehand.context.browser()
        : null);

    const pid = browser?.process ? browser.process()?.pid ?? null : null;
    const wsEndpoint = typeof browser?.wsEndpoint === 'function' ? browser.wsEndpoint() : null;

    return { browserPid: pid ?? null, wsEndpoint };
  }

  private async getActivePage(stagehand: StagehandLike): Promise<StagehandPageLike> {
    if (stagehand.page) {
      return stagehand.page;
    }

    const context = stagehand.context;
    if (context) {
      if (typeof context.pages === 'function') {
        const pages = context.pages();
        if (pages.length > 0) return pages[0];
      }

      if (typeof context.newPage === 'function') {
        return context.newPage();
      }
    }

    throw new Error('Stagehand page unavailable');
  }

  private async openNewTab(stagehand: StagehandLike, url: string): Promise<StagehandPageLike> {
    const context = stagehand.context;
    if (context && typeof context.newPage === 'function') {
      const page = await context.newPage();
      if (typeof page.goto === 'function') {
        await page.goto(url);
      }
      this.logStagehandTabOpen(url);
      return page;
    }

    const page = await this.getActivePage(stagehand);
    if (typeof page.goto === 'function') {
      await page.goto(url);
    }
    this.logStagehandTabOpen(url);
    return page;
  }

  private isCrashError(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return msg.includes('closed') || msg.includes('crash') || msg.includes('disconnected') || msg.includes('target closed');
  }

  private async resetStagehand(): Promise<void> {
    if (this.stagehand) {
      try {
        await this.stagehand.close();
      } catch (err) {
        console.warn('[StagehandBridge] Failed to close existing instance:', err);
      }
    }
    this.stagehand = null;
    this.initPromise = null;
    this.lastModelSignature = null;
  }

  private markUsed(): void {
    this.lastUsedAt = Date.now();
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.idleTimeoutMs <= 0) return;

    this.idleTimer = setTimeout(() => {
      void this.close();
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private buildLogger(): (logLine: any) => void {
    return (logLine: any) => {
      if (!logLine || !logLine.message) return;
      const category = logLine.category ? String(logLine.category) : 'log';
      const message = `[Stagehand] ${category}: ${String(logLine.message)}`;
      try {
        process.stderr.write(message + '\n');
      } catch {
        // Ignore stderr failures.
      }
      if (this.systemLogger) {
        const level = this.mapLogLevel(logLine.level);
        this.systemLogger.log(level, message).catch(() => {
          // Ignore logging failures.
        });
      }
    };
  }

  private mapLogLevel(level: unknown): 'debug' | 'info' | 'warn' | 'error' {
    switch (level) {
      case 2:
        return 'debug';
      case 1:
        return 'info';
      case 0:
        return 'warn';
      default:
        return 'info';
    }
  }

  private buildModelClientOptions(config: { apiKey?: string; baseUrl?: string }): { apiKey?: string; baseURL?: string } | undefined {
    if (!config.apiKey && !config.baseUrl) {
      return undefined;
    }
    return {
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    };
  }

  private normalizeSchema(schema: unknown): ZodTypeAny | undefined {
    if (!schema) return undefined;
    if (this.isZodSchema(schema)) return schema;

    let parsed: unknown = schema;
    if (typeof schema === 'string') {
      try {
        parsed = JSON.parse(schema);
      } catch {
        return undefined;
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    const jsonSchema = parsed as {
      type?: string;
      properties?: Record<string, unknown>;
      items?: unknown;
      enum?: string[];
      format?: string;
      anyOf?: unknown[];
      oneOf?: unknown[];
      allOf?: unknown[];
    };

    const { schema: normalizedJsonSchema, mutated } = this.ensureJsonSchemaTypes(jsonSchema);
    if (!normalizedJsonSchema.type && normalizedJsonSchema.properties) {
      normalizedJsonSchema.type = 'object';
      if (!mutated) {
        this.logSchemaAutofix();
      }
    } else if (mutated) {
      this.logSchemaAutofix();
    }
    if (!normalizedJsonSchema.type) {
      return undefined;
    }
    return this.jsonSchemaToZod(normalizedJsonSchema);
  }

  private jsonSchemaToZod(schema: {
    type?: string;
    properties?: Record<string, unknown>;
    items?: unknown;
    enum?: string[];
    format?: string;
    anyOf?: unknown[];
    oneOf?: unknown[];
    allOf?: unknown[];
  }): ZodTypeAny {
    switch (schema.type) {
      case 'object': {
        const shape: Record<string, ZodTypeAny> = {};
        if (schema.properties) {
          for (const [key, value] of Object.entries(schema.properties)) {
            shape[key] = this.jsonSchemaToZod(value as any);
          }
        }
        return z.object(shape);
      }
      case 'array':
        return z.array(schema.items ? this.jsonSchemaToZod(schema.items as any) : z.any());
      case 'string': {
        if (schema.enum && schema.enum.length > 0) {
          return z.enum(schema.enum as [string, ...string[]]);
        }
        let s = z.string();
        if (schema.format === 'url') s = s.url();
        if (schema.format === 'email') s = s.email();
        if (schema.format === 'uuid') s = s.uuid();
        return s;
      }
      case 'number':
      case 'integer':
        return z.number();
      case 'boolean':
        return z.boolean();
      case 'null':
        return z.null();
      default:
        return z.any();
    }
  }

  private isZodSchema(schema: unknown): schema is ZodTypeAny {
    return Boolean(schema && typeof (schema as { safeParse?: unknown }).safeParse === 'function');
  }

  private logSchemaWarning(): void {
    const message = '[StagehandBridge] extract schema is not a valid JSON schema or Zod schema; falling back to default extraction.';
    console.warn(message);
    if (this.systemLogger) {
      this.systemLogger.log('warn', message).catch(() => {
        // Ignore logging failures.
      });
    }
  }

  private logStagehandTabOpen(url: string): void {
    const message = `[StagehandBridge] Opened new tab for ${url}`;
    console.error(message);
    if (this.systemLogger) {
      this.systemLogger.log('info', message).catch(() => {
        // Ignore logging failures.
      });
    }
  }

  private logSchemaAutofix(): void {
    const message = '[StagehandBridge] Filled missing JSON schema types before extract.';
    console.warn(message);
    if (this.systemLogger) {
      this.systemLogger.log('warn', message).catch(() => {
        // Ignore logging failures.
      });
    }
  }

  private ensureJsonSchemaTypes(schema: {
    type?: string;
    properties?: Record<string, unknown>;
    items?: unknown;
    enum?: string[];
    format?: string;
    anyOf?: unknown[];
    oneOf?: unknown[];
    allOf?: unknown[];
  }): {
    schema: {
      type?: string;
      properties?: Record<string, unknown>;
      items?: unknown;
      enum?: string[];
      format?: string;
      anyOf?: unknown[];
      oneOf?: unknown[];
      allOf?: unknown[];
    };
    mutated: boolean;
  } {
    const clone: any = { ...schema };
    let mutated = false;

    if (!clone.type) {
      if (clone.properties) {
        clone.type = 'object';
        mutated = true;
      } else if (clone.items) {
        clone.type = 'array';
        mutated = true;
      } else if (clone.enum || clone.format) {
        clone.type = 'string';
        mutated = true;
      } else {
        clone.type = 'string';
        mutated = true;
      }
    }

    if (clone.properties && typeof clone.properties === 'object') {
      const nextProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(clone.properties)) {
        if (value && typeof value === 'object') {
          const fixed = this.ensureJsonSchemaTypes(value as any);
          nextProps[key] = fixed.schema;
          if (fixed.mutated) mutated = true;
        } else {
          nextProps[key] = value;
        }
      }
      clone.properties = nextProps;
    }

    if (clone.items && typeof clone.items === 'object') {
      const fixedItems = this.ensureJsonSchemaTypes(clone.items as any);
      clone.items = fixedItems.schema;
      if (fixedItems.mutated) mutated = true;
    }

    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      if (Array.isArray(clone[key])) {
        clone[key] = clone[key].map((entry: unknown) => {
          if (entry && typeof entry === 'object') {
            const fixedEntry = this.ensureJsonSchemaTypes(entry as any);
            if (fixedEntry.mutated) mutated = true;
            return fixedEntry.schema;
          }
          return entry;
        });
      }
    }

    return { schema: clone, mutated };
  }

  private getModelSignature(config: { modelName: string; apiKey?: string; baseUrl?: string }): string {
    const keyFlag = config.apiKey ? 'key' : 'nokey';
    const base = config.baseUrl ?? '';
    return `${config.modelName}|${base}|${keyFlag}`;
  }

  private shouldReinitializeForModelChange(): boolean {
    if (!this.lastModelSignature) return false;
    const current = this.getModelSignature(this.resolveModelConfig());
    return current !== this.lastModelSignature;
  }

  private logModelConfig(config: { modelName: string; apiKey?: string; baseUrl?: string }): void {
    const hasKey = Boolean(config.apiKey);
    const message = `[StagehandBridge] init model=${config.modelName} apiKey=${hasKey ? 'present' : 'missing'} baseUrl=${config.baseUrl ?? 'default'}`;
    console.error(message);
    if (this.systemLogger) {
      this.systemLogger.log('info', message).catch(() => {
        // Ignore logging failures.
      });
    }
  }

  private coerceSchema(schema: ZodTypeAny | undefined): { schema?: ZodTypeAny; unwrap: boolean } {
    if (!schema) return { schema: undefined, unwrap: false };
    if (this.isZodObject(schema)) {
      return { schema, unwrap: false };
    }
    return { schema: z.object({ result: schema }), unwrap: true };
  }

  private unwrapSchemaResult(result: unknown): unknown {
    if (!result || typeof result !== 'object') return result;
    if (!('result' in result)) return result;
    return (result as { result: unknown }).result;
  }

  private isZodObject(schema: ZodTypeAny): boolean {
    const def = (schema as { _def?: { shape?: unknown } })._def;
    return typeof def?.shape === 'function';
  }

  private extractUrlFromInstruction(instruction: string): string | null {
    const match = instruction.match(/https?:\/\/[^\s)]+/i);
    if (!match) return null;
    return match[0].replace(/[),.]+$/g, '');
  }
}
