import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Use vi.hoisted to create mocks that can be referenced in vi.mock factories
const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
}));

// Mock the main module to avoid executing main() on import
vi.mock('../../sidecar/main', () => ({
  sendNotification: mocks.sendNotification,
  handlers: new Map(),
  sendResponse: vi.fn(),
  sendError: vi.fn(),
}));

import { Heartbeat } from '../../sidecar/cron/Heartbeat';
import { WorkspaceFiles } from '../../sidecar/memory/WorkspaceFiles';

describe('Heartbeat', () => {
  let tmpDir: string;
  let workspace: WorkspaceFiles;
  let heartbeat: Heartbeat;

  beforeEach(async () => {
    mocks.sendNotification.mockClear();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-hb-test-'));
    workspace = new WorkspaceFiles(tmpDir);
    await workspace.initialize();
    heartbeat = new Heartbeat(workspace);
  });

  afterEach(async () => {
    heartbeat.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should start the heartbeat and write HEARTBEAT.md', async () => {
    heartbeat.start();
    // start() calls pulse() immediately
    await new Promise(resolve => setTimeout(resolve, 100));

    const content = await workspace.read('HEARTBEAT.md');
    expect(content).toContain('# Heartbeat');
    expect(content).toContain('**Tab Count:** 0');
    expect(content).toContain('**Active Tab:** none');
    expect(content).toContain('**Current Context:** idle');
  });

  it('should not error on repeated starts', () => {
    heartbeat.start();
    // Second start should be a no-op
    expect(() => heartbeat.start()).not.toThrow();
  });

  it('should not error on stop without start', () => {
    expect(() => heartbeat.stop()).not.toThrow();
  });

  it('should send heartbeatPulse notification on start', async () => {
    heartbeat.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'heartbeatPulse',
      expect.objectContaining({
        activeTabs: 0,
        currentContext: 'idle',
        pendingActions: [],
      })
    );
  });

  it('should update tab state and reflect in HEARTBEAT.md', async () => {
    heartbeat.updateTabState(3, 'GitHub - ClawBrowser');
    heartbeat.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    const content = await workspace.read('HEARTBEAT.md');
    expect(content).toContain('**Tab Count:** 3');
    expect(content).toContain('**Active Tab:** GitHub - ClawBrowser');
  });

  it('should update context and reflect in HEARTBEAT.md', async () => {
    heartbeat.updateContext('browsing');
    heartbeat.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    const content = await workspace.read('HEARTBEAT.md');
    expect(content).toContain('**Current Context:** browsing');
  });

  it('should add pending actions', async () => {
    heartbeat.addPendingAction('Summarize page');
    heartbeat.addPendingAction('Fill form');
    heartbeat.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    const content = await workspace.read('HEARTBEAT.md');
    expect(content).toContain('- Summarize page');
    expect(content).toContain('- Fill form');
  });

  it('should remove pending actions', async () => {
    heartbeat.addPendingAction('Summarize page');
    heartbeat.addPendingAction('Fill form');
    heartbeat.removePendingAction('Summarize page');
    heartbeat.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    const content = await workspace.read('HEARTBEAT.md');
    expect(content).not.toContain('- Summarize page');
    expect(content).toContain('- Fill form');
  });

  it('should include uptime in HEARTBEAT.md', async () => {
    heartbeat.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    const content = await workspace.read('HEARTBEAT.md');
    expect(content).toContain('**Uptime:**');
    expect(content).toMatch(/\*\*Uptime:\*\* \d+s/);
  });

  it('should include ISO timestamp in HEARTBEAT.md', async () => {
    heartbeat.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    const content = await workspace.read('HEARTBEAT.md');
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should include notification with lastPulse timestamp', async () => {
    heartbeat.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'heartbeatPulse',
      expect.objectContaining({
        lastPulse: expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      })
    );
  });
});
