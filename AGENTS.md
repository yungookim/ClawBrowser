# AGENTS

This file provides working guidance for AI agents contributing to ClawBrowser.

## Quick Commands
- `npm run dev` - Run the full Tauri app in dev mode.
- `npm run dev:frontend` - Run the Vite frontend only.
- `npm run build` - Build sidecar and Tauri app.
- `npm run build:sidecar` - Build the sidecar TypeScript.
- `npm run test` - Run the test suite.

## Repo Map
- `src/` - Frontend UI and app logic.
- `sidecar/` - Sidecar process code.
- `src-tauri/` - Tauri backend configuration and Rust glue.
- `docs/` - Plans and documentation.
- `tests/` - Test suite.

## Current Plans
- Active project plans live under `docs/plans/` (see README for links).

## Design Philosophy
- **No rounded corners.** All UI elements must use square corners (`border-radius: 0`). Never use `border-radius` with a non-zero value. The CSS variables `--radius` and `--radius-sm` are set to `0` and must stay that way. Do not introduce hardcoded `border-radius` values.

## Architecture
The correct architecture is an agentic loop:
1. **Understand** — Parse the user's intent; ask clarifying questions if ambiguous
2. **Generate** — Produce the full UI code (not a DSL mapped to fixed component renderers)
3. **Connect** — Wire the generated UI to real APIs using the capability map
4. **QA** — A review agent evaluates the generated view and provides feedback
5. **Iterate** — The generation agent incorporates feedback and re-generates until satisfactory
