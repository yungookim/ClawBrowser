import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ModelManager } from '../../sidecar/core/ModelManager';
import { StagehandBridge } from '../../sidecar/dom/StagehandBridge';

type MockPage = {
  goto: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  act: ReturnType<typeof vi.fn>;
  extract: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
};

type MockContext = {
  isClosed: ReturnType<typeof vi.fn>;
  activePage: ReturnType<typeof vi.fn>;
  pages: ReturnType<typeof vi.fn>;
  newPage: ReturnType<typeof vi.fn>;
  browser: ReturnType<typeof vi.fn>;
};

type MockBrowser = {
  process: ReturnType<typeof vi.fn>;
  wsEndpoint: ReturnType<typeof vi.fn>;
};

const stagehandMocks = {
  init: vi.fn(),
  close: vi.fn(),
  act: vi.fn(),
  extract: vi.fn(),
  observe: vi.fn(),
  createStagehand: vi.fn(),
  page: undefined as MockPage | undefined,
  context: undefined as MockContext | undefined,
  browser: undefined as MockBrowser | undefined,
};

function makeConfigStore(models: Record<string, any> = {}, workspacePath: string | null = null) {
  return {
    get: () => ({ models, workspacePath }),
  } as any;
}

function setupStagehandMocks(): void {
  stagehandMocks.init.mockResolvedValue(undefined);
  stagehandMocks.close.mockResolvedValue(undefined);
  stagehandMocks.act.mockResolvedValue({ ok: true });
  stagehandMocks.extract.mockResolvedValue({ data: 'extracted' });
  stagehandMocks.observe.mockResolvedValue([{ type: 'click', selector: '#button' }]);

  stagehandMocks.browser = {
    process: vi.fn().mockReturnValue({ pid: 1234 }),
    wsEndpoint: vi.fn().mockReturnValue('ws://localhost:1234'),
  };

  stagehandMocks.page = {
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue('Example'),
    url: vi.fn().mockReturnValue('https://example.com'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('image')),
    act: stagehandMocks.act,
    extract: stagehandMocks.extract,
    observe: stagehandMocks.observe,
  };

  stagehandMocks.context = {
    isClosed: vi.fn().mockReturnValue(false),
    activePage: vi.fn().mockResolvedValue(stagehandMocks.page),
    pages: vi.fn().mockReturnValue([stagehandMocks.page]),
    newPage: vi.fn().mockResolvedValue(stagehandMocks.page),
    browser: vi.fn().mockReturnValue(stagehandMocks.browser),
  };

  stagehandMocks.createStagehand.mockImplementation(() => ({
    init: stagehandMocks.init,
    close: stagehandMocks.close,
    act: stagehandMocks.act,
    extract: stagehandMocks.extract,
    observe: stagehandMocks.observe,
    page: stagehandMocks.page,
    context: stagehandMocks.context,
    browser: stagehandMocks.browser,
  }));
}

