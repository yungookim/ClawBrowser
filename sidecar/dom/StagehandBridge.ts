import { Stagehand } from '@browserbasehq/stagehand';
import type { ModelManager } from '../core/ModelManager.js';
import type { ConfigStore, StoredModelConfig } from '../core/ConfigStore.js';

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
};

type StagehandLike = {
  init: () => Promise<void>;
  close: () => Promise<void>;
  act: (instruction: string) => Promise<unknown>;
  extract: (instruction: string, schema?: unknown) => Promise<unknown>;
  observe: (instruction: string) => Promise<unknown>;
  context?: {
    isClosed?: () => boolean;
    pages?: () => Array<{ url?: () => string; title?: () => Promise<string>; goto?: (url: string) => Promise<void>; screenshot?: (opts?: { fullPage?: boolean }) => Promise<unknown> }>;
    activePage?: () => Promise<unknown>;
    newPage?: () => Promise<unknown>;
    browser?: () => {
      process?: () => { pid?: number } | null;
      wsEndpoint?: () => string;
    } | null;
  };
  browser?: {
    process?: () => { pid?: number } | null;
    wsEndpoint?: () => string;
  } | null;
};

type StagehandInitOptions = {
  env: 'LOCAL';
  model: string;
  localBrowserLaunchOptions: { headless: boolean };
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

  constructor(modelManager: ModelManager, configStore: ConfigStore, options: StagehandBridgeOptions = {}) {
    this.modelManager = modelManager;
    this.configStore = configStore;
    this.idleTimeoutMs = typeof options.idleTimeoutMs === 'number'
      ? options.idleTimeoutMs
      : DEFAULT_IDLE_TIMEOUT_MS;
    this.createStagehand = options.createStagehand
      ? options.createStagehand
      : (stagehandOptions) => new Stagehand(stagehandOptions) as unknown as StagehandLike;
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
      const page = await this.getActivePage(stagehand);
      if (!page || typeof page.goto !== 'function') {
        throw new Error('Stagehand page unavailable');
      }
      await page.goto(url);
      const finalUrl = typeof page.url === 'function' ? page.url() : url;
      const title = typeof page.title === 'function' ? await page.title() : null;
      return { url: finalUrl, title };
    });
  }

  async act(instruction: string): Promise<unknown> {
    if (!instruction || typeof instruction !== 'string') {
      throw new Error('act requires an instruction');
    }
    return this.runWithRecovery(async (stagehand) => stagehand.act(instruction));
  }

  async extract(instruction: string, schema?: unknown): Promise<unknown> {
    if (!instruction || typeof instruction !== 'string') {
      throw new Error('extract requires an instruction');
    }
    return this.runWithRecovery(async (stagehand) => {
      if (schema !== undefined) {
        return stagehand.extract(instruction, schema as any);
      }
      return stagehand.extract(instruction);
    });
  }

  async observe(instruction: string): Promise<unknown> {
    if (!instruction || typeof instruction !== 'string') {
      throw new Error('observe requires an instruction');
    }
    return this.runWithRecovery(async (stagehand) => stagehand.observe(instruction));
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
    const model = this.resolveModel();
    const stagehand = this.createStagehand({
      env: 'LOCAL',
      model,
      localBrowserLaunchOptions: { headless: false },
    });

    try {
      await stagehand.init();
      this.stagehand = stagehand;
      this.lastError = null;
      return stagehand;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.lastError = error.message;
      throw error;
    } finally {
      this.initPromise = null;
    }
  }

  private resolveModel(): string {
    const configured = this.modelManager.getConfig('primary');
    if (configured) {
      return `${configured.provider}/${configured.model}`;
    }

    const stored = this.configStore.get().models.primary as StoredModelConfig | undefined;
    if (stored) {
      return `${stored.provider}/${stored.model}`;
    }

    return DEFAULT_MODEL;
  }

  private isStagehandHealthy(stagehand: StagehandLike): boolean {
    const context = stagehand.context;
    if (!context) return false;
    if (typeof context.isClosed === 'function' && context.isClosed()) return false;
    return true;
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

  private async getActivePage(stagehand: StagehandLike): Promise<any> {
    const context = stagehand.context;
    if (!context) {
      throw new Error('Stagehand context unavailable');
    }

    if (typeof context.activePage === 'function') {
      const page = await context.activePage();
      if (page) return page;
    }

    if (typeof context.pages === 'function') {
      const pages = context.pages();
      if (pages.length > 0) return pages[0];
    }

    if (typeof context.newPage === 'function') {
      return context.newPage();
    }

    throw new Error('Stagehand page unavailable');
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
}
