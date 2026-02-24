# Agent Panel Matrix Watermark Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add centered, subtle watermark text behind the matrix background in the agent panel.

**Architecture:** Extend `MatrixBackground` to support an optional watermark config rendered inside the canvas (background fill -> watermark -> glyphs). Configure the watermark only for the agent panel instance in `src/main.ts`.

**Tech Stack:** TypeScript, Canvas 2D, Vitest (jsdom), Vite/Tauri frontend.

---

### Task 1: Add MatrixBackground Watermark Rendering + Unit Test

**Files:**
- Create: `tests/frontend/matrix-background.test.ts`
- Modify: `src/ui/MatrixBackground.ts:1`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MatrixBackground } from '../../src/ui/MatrixBackground';

describe('MatrixBackground watermark', () => {
  const originalMatchMedia = window.matchMedia;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as any;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/matrix-background.test.ts --config vitest.config.ts`

Expected: FAIL with `expected "CLAWBROWSER" to be called`.

**Step 3: Write minimal implementation**

```ts
type MatrixWatermark = {
  lines: string[];
  fontSize?: number;
  opacity?: number;
  lineHeight?: number;
  fontFamily?: string;
};

type MatrixBackgroundOptions = {
  watermark?: MatrixWatermark;
};

export class MatrixBackground {
  // ...
  private watermark?: MatrixWatermark;

  constructor(overlay: HTMLElement, options: MatrixBackgroundOptions = {}) {
    this.overlay = overlay;
    this.watermark = options.watermark;
    // existing setup
  }

  private drawFrame(): void {
    if (!this.ctx) return;
    this.ctx.fillStyle = this.toRgba(this.colors.bg, this.fadeAlpha);
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    this.drawWatermark();
    // existing glyph draw loop
  }

  private drawStatic(): void {
    if (!this.ctx) return;
    this.ctx.fillStyle = this.toRgba(this.colors.bg, 1);
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    this.drawWatermark();
    // existing static glyph draws
  }

  private drawWatermark(): void {
    if (!this.ctx || !this.watermark?.lines?.length) return;
    const fontSize = this.watermark.fontSize ?? Math.max(18, Math.min(40, Math.floor(this.canvasWidth / 12)));
    const lineHeight = this.watermark.lineHeight ?? Math.floor(fontSize * 1.2);
    const fontFamily = this.watermark.fontFamily ?? this.fontFamily;
    const opacity = this.watermark.opacity ?? 0.08;

    this.ctx.save();
    this.ctx.font = `${fontSize}px ${fontFamily}`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = this.toRgba(this.colors.accent, opacity);

    const centerX = this.canvasWidth / 2;
    const totalHeight = lineHeight * (this.watermark.lines.length - 1);
    const startY = this.canvasHeight / 2 - totalHeight / 2;

    this.watermark.lines.forEach((line, index) => {
      this.ctx.fillText(line, centerX, startY + index * lineHeight);
    });

    this.ctx.restore();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frontend/matrix-background.test.ts --config vitest.config.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/frontend/matrix-background.test.ts src/ui/MatrixBackground.ts
git commit -m "feat: add matrix background watermark rendering"
```

---

### Task 2: Wire Agent Panel Watermark + Bootstrap Test

**Files:**
- Modify: `src/main.ts:290`
- Modify: `tests/frontend/main.test.ts:1`

**Step 1: Write the failing test**

```ts
// Add near existing mocks
const matrixMocks = vi.hoisted(() => ({
  options: null as null | { watermark?: { lines: string[] } },
}));

vi.mock('../../src/ui/MatrixBackground', () => ({
  MatrixBackground: class {
    constructor(_el: HTMLElement, options?: { watermark?: { lines: string[] } }) {
      matrixMocks.options = options ?? null;
    }
    start = vi.fn();
  },
}));
```

Add an assertion in `initializes UI and wires handlers`:

```ts
expect(matrixMocks.options?.watermark?.lines).toEqual([
  'CLAWBROWSER',
  'THE SMARTEST CHILD OF OPENCLAW.',
]);
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/main.test.ts --config vitest.config.ts`

Expected: FAIL with `expected undefined to equal [...]`.

**Step 3: Write minimal implementation**

```ts
const matrixBackground = new MatrixBackground(agentPanelEl, {
  watermark: {
    lines: ['CLAWBROWSER', 'THE SMARTEST CHILD OF OPENCLAW.'],
    fontSize: 28,
    opacity: 0.08,
  },
});
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frontend/main.test.ts --config vitest.config.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main.ts tests/frontend/main.test.ts
git commit -m "feat: configure agent panel matrix watermark"
```
