import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MatrixBackground } from '../../src/ui/MatrixBackground';

describe('MatrixBackground watermark', () => {
  const originalMatchMedia = window.matchMedia;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as any;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
    } as any;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('draws watermark lines when configured', () => {
    const fillText = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillText,
      fillRect: vi.fn(),
      measureText: () => ({ width: 10 }),
      setTransform: vi.fn(),
      font: '',
      textBaseline: '',
      textAlign: '',
      fillStyle: '',
      save: vi.fn(),
      restore: vi.fn(),
    });

    const overlay = document.createElement('div');
    overlay.getBoundingClientRect = () => ({ width: 400, height: 200 } as any);

    const matrix = new MatrixBackground(overlay, {
      watermark: {
        lines: ['CLAWBROWSER', 'THE SMARTEST CHILD OF OPENCLAW.'],
      },
    });

    matrix.start();

    expect(fillText).toHaveBeenCalledWith('CLAWBROWSER', expect.any(Number), expect.any(Number));
    expect(fillText).toHaveBeenCalledWith('THE SMARTEST CHILD OF OPENCLAW.', expect.any(Number), expect.any(Number));
  });
});