describe('StagehandBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStagehandMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lazy inits Stagehand on first use', async () => {
    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });
    expect(stagehandMocks.createStagehand).not.toHaveBeenCalled();

    await bridge.navigate('https://example.com');

    expect(stagehandMocks.createStagehand).toHaveBeenCalledTimes(1);
    expect(stagehandMocks.init).toHaveBeenCalledTimes(1);
  });

  it('configures a persistent userDataDir', async () => {
    const workspacePath = '/tmp/clawbrowser-workspace';
    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore({}, workspacePath), {
      createStagehand: stagehandMocks.createStagehand,
    });

    await bridge.act('do');

    const options = stagehandMocks.createStagehand.mock.calls[0][0];
    expect(options.localBrowserLaunchOptions?.userDataDir)
      .toBe(path.join(workspacePath, 'browser-profile', 'default'));
    expect(options.localBrowserLaunchOptions?.preserveUserDataDir).toBe(true);
    expect(fs.mkdir).toHaveBeenCalledWith(
      path.join(workspacePath, 'browser-profile', 'default'),
      { recursive: true },
    );
  });

  it('reuses Stagehand across calls', async () => {
    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    await bridge.navigate('https://example.com');
    await bridge.act('click the button');

    expect(stagehandMocks.createStagehand).toHaveBeenCalledTimes(1);
    expect(stagehandMocks.init).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent init calls', async () => {
    let resolveInit: (() => void) | null = null;
    let initStartedResolve: (() => void) | null = null;
    const initStarted = new Promise<void>((resolve) => {
      initStartedResolve = resolve;
    });
    stagehandMocks.init.mockImplementation(() => new Promise<void>((resolve) => {
      resolveInit = resolve;
      initStartedResolve?.();
    }));

    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    const callA = bridge.act('do A');
    const callB = bridge.observe('do B');

    await initStarted;
    resolveInit?.();
    await Promise.all([callA, callB]);

    expect(stagehandMocks.createStagehand).toHaveBeenCalledTimes(1);
    expect(stagehandMocks.init).toHaveBeenCalledTimes(1);
  });

  it('executes navigate, act, extract, observe, and screenshot', async () => {
    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    const nav = await bridge.navigate('https://example.com');
    const act = await bridge.act('click');
    const extract = await bridge.extract('extract');
    const observe = await bridge.observe('observe');
    const shot = await bridge.screenshot();

    expect(nav.url).toBe('https://example.com');
    expect(act).toEqual({ ok: true });
    expect(extract).toEqual({ data: 'extracted' });
    expect(observe).toEqual([{ type: 'click', selector: '#button' }]);
    expect(shot.mime).toBe('image/png');
    expect(shot.dataBase64).toBe(Buffer.from('image').toString('base64'));
    expect(stagehandMocks.context?.newPage).toHaveBeenCalled();
  });

  it('opens a session tab', async () => {
    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    await bridge.openSession();

    expect(stagehandMocks.context?.newPage).toHaveBeenCalled();
    expect(stagehandMocks.page?.goto).toHaveBeenCalledWith('about:blank');
  });

  it('opens a new tab when instruction includes a URL', async () => {
    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    await bridge.extract('Open https://example.com and extract');

    expect(stagehandMocks.context?.newPage).toHaveBeenCalledTimes(1);
    expect(stagehandMocks.page?.goto).toHaveBeenCalledWith('https://example.com');
  });

  it('converts JSON schema to Zod for extract', async () => {
    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    await bridge.extract('extract price', {
      type: 'object',
      properties: {
        price: { type: 'number' },
      },
    });

    const callArg = stagehandMocks.extract.mock.calls[0][0];
    expect(callArg).toMatchObject({ instruction: 'extract price' });
    expect(typeof callArg.schema?.safeParse).toBe('function');
  });

  it('wraps non-object schema and unwraps result', async () => {
    stagehandMocks.extract.mockResolvedValueOnce({ result: [{ title: 'A' }] });

    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    const result = await bridge.extract('extract list', {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
        },
      },
    });

    const callArg = stagehandMocks.extract.mock.calls[0][0];
    expect(typeof callArg.schema?._def?.shape).toBe('function');
    expect(result).toEqual([{ title: 'A' }]);
  });

  it('closes and reports active state', async () => {
    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });
    await bridge.act('do');

    expect(bridge.isActive()).toBe(true);

    await bridge.close();

    expect(bridge.isActive()).toBe(false);
    expect(stagehandMocks.close).toHaveBeenCalledTimes(1);
  });

  it('resolves model config from ModelManager then ConfigStore', async () => {
    const modelManager = new ModelManager();
    modelManager.configure({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      role: 'primary',
    });

    const bridge = new StagehandBridge(modelManager, makeConfigStore({
      primary: { provider: 'anthropic', model: 'claude-3-5' },
    }), {
      createStagehand: stagehandMocks.createStagehand,
    });

    await bridge.act('do');

    const options = stagehandMocks.createStagehand.mock.calls[0][0];
    expect(options.modelName || options.model).toBe('openai/gpt-4o');
    expect(options.modelClientOptions?.apiKey).toBe('test-key');
  });

  it('falls back to ConfigStore when ModelManager has no primary', async () => {
    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore({
      primary: { provider: 'anthropic', model: 'claude-3-5' },
    }), {
      createStagehand: stagehandMocks.createStagehand,
    });

    await bridge.act('do');

    const options = stagehandMocks.createStagehand.mock.calls[0][0];
    expect(options.modelName || options.model).toBe('anthropic/claude-3-5');
  });

  it('defaults to openai/gpt-4o when no model config exists', async () => {
    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    await bridge.act('do');

    const options = stagehandMocks.createStagehand.mock.calls[0][0];
    expect(options.modelName || options.model).toBe('openai/gpt-4o');
  });

  it('reinitializes when model config changes', async () => {
    const modelManager = new ModelManager();
    modelManager.configure({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'key-1',
      role: 'primary',
    });

    const bridge = new StagehandBridge(modelManager, makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    await bridge.act('first');

    modelManager.configure({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'key-2',
      role: 'primary',
    });

    await bridge.act('second');

    expect(stagehandMocks.createStagehand).toHaveBeenCalledTimes(2);
  });

  it('surfaces action errors', async () => {
    stagehandMocks.act.mockRejectedValueOnce(new Error('boom'));

    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    await expect(bridge.act('fail')).rejects.toThrow('boom');
  });

  it('recovers from crash errors by reinitializing', async () => {
    stagehandMocks.act
      .mockRejectedValueOnce(new Error('Target closed'))
      .mockResolvedValueOnce({ ok: true });

    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      createStagehand: stagehandMocks.createStagehand,
    });

    const result = await bridge.act('retry');

    expect(result).toEqual({ ok: true });
    expect(stagehandMocks.createStagehand).toHaveBeenCalledTimes(2);
  });

  it('auto-closes after idle timeout', async () => {
    vi.useFakeTimers();

    const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
      idleTimeoutMs: 1000,
      createStagehand: stagehandMocks.createStagehand,
    });
    await bridge.act('do');

    expect(stagehandMocks.close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();

    expect(stagehandMocks.close).toHaveBeenCalledTimes(1);
  });
});
