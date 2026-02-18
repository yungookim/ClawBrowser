# Matrix ASCII Background Design

Date: 2026-02-18

## Summary
Add a Matrix-style ASCII rain background behind the onboarding wizard and vault lock screens. The animation uses a canvas for smooth rendering, matches app theme colors, and respects `prefers-reduced-motion` by rendering a static frame.

## Goals
- Show an animated ASCII Matrix background behind the onboarding card and the lock screen card.
- Use theme colors (`--bg`, `--accent`, `--text-muted`) instead of fixed green.
- Respect `prefers-reduced-motion` with a static frame.
- Keep overlays and cards fully interactive and readable.

## Non-goals
- Changing onboarding or lock screen copy, layout, or flow.
- Adding new settings to enable/disable the effect.
- Full-screen takeover beyond the existing overlay area.

## Design

### Architecture
- Introduce a small `MatrixBackground` helper that attaches to an overlay element and manages a canvas.
- The helper draws ASCII rain characters to a full-size canvas positioned behind the card.
- The canvas reads CSS variables for colors and font sizes, keeping it aligned with the app theme.

### Components & Integration
- `Wizard` (onboarding): instantiate `MatrixBackground` with the wizard overlay.
- `VaultUI` (locked screen): instantiate `MatrixBackground` with the vault overlay.
- Add a canvas element to each overlay via the helper (not directly in template strings).

### Data Flow
- `show()` calls `background.start()`.
- `hide()` calls `background.stop()`.
- `start()` sizes the canvas to the overlay and begins a `requestAnimationFrame` loop.
- If `prefers-reduced-motion` is enabled, `start()` draws a single frame and skips the loop.

### Styling
- Canvas is `position: absolute`, covers the overlay, and uses `pointer-events: none`.
- Cards remain above the canvas via existing stacking (or explicit `z-index` if needed).

## Error Handling
- If `getContext('2d')` fails, the helper becomes a no-op.
- Resize handling is defensive; if sizing fails, the animation stops quietly.

## Testing Plan (Manual)
1. Launch onboarding: verify animated ASCII background appears behind the card.
2. Lock vault: verify animated ASCII background appears behind the lock card.
3. Toggle `prefers-reduced-motion`: verify a static frame instead of animation.
4. Resize window: background resizes without flicker or overlay issues.

## Open Questions
- None.
