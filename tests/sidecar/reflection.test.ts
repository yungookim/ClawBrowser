import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflection } from '../../sidecar/cron/Reflection';

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
}));

vi.mock('../../sidecar/main.js', () => ({
  sendNotification: (...args: any[]) => mocks.sendNotification(...args),
}));

describe('Reflection', () => {
  beforeEach(() => {
    mocks.sendNotification.mockReset();
  });

  it('starts and stops the cron schedule', () => {
    const reflection = new Reflection({} as any, {} as any, {} as any);
    expect(() => reflection.start('*/5 * * * *')).not.toThrow();
    expect(() => reflection.start('*/5 * * * *')).not.toThrow();
    expect(() => reflection.stop()).not.toThrow();
  });

  it('skips when no model or no daily log', async () => {
    const workspace = { loadAll: vi.fn() };
    const dailyLog = { readToday: vi.fn().mockResolvedValue('') };
    const modelManager = { createModel: vi.fn().mockReturnValue(undefined) };

    const reflection = new Reflection(workspace as any, dailyLog as any, modelManager as any);
    const result = await reflection.reflect();
    expect(result).toBeNull();
  });

  it('applies updates and sends notifications', async () => {
    const workspace = {
      loadAll: vi.fn().mockResolvedValue({
        'SOUL.md': 'existing',
        'USER.md': 'existing',
        'IDENTITY.md': 'existing',
        'HEARTBEAT.md': 'skip',
        'BOOT.md': 'skip',
      }),
      append: vi.fn().mockResolvedValue(undefined),
    };
    const dailyLog = {
      readToday: vi.fn().mockResolvedValue('Log entry'),
      log: vi.fn().mockResolvedValue(undefined),
    };
    const output = {
      soulUpdates: '- New soul update',
      userUpdates: '',
      identityUpdates: '- New identity update',
      memories: [{ id: 'mem-1', content: 'Memory', tags: ['tag'] }],
      summary: 'Summary',
    };
    const model = {
      invoke: vi.fn().mockResolvedValue({ content: JSON.stringify(output) }),
    };
    const modelManager = {
      createModel: vi.fn().mockReturnValue(model),
    };

    const reflection = new Reflection(workspace as any, dailyLog as any, modelManager as any);
    const memoryHandler = vi.fn().mockResolvedValue(undefined);
    reflection.setMemoryHandler(memoryHandler);

    const result = await reflection.reflect();
    expect(result).toEqual(output);

    expect(workspace.append).toHaveBeenCalledWith(
      'SOUL.md',
      expect.stringContaining(output.soulUpdates)
    );
    expect(workspace.append).toHaveBeenCalledWith(
      'IDENTITY.md',
      expect.stringContaining(output.identityUpdates)
    );
    expect(workspace.append).toHaveBeenCalledTimes(2);

    expect(memoryHandler).toHaveBeenCalledWith(output.memories);
    expect(dailyLog.log).toHaveBeenCalledWith(expect.stringContaining('Nightly reflection'));

    expect(mocks.sendNotification).toHaveBeenCalledWith('reflectionComplete', {
      summary: output.summary,
      memoriesAdded: 1,
    });
  });
});
