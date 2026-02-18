import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SidecarBridge } from '../agent/SidecarBridge';
import { TabManager } from '../tabs/TabManager';

type DebugPayload = {
  type?: string;
  tabId?: string;
  level?: string;
  message?: string;
  url?: string;
  title?: string;
  readyState?: string;
  textSample?: string;
  viewport?: { w?: number; h?: number; dpr?: number };
  scroll?: { x?: number; y?: number };
  reason?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
};

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type SnapshotResult = {
  tabId: string;
  mime: string;
  dataBase64: string;
};

export class DebugCapture {
  private sidecar: SidecarBridge;
  private tabManager: TabManager;
  private enabled: boolean;
  private screenshotEnabled: boolean;
  private logging = false;
  private maxEntryLength = 3200;
  private originalConsole: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {};
  private screenshotThrottleMs = 5000;
  private lastScreenshotAt: Map<string, number> = new Map();

  constructor(sidecar: SidecarBridge, tabManager: TabManager, enabled: boolean) {
    this.sidecar = sidecar;
    this.tabManager = tabManager;
    this.enabled = enabled;
    this.screenshotEnabled = enabled && (import.meta.env.DEV || localStorage.getItem('claw:debug:screenshots') === '1');
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    this.wrapConsole();
    this.captureErrors();
    await this.listenTabEvents();
  }

  private wrapConsole(): void {
    const levels: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
    levels.forEach((level) => {
      const original = console[level];
      this.originalConsole[level] = original?.bind(console);
      console[level] = (...args: any[]) => {
        try {
          const message = this.formatArgs(args);
          const entry = `[chrome-console] ${this.formatPairs({ level, message })}`;
          this.log(this.consoleLevelToLogLevel(level), entry);
          this.sidecar.debugEvent({
            source: 'chrome',
            type: 'console',
            level,
            message,
          }).catch(() => {
            // Ignore debug event failures.
          });
        } catch {
          // Ignore logging failures.
        }
        original?.apply(console, args);
      };
    });
  }

