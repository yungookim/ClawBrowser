import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserAutomationRouter, createBrowserAutomationTraceId, type BrowserAutomationProvider } from '../../sidecar/dom/BrowserAutomationRouter';

function makeScreenshot() {
  return { mime: 'image/png', dataBase64: Buffer.from('img').toString('base64'), byteLength: 3 };
}

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'claw-router-'));
}

describe('BrowserAutomationRouter', () => {
  let logDir: string;
  let previousLogDir: string | undefined;

  beforeEach(async () => {
    previousLogDir = process.env.CLAW_LOG_DIR;
    logDir = await makeTempDir();
    process.env.CLAW_LOG_DIR = logDir;
  });

  afterEach(async () => {
    if (previousLogDir === undefined) {
      delete process.env.CLAW_LOG_DIR;
    } else {
      process.env.CLAW_LOG_DIR = previousLogDir;
    }
    await fs.rm(logDir, { recursive: true, force: true });
  });

  it('logs a successful stagehand attempt with screenshot', async () => {
    const stagehandProvider: BrowserAutomationProvider = {
      name: 'stagehand',
      execute: vi.fn().mockResolvedValue({ ok: true }),
      captureScreenshot: vi.fn().mockResolvedValue(makeScreenshot()),
    };

    const router = new BrowserAutomationRouter({ stagehandProvider });
    const traceId = createBrowserAutomationTraceId();
    const result = await router.execute({
      kind: 'agent',
      tool: 'browser.act',
      capability: 'stagehand',
      action: 'act',
      params: { instruction: 'click' },
    }, { traceId });

    expect(result.ok).toBe(true);
    expect(stagehandProvider.execute).toHaveBeenCalledTimes(1);
    const date = new Date().toISOString().slice(0, 10);
    const traceDir = path.join(logDir, 'browser-automation', date, traceId);
    const attemptLog = await fs.readFile(path.join(traceDir, 'attempt.jsonl'), 'utf-8');
    expect(attemptLog).toContain('"event":"success"');

    const artifacts = await fs.readdir(path.join(traceDir, 'artifacts'));
    expect(artifacts.some((file) => file.includes('screenshot-attempt-1'))).toBe(true);
  });

  it('requests a stagehand retry on first failure', async () => {
    const stagehandProvider: BrowserAutomationProvider = {
      name: 'stagehand',
      execute: vi.fn().mockRejectedValue(new Error('boom')),
      captureScreenshot: vi.fn().mockResolvedValue(makeScreenshot()),
    };

    const router = new BrowserAutomationRouter({ stagehandProvider });
    const traceId = createBrowserAutomationTraceId();

    const result = await router.execute({
      kind: 'agent',
      tool: 'browser.act',
      capability: 'stagehand',
      action: 'act',
      params: { instruction: 'click' },
    }, { traceId });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Retry the same browser.* tool once more');
  });

  it('returns a disabled error after a second stagehand failure when webview is unavailable', async () => {
    const stagehandProvider: BrowserAutomationProvider = {
      name: 'stagehand',
      execute: vi.fn().mockRejectedValue(new Error('boom')),
      captureScreenshot: vi.fn().mockResolvedValue(makeScreenshot()),
    };

    const router = new BrowserAutomationRouter({ stagehandProvider });
    const traceId = createBrowserAutomationTraceId();

    const first = await router.execute({
      kind: 'agent',
      tool: 'browser.act',
      capability: 'stagehand',
      action: 'act',
      params: { instruction: 'click' },
    }, { traceId });

    expect(first.ok).toBe(false);

    const second = await router.execute({
      kind: 'agent',
      tool: 'browser.act',
      capability: 'stagehand',
      action: 'act',
      params: { instruction: 'click' },
    }, { traceId });

    expect(second.ok).toBe(false);
    expect(second.error).toContain('Webview automation disabled');

    const third = await router.execute({
      kind: 'agent',
      tool: 'browser.act',
      capability: 'stagehand',
      action: 'act',
      params: { instruction: 'click' },
    }, { traceId });

    expect(third.ok).toBe(false);
    expect(third.error).toContain('Webview automation disabled');
    expect(stagehandProvider.execute).toHaveBeenCalledTimes(2);
  });

  it('redacts snapshot values and URL query params', async () => {
    const stagehandProvider: BrowserAutomationProvider = {
      name: 'stagehand',
      execute: vi.fn().mockRejectedValue(new Error('boom')),
      captureSnapshot: vi.fn().mockResolvedValue({
        minimalDom: [{ value: 'secret', href: 'https://example.com?a=1&b=2' }],
      }),
    };

    const router = new BrowserAutomationRouter({ stagehandProvider });
    const traceId = createBrowserAutomationTraceId();

    await router.execute({
      kind: 'agent',
      tool: 'browser.act',
      capability: 'stagehand',
      action: 'act',
      params: { instruction: 'click' },
    }, { traceId });

    const date = new Date().toISOString().slice(0, 10);
    const traceDir = path.join(logDir, 'browser-automation', date, traceId, 'artifacts');
    const files = await fs.readdir(traceDir);
    const snapshotFile = files.find((file) => file.startsWith('snapshot-'));
    expect(snapshotFile).toBeTruthy();

    const content = await fs.readFile(path.join(traceDir, snapshotFile as string), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.minimalDom[0].value).toBe('[REDACTED]');
    expect(parsed.minimalDom[0].href).toContain('[REDACTED]');
  });
});
