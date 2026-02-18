# Agent Panel Fixed-Open Design

## Overview
Remove the AI model selector from the main agent panel and remove the "Agent" button in the URL bar. The agent panel and tab panel become permanently open in the main screen layout. Model selection remains only in Settings.

## Goals
- Remove the model selector UI from the main agent panel.
- Remove the "Agent" toggle button beside the URL bar.
- Keep agent panel and tab panel always visible (no open/close toggle).
- Keep Settings as the only place to change model routing.

## Non-Goals
- Changing model routing logic or provider data.
- Redesigning Settings or onboarding flows.
- Adding new shortcuts or menu items.

## Current Behavior (Summary)
- The main agent panel contains a model selector dropdown.
- The nav bar contains an "Agent" button that toggles the agent panel.
- The agent panel open state is managed in main layout code.

## Proposed Changes
- **ChatView**: Remove the model selector header UI entirely.
- **NavBar**: Remove the "Agent" button and any wiring to toggle the agent panel.
- **Main layout**: Remove toggle state for agent panel and tab panel, keep them permanently open.
- **CSS/layout**: Ensure grid widths assume both panels are always present.

## Data Flow & State
- No model selection state in main screen UI.
- Agent panel open state is static; no events or toggles.
- Tab panel open state is static.

## UX Notes
- Main screen is simplified: agent panel is always visible and non-configurable.
- Model configuration happens only in Settings.

## Testing
- Update frontend tests to assert:
  - Model selector is absent in the main agent panel.
  - "Agent" button is absent in the nav bar.
  - Agent panel and tabs are present in the layout.

## Rollout
- Low risk UI change; no data migration.
