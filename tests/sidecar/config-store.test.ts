import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigStore } from '../../sidecar/core/ConfigStore';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'clawbrowser-test-'));
}

describe('ConfigStore', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('loads defaults and persists config file', async () => {
    const store = new ConfigStore({ baseDir });
    const config = await store.load();

    expect(config.onboardingComplete).toBe(false);
    expect(config.commandAllowlist.length).toBeGreaterThan(0);

    const configPath = path.join(baseDir, '.clawbrowser', 'config.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    expect(raw).toContain('onboardingComplete');
  });

  it('updates config and preserves model roles', async () => {
    const store = new ConfigStore({ baseDir });
    await store.load();

    await store.update({
      onboardingComplete: true,
      models: {
        primary: { provider: 'openai', model: 'gpt-4o' },
      },
    });

    expect(store.get().onboardingComplete).toBe(true);
    expect(store.get().models.primary?.model).toBe('gpt-4o');

    const reloaded = new ConfigStore({ baseDir });
    const next = await reloaded.load();
    expect(next.onboardingComplete).toBe(true);
    expect(next.models.primary?.provider).toBe('openai');
  });

  it('persists an explicit empty allowlist', async () => {
    const store = new ConfigStore({ baseDir });
    await store.load();

    await store.update({ commandAllowlist: [] });
    expect(store.get().commandAllowlist).toEqual([]);

    const reloaded = new ConfigStore({ baseDir });
    const next = await reloaded.load();
    expect(next.commandAllowlist).toEqual([]);
  });

  it('saves and loads vault data', async () => {
    const store = new ConfigStore({ baseDir });
    await store.load();

    await store.saveVault('encrypted-data');
    const data = await store.loadVault();
    expect(data).toBe('encrypted-data');
  });
});
