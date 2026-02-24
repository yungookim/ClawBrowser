# Agent Panel Matrix Watermark Design

Date: 2026-02-24

## Goal
Add centered background text behind the agent panel's matrix background: two lines reading "CLAWBROWSER" and "THE SMARTEST CHILD OF OPENCLAW." The text should be a subtle mono watermark and remain visible in reduced-motion mode.

## Architecture
Extend the `MatrixBackground` canvas renderer to optionally draw a watermark inside the canvas. The draw order will be background fill, watermark, then matrix glyphs so the text sits visually behind the glyphs. The watermark will be configured only for the agent panel instance.

## Components
- `src/ui/MatrixBackground.ts`: accept optional watermark configuration and render it in `drawFrame()` and `drawStatic()`.
- `src/main.ts`: pass the watermark configuration to the `MatrixBackground` instance for `#agent-panel`.

## Data Flow
- `MatrixBackground.start()` reads colors and sizes the canvas.
- `drawFrame()` and `drawStatic()` render the watermark (low opacity, centered, two lines), then render the matrix glyphs.
- Reduced-motion mode uses `drawStatic()` so the watermark remains visible.

## Error Handling
- If the canvas context is unavailable, rendering no-ops; the watermark simply does not appear.
- If sizing is zero, the existing minimum sizing guards prevent errors.

## Testing
- Manual: run the app and verify the centered watermark appears behind the matrix glyphs in the agent panel.
- Manual: enable reduced-motion and verify the static matrix render still includes the watermark.
