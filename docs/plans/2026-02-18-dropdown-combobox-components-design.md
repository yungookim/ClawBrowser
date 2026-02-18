# Dropdown + Combobox Components Design

Date: 2026-02-18
Status: DRAFT

## Goals
- Introduce reusable Dropdown and Combobox components that wrap native controls.
- Improve visual styling for selects/comboboxes across the app.
- Use components everywhere selects/comboboxes appear.

## Non-Goals
- Replace native controls with fully custom menus.
- Change underlying form behavior or validation logic.

## Component Structure
### Dropdown
- Wrapper around `<select>`.
- API: `setOptions`, `setValue`, `getValue`, `onChange`, `setDisabled`, `setRequired`.
- Supports `aria-*` and className passthrough.

### Combobox
- Wrapper around `<input list>` + `<datalist>`.
- API: `setOptions`, `setValue`, `getValue`, `onInput`, `setDisabled`, `setRequired`.
- Allows free-form typing even if not in options.

## Styling Direction
- Shared controls stylesheet with consistent sizing, padding, and border treatment.
- Subtle inset highlight + crisp border; accent border on focus.
- Custom caret for dropdowns.
- Light hover transitions; no heavy gradients.

## Usage Plan
- Onboarding: provider select → Dropdown; model input → Combobox.
- Settings: provider select → Dropdown; role select → Dropdown; model input → Combobox.
- Agent panel: keep current behavior, reskin to match shared control styles.

## Tests
- Update onboarding/settings tests to reflect component DOM wrappers.
- Add minimal unit coverage for component option rendering and value retrieval.

## Risks
- Styling drift between components and existing agent panel UI; mitigate with shared tokens.
