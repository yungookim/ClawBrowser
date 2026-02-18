type Rgb = { r: number; g: number; b: number };

type MatrixColors = {
  bg: Rgb;
  accent: Rgb;
  muted: Rgb;
};

const DEFAULT_BG: Rgb = { r: 0, g: 0, b: 0 };
const DEFAULT_ACCENT: Rgb = { r: 255, g: 255, b: 255 };
const DEFAULT_MUTED: Rgb = { r: 140, g: 140, b: 140 };

const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+-/<>[]{}';

export class MatrixBackground {
  private overlay: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private running = false;
  private rafId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private columns = 0;
  private drops: number[] = [];
  private charWidth = 12;
  private fontSize = 14;
  private fontFamily = "SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
  private frameIntervalMs = 55;
  private lastFrameTime = 0;
  private fadeAlpha = 0.12;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private colors: MatrixColors = {
    bg: DEFAULT_BG,
    accent: DEFAULT_ACCENT,
    muted: DEFAULT_MUTED,
  };
  private prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(overlay: HTMLElement) {
    this.overlay = overlay;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'matrix-background';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.setAttribute('role', 'presentation');
    this.overlay.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
    }
  }

  start(): void {
    if (!this.ctx || this.running) return;
    this.running = true;
    this.readColors();
    this.handleResize();
    this.resizeObserver?.observe(this.overlay);

    if (this.prefersReducedMotion.matches) {
      this.drawStatic();
      return;
    }

    this.lastFrameTime = 0;
    this.rafId = requestAnimationFrame((time) => this.animate(time));
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.resizeObserver?.disconnect();
  }

  private animate(time: number): void {
    if (!this.running) return;
    if (time - this.lastFrameTime >= this.frameIntervalMs) {
      this.drawFrame();
      this.lastFrameTime = time;
    }
    this.rafId = requestAnimationFrame((nextTime) => this.animate(nextTime));
  }

  private readColors(): void {
    const rootStyles = getComputedStyle(document.documentElement);
    this.colors = {
      bg: this.parseColor(rootStyles.getPropertyValue('--bg'), DEFAULT_BG),
      accent: this.parseColor(rootStyles.getPropertyValue('--accent'), DEFAULT_ACCENT),
      muted: this.parseColor(rootStyles.getPropertyValue('--text-muted'), DEFAULT_MUTED),
    };
  }

  private parseColor(value: string, fallback: Rgb): Rgb {
    const trimmed = value.trim();
    if (!trimmed) return fallback;

    if (trimmed.startsWith('#')) {
      const hex = trimmed.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return { r, g, b };
      }
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return { r, g, b };
      }
    }

    const rgbMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgbMatch) {
      return {
        r: Number(rgbMatch[1]),
        g: Number(rgbMatch[2]),
        b: Number(rgbMatch[3]),
      };
    }

    return fallback;
  }

  private handleResize(): void {
    if (!this.ctx) return;
    const rect = this.overlay.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const scale = window.devicePixelRatio || 1;

    this.canvasWidth = width;
    this.canvasHeight = height;
    this.canvas.width = Math.floor(width * scale);
    this.canvas.height = Math.floor(height * scale);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    this.ctx.textBaseline = 'top';
    this.ctx.textAlign = 'left';

    this.charWidth = Math.max(8, Math.ceil(this.ctx.measureText('M').width));
    this.columns = Math.max(1, Math.floor(this.canvasWidth / this.charWidth));
    this.resetDrops();

    if (this.prefersReducedMotion.matches) {
      this.drawStatic();
    } else if (this.running) {
      this.drawFrame();
    }
  }

  private resetDrops(): void {
    const maxRows = Math.max(1, Math.floor(this.canvasHeight / this.fontSize));
    this.drops = Array.from({ length: this.columns }, () => Math.floor(Math.random() * maxRows));
  }

  private drawFrame(): void {
    if (!this.ctx) return;
    this.ctx.fillStyle = this.toRgba(this.colors.bg, this.fadeAlpha);
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    for (let i = 0; i < this.columns; i++) {
      const char = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      const x = i * this.charWidth;
      const y = this.drops[i] * this.fontSize;
      const isBright = Math.random() > 0.92;
      const alpha = isBright ? 0.9 : 0.4;
      this.ctx.fillStyle = this.toRgba(isBright ? this.colors.accent : this.colors.muted, alpha);
      this.ctx.fillText(char, x, y);

      if (y > this.canvasHeight && Math.random() > 0.975) {
        this.drops[i] = 0;
      } else {
        this.drops[i] += 1;
      }
    }
  }

  private drawStatic(): void {
    if (!this.ctx) return;
    this.ctx.fillStyle = this.toRgba(this.colors.bg, 1);
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    const rows = Math.max(1, Math.floor(this.canvasHeight / this.fontSize));
    const density = 0.14;

    for (let i = 0; i < this.columns; i++) {
      const count = Math.max(1, Math.floor(rows * density));
      for (let j = 0; j < count; j++) {
        const row = Math.floor(Math.random() * rows);
        const char = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
        const isBright = Math.random() > 0.8;
        const alpha = isBright ? 0.7 : 0.3;
        const x = i * this.charWidth;
        const y = row * this.fontSize;
        this.ctx.fillStyle = this.toRgba(isBright ? this.colors.accent : this.colors.muted, alpha);
        this.ctx.fillText(char, x, y);
      }
    }
  }

  private toRgba(color: Rgb, alpha: number): string {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
  }
}
