import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CommandExecutor } from '../../sidecar/core/CommandExecutor';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'clawbrowser-exec-'));
}

describe('CommandExecutor', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it('executes an allowlisted command', async () => {
    const executor = new CommandExecutor();
    executor.setAllowlist([
      {
        command: process.execPath,
        argsRegex: ['^-e$', '^console\.log\("ok"\)$'],
      },
    ]);
    executor.setWorkspaceDir(workspaceDir);

    const result = await executor.execute(process.execPath, ['-e', 'console.log("ok")'], workspaceDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ok');
  });

  it('rejects disallowed arguments', async () => {
    const executor = new CommandExecutor();
    executor.setAllowlist([
      {
        command: process.execPath,
        argsRegex: ['^-e$', '^console\.log\("ok"\)$'],
      },
    ]);
    executor.setWorkspaceDir(workspaceDir);

    await expect(
      executor.execute(process.execPath, ['-e', 'console.log("nope")'], workspaceDir)
    ).rejects.toThrow('Argument not allowed');
  });

  it('rejects cwd outside workspace', async () => {
    const executor = new CommandExecutor();
    executor.setAllowlist([
      {
        command: process.execPath,
        argsRegex: ['^-e$', '^console\.log\("ok"\)$'],
      },
    ]);
    executor.setWorkspaceDir(workspaceDir);

    const outside = path.join(workspaceDir, '..');
    await expect(
      executor.execute(process.execPath, ['-e', 'console.log("ok")'], outside)
    ).rejects.toThrow('cwd must be inside the workspace directory');
  });
});
