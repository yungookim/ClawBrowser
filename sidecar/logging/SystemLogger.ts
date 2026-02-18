import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_MIN_LEVEL: LogLevel = 'error';
const RETENTION_DAYS = 7;
const DEFAULT_LOGS_DIR = path.join(os.homedir(), '.clawbrowser', 'workspace', 'logs', 'system');

export class SystemLogger {
  private logsDir: string;
  private minLevel: LogLevel;
  private lastPruneDate: string | null = null;
  private consoleWrapped = false;

  constructor(options?: { logsDir?: string; minLevel?: LogLevel }) {
    this.logsDir = options?.logsDir || DEFAULT_LOGS_DIR;
    this.minLevel = options?.minLevel || DEFAULT_MIN_LEVEL;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
    await this.pruneOldLogs();
  }

  getLogsDir(): string {
    return this.logsDir;
  }

  setLogsDir(logsDir: string): void {
    if (!logsDir || logsDir === this.logsDir) return;
    this.logsDir = logsDir;
    this.lastPruneDate = null;
  }

  attachConsole(): void {
    if (this.consoleWrapped) return;
    this.consoleWrapped = true;

    type ConsoleMethod = 'error' | 'warn' | 'info' | 'log' | 'debug';
    const consoleMethods = console as unknown as Record<ConsoleMethod, (...args: unknown[]) => void>;

    const wrap = (method: ConsoleMethod, level: LogLevel): void => {
      const original = consoleMethods[method];
      consoleMethods[method] = (...args: unknown[]) => {
        try {
          const message = this.formatArgs(args);
          if (message) {
            this.log(level, message).catch(() => {
              // Ignore logging failures.
            });
          }
        } catch {
          // Ignore logging failures.
        }
        original(...args);
      };
    };

    wrap('error', 'error');
    wrap('warn', 'warn');
    wrap('info', 'info');
    wrap('log', 'info');
    wrap('debug', 'debug');
  }

  async log(level: LogLevel, message: string): Promise<void> {
    const trimmed = String(message || '').trim();
    if (!trimmed) return;
    if (!this.shouldLog(level)) return;

    const now = new Date();
    const dateStr = this.dateString(now);
    const timeStr = this.timestamp(now);

    if (this.lastPruneDate !== dateStr) {
      await this.pruneOldLogs(dateStr);
    }

    await fs.mkdir(this.logsDir, { recursive: true });
    const line = `[${timeStr}] ${level.toUpperCase()} ${trimmed}\n`;
    await fs.appendFile(this.filePath(dateStr), line, 'utf-8');
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  private filePath(dateStr: string): string {
    return path.join(this.logsDir, `${dateStr}.log`);
  }

  private dateString(date: Date): string {
    const year = date.getUTCFullYear();
    const month = this.pad2(date.getUTCMonth() + 1);
    const day = this.pad2(date.getUTCDate());
    return `${year}-${month}-${day}`;
  }

  private timestamp(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  private pad2(value: number): string {
    return String(value).padStart(2, '0');
  }

  private formatArgs(args: unknown[]): string {
    return args.map((arg) => this.safeStringify(arg)).join(' ').trim();
  }

  private safeStringify(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) {
      const stack = value.stack ? ` ${value.stack}` : '';
      return `${value.name}: ${value.message}${stack}`;
    }
    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[Unserializable object]';
      }
    }
    try {
      return String(value);
    } catch {
      return '[Unserializable]';
    }
  }

  private async pruneOldLogs(todayOverride?: string): Promise<void> {
    const todayStr = todayOverride || this.dateString(new Date());
    if (this.lastPruneDate === todayStr) return;
    this.lastPruneDate = todayStr;

    const cutoff = this.subtractDays(todayStr, RETENTION_DAYS - 1);
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.logsDir);
    } catch {
      return;
    }

    const deletions = entries
      .filter((entry) => entry.endsWith('.log'))
      .map((entry) => entry.replace('.log', ''))
      .filter((dateStr) => this.isValidDate(dateStr) && dateStr < cutoff)
      .map((dateStr) => fs.unlink(this.filePath(dateStr)).catch(() => {
        // Ignore delete errors.
      }));

    await Promise.all(deletions);
  }

  private subtractDays(dateStr: string, days: number): string {
    const date = this.parseDate(dateStr);
    if (!date) return dateStr;
    date.setUTCDate(date.getUTCDate() - days);
    return this.dateString(date);
  }

  private parseDate(dateStr: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() + 1 !== month
      || date.getUTCDate() !== day
    ) {
      return null;
    }
    return date;
  }

  private isValidDate(dateStr: string): boolean {
    return this.parseDate(dateStr) !== null;
  }
}
