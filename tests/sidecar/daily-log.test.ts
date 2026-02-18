import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DailyLog } from '../../sidecar/memory/DailyLog';

describe('DailyLog', () => {
  let tmpDir: string;
  let log: DailyLog;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-log-test-'));
    log = new DailyLog(tmpDir);
    await log.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should create logs directory on initialize', async () => {
    const stat = await fs.stat(tmpDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('should log an entry to today file', async () => {
    await log.log('Test entry');

    const today = new Date().toISOString().split('T')[0];
    const content = await fs.readFile(path.join(tmpDir, `${today}.md`), 'utf-8');

    expect(content).toContain(`# ${today}`);
    expect(content).toContain('Test entry');
    // Should have a timestamp in [HH:MM:SS] format
    expect(content).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
  });

  it('should append multiple entries to same day', async () => {
    await log.log('First entry');
    await log.log('Second entry');

    const content = await log.readToday();
    expect(content).toContain('First entry');
    expect(content).toContain('Second entry');
  });

  it('should read today log', async () => {
    await log.log('Today log test');

    const content = await log.readToday();
    expect(content).toContain('Today log test');
  });

  it('should return empty string for nonexistent date', async () => {
    const content = await log.readDate('1999-01-01');
    expect(content).toBe('');
  });

  it('should read log for specific date', async () => {
    const today = new Date().toISOString().split('T')[0];
    await log.log('Specific date entry');

    const content = await log.readDate(today);
    expect(content).toContain('Specific date entry');
  });

  it('should list available log dates', async () => {
    await log.log('Entry for listing');

    const dates = await log.listLogs();
    const today = new Date().toISOString().split('T')[0];

    expect(dates).toContain(today);
  });

  it('should return empty array when no logs exist', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-log-empty-'));
    const emptyLog = new DailyLog(emptyDir);
    await emptyLog.initialize();

    const dates = await emptyLog.listLogs();
    expect(dates).toEqual([]);

    await fs.rm(emptyDir, { recursive: true, force: true });
  });

  it('should format entries as markdown list items', async () => {
    await log.log('Markdown item test');

    const content = await log.readToday();
    // Each entry should be a "- [HH:MM:SS] message" line
    expect(content).toMatch(/^- \[\d{2}:\d{2}:\d{2}\] Markdown item test$/m);
  });
});
