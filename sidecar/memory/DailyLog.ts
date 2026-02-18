import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const LOGS_DIR = path.join(os.homedir(), '.clawbrowser', 'workspace', 'logs');

/**
 * DailyLog manages timestamped daily log files at
 * ~/.clawbrowser/workspace/logs/YYYY-MM-DD.md
 */
export class DailyLog {
  private logsDir: string;

  constructor(logsDir?: string) {
    this.logsDir = logsDir || LOGS_DIR;
  }

  /** Ensure logs directory exists. */
  async initialize(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
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
}
