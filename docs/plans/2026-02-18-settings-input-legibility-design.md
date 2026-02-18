---
title: "Settings Input Legibility"
date: "2026-02-18"
status: "approved"
---

# Settings Input Legibility

## Problem
Text inside Settings inputs and dropdowns (both placeholder and selected values) is not legible, especially in the dark theme.

## Goals
- Improve readability of input and dropdown text in the Settings panel.
- Ensure placeholders and selected values are legible in both light and dark schemes.
- Keep the change scoped to Settings to avoid unintended effects elsewhere.

## Non-Goals
- Redesign the overall Settings layout.
- Change shared control behavior outside Settings.
- Introduce any new runtime logic or data changes.

## Approach
Introduce Settings-scoped control color tokens and apply them to the Settings control styles:
- Add variables such as `--settings-control-bg`, `--settings-control-text`, and `--settings-control-placeholder`.
- Apply these tokens to `.settings-panel .control`, `.settings-panel .control-field`, `.settings-panel .control-caret`.
- Explicitly style placeholders for `.settings-input`, `.settings-select`, and `.settings-textarea`.
- Provide dark-scheme overrides for these tokens under the existing `prefers-color-scheme: dark` block.

This keeps the fix local to Settings while matching the rest of the panel's theme.

## Testing
- Manual check in Settings: verify placeholder and selected values are legible in light and dark modes.
- If any existing UI tests assert styles, update snapshots or expectations as needed.

