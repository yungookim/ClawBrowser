import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const LOGS_DIR = path.join(os.homedir(), '.clawbrowser', 'workspace', 'logs');
const RETENTION_DAYS = 7;

/**
 * DailyLog manages timestamped daily log files at
 * ~/.clawbrowser/workspace/logs/YYYY-MM-DD.md
 */
export class DailyLog {
  private logsDir: string;
  private lastPruneDate: string | null = null;

  constructor(logsDir?: string) {
    this.logsDir = logsDir || LOGS_DIR;
  }

  /** Ensure logs directory exists. */
  async initialize(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
    await this.pruneOldLogs();
  }

  /** Get today's date as YYYY-MM-DD. */
  private todayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  /** Get current time as HH:MM:SS. */
  private timeString(): string {
    return new Date().toISOString().split('T')[1].split('.')[0];
  }

  /** Get the file path for a given date. */
  private filePath(dateStr: string): string {
    return path.join(this.logsDir, `${dateStr}.md`);
  }

  /** Log an entry with timestamp to today's log. */
  async log(entry: string): Promise<void> {
    const dateStr = this.todayString();
    const filePath = this.filePath(dateStr);
    const timeStr = this.timeString();

    const line = `- [${timeStr}] ${entry}\n`;

    try {
      await fs.access(filePath);
    } catch {
      // Create file with date header
      await fs.writeFile(filePath, `# ${dateStr}\n\n`, 'utf-8');
    }

    await fs.appendFile(filePath, line, 'utf-8');
    await this.pruneOldLogs(dateStr);
  }

  /** Read today's log. Returns empty string if no log exists. */
  async readToday(): Promise<string> {
    return this.readDate(this.todayString());
  }

  /** Read the log for a specific date. */
  async readDate(dateStr: string): Promise<string> {
    try {
      return await fs.readFile(this.filePath(dateStr), 'utf-8');
    } catch {
      return '';
    }
  }

  /** List all available log dates. */
  async listLogs(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.logsDir);
      return entries
        .filter(e => e.endsWith('.md'))
        .map(e => e.replace('.md', ''))
        .sort();
    } catch {
      return [];
    }
  }

  getLogsDir(): string {
    return this.logsDir;
  }

  private async pruneOldLogs(todayOverride?: string): Promise<void> {
    const todayStr = todayOverride || this.todayString();
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
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => entry.replace('.md', ''))
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

  private dateString(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