  private captureErrors(): void {
    window.addEventListener('error', (event) => {
      const payload = {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error && (event.error as Error).stack ? String((event.error as Error).stack) : undefined,
      };
      const entry = `[chrome-error] ${this.formatPairs(payload)}`;
      this.log('error', entry);
      this.sidecar.debugEvent({
        source: 'chrome',
        type: 'error',
        ...payload,
      }).catch(() => {
        // Ignore debug event failures.
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const payload = { reason: this.safeStringify(event.reason) };
      const entry = `[chrome-unhandledrejection] ${this.formatPairs(payload)}`;
      this.log('error', entry);
      this.sidecar.debugEvent({
        source: 'chrome',
        type: 'unhandledrejection',
        ...payload,
      }).catch(() => {
        // Ignore debug event failures.
      });
    });
  }

  private async listenTabEvents(): Promise<void> {
    await listen<DebugPayload>('claw-debug', (event) => {
      this.handleTabEvent(event.payload);
    });
  }

  private handleTabEvent(payload: DebugPayload): void {
    if (!payload || !payload.type) return;

    const base = {
      tab: payload.tabId,
      url: payload.url,
      title: payload.title,
    };

    switch (payload.type) {
      case 'console': {
        const data = {
          ...base,
          level: payload.level,
          message: payload.message,
        };
        const entry = `[tab-console] ${this.formatPairs(data)}`;
        this.log(this.consoleLevelToLogLevel(this.normalizeConsoleLevel(payload.level)), entry);
        this.sidecar.debugEvent({
          source: 'tab',
          type: 'console',
          tabId: payload.tabId,
          url: payload.url,
          title: payload.title,
          level: payload.level,
          message: payload.message,
        }).catch(() => {
          // Ignore debug event failures.
        });
        break;
      }
      case 'render': {
        const data = {
          ...base,
          readyState: payload.readyState,
          viewport: payload.viewport,
          scroll: payload.scroll,
          textSample: payload.textSample,
        };
        const entry = `[tab-render] ${this.formatPairs(data)}`;
        this.log('info', entry);
        this.sidecar.debugEvent({
          source: 'tab',
          type: 'render',
          tabId: payload.tabId,
          url: payload.url,
          title: payload.title,
          readyState: payload.readyState,
          viewport: payload.viewport,
          scroll: payload.scroll,
          textSample: payload.textSample,
        }).catch(() => {
          // Ignore debug event failures.
        });
        this.maybeCaptureScreenshot(payload).catch(() => {
          // Ignore screenshot failures.
        });
        break;
      }
      case 'error': {
        const data = {
          ...base,
          message: payload.message,
          filename: payload.filename,
          lineno: payload.lineno,
          colno: payload.colno,
          stack: payload.stack,
        };
        const entry = `[tab-error] ${this.formatPairs(data)}`;
        this.log('error', entry);
        this.sidecar.debugEvent({
          source: 'tab',
          type: 'error',
          tabId: payload.tabId,
          url: payload.url,
          title: payload.title,
          message: payload.message,
          filename: payload.filename,
          lineno: payload.lineno,
          colno: payload.colno,
          stack: payload.stack,
        }).catch(() => {
          // Ignore debug event failures.
        });
        break;
      }
      case 'unhandledrejection': {
        const data = {
          ...base,
          reason: payload.reason,
        };
        const entry = `[tab-unhandledrejection] ${this.formatPairs(data)}`;
        this.log('error', entry);
        this.sidecar.debugEvent({
          source: 'tab',
          type: 'unhandledrejection',
          tabId: payload.tabId,
          url: payload.url,
          title: payload.title,
          reason: payload.reason,
        }).catch(() => {
          // Ignore debug event failures.
        });
        break;
      }
      default: {
        const entry = `[tab-event] ${this.formatPairs({ ...base, type: payload.type })}`;
        this.log('info', entry);
        this.sidecar.debugEvent({
          source: 'tab',
          type: payload.type,
          tabId: payload.tabId,
          url: payload.url,
          title: payload.title,
        }).catch(() => {
          // Ignore debug event failures.
        });
        break;
      }
    }
  }

  private async maybeCaptureScreenshot(payload: DebugPayload): Promise<void> {
    if (!this.screenshotEnabled) return;
    if (!payload.tabId) return;
    const now = Date.now();
    const last = this.lastScreenshotAt.get(payload.tabId) || 0;
    if (now - last < this.screenshotThrottleMs) return;
    this.lastScreenshotAt.set(payload.tabId, now);

    let snapshot: SnapshotResult | null = null;
    try {
      snapshot = await invoke('capture_tab_snapshot', { tabId: payload.tabId }) as SnapshotResult;
    } catch {
      return;
    }

    if (!snapshot || !snapshot.dataBase64) return;

    await this.sidecar.storeScreenshot({
      tabId: payload.tabId,
      url: payload.url,
      title: payload.title,
      mime: snapshot.mime,
      dataBase64: snapshot.dataBase64,
    });
  }

  private formatArgs(args: unknown[]): string {
    const joined = args.map((arg) => this.safeStringify(arg)).join(' ');
    return this.truncate(this.normalize(joined), 1200);
  }

  private safeStringify(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'name' in value && 'message' in value) {
      const name = String((value as { name?: string }).name || 'Error');
      const message = String((value as { message?: string }).message || '');
      const stack = 'stack' in value ? String((value as { stack?: string }).stack || '') : '';
      return this.normalize(`${name}: ${message} ${stack}`);
    }
    try {
      return JSON.stringify(value);
    } catch {
      try {
        return String(value);
      } catch {
        return '[Unserializable]';
      }
    }
  }

  private formatPairs(pairs: Record<string, unknown>): string {
    return Object.entries(pairs)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => {
        if (typeof value === 'string') {
          return `${key}=${JSON.stringify(this.truncate(this.normalize(value), 1600))}`;
        }
        return `${key}=${JSON.stringify(value)}`;
      })
      .join(' ');
  }

  private normalize(text: string): string {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  private truncate(text: string, max: number): string {
    if (!text) return '';
    return text.length > max ? text.slice(0, max) + '...' : text;
  }

  private log(level: LogLevel, entry: string): void {
    if (!this.enabled || !entry) return;
    if (!this.shouldLog(level)) return;
    if (this.logging) return;
    this.logging = true;
    const trimmed = this.truncate(this.normalize(entry), this.maxEntryLength);
    this.sidecar.logSystemEvent(level, trimmed).catch(() => {
      // Ignore sidecar log failures.
    }).finally(() => {
      this.logging = false;
    });
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelValue(level) >= this.levelValue('error');
  }

  private levelValue(level: LogLevel): number {
    switch (level) {
      case 'debug':
        return 10;
      case 'info':
        return 20;
      case 'warn':
        return 30;
      case 'error':
        return 40;
      default:
        return 20;
    }
  }

  private normalizeConsoleLevel(level?: string): ConsoleLevel {
    switch (level) {
      case 'error':
      case 'warn':
      case 'info':
      case 'debug':
      case 'log':
        return level;
      default:
        return 'info';
    }
  }

  private consoleLevelToLogLevel(level: ConsoleLevel): LogLevel {
    switch (level) {
      case 'error':
        return 'error';
      case 'warn':
        return 'warn';
      case 'debug':
        return 'debug';
      case 'log':
      case 'info':
      default:
        return 'info';
    }
  }
}
