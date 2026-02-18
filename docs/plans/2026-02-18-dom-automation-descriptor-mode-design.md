Title: Dom Automation Descriptor Mode (Balanced)
Date: 2026-02-18

Summary
Add a request-level `descriptorMode` option to `dom.automation` so agents can request compact,
LLM-friendly element descriptors without changing selection behavior. Default remains `full`.

Goals
- Allow agents to toggle between full and balanced element descriptors.
- Keep backwards compatibility for existing callers and tests.
- Reduce response size while preserving actionable targeting data.

Non-Goals
- Change selector matching logic.
- Infer accessibility names beyond explicit attributes.
- Add new DOM actions.

Options Considered
1) Request-level `descriptorMode` (selected)
- Backwards compatible and minimal surface change.
2) New action `getInteractables`
- Clean separation but introduces a new tool surface.
3) Replace full descriptor globally
- Simplest but highest risk to existing consumers.

Proposed Design
Add `descriptorMode?: 'full' | 'balanced'` to `DomAutomationRequest` and pass it through the
sidecar to the injected DOM script. When `balanced`, element serialization uses a compact schema.
All element-returning actions (e.g. `query`, `click`, `hover`, `getText` when it returns an element,
and `evaluate` results that include Elements) use the selected mode.

Balanced descriptor schema
- tag
- id
- name
- role
- ariaLabel
- placeholder
- type
- text (short, normalized)
- visible
- href
- src
- value (short)
- state: { disabled, checked, expanded, selected }
- rect (x, y, width, height, top, left, right, bottom, pageX, pageY)

Data Flow
1) Agent calls `dom.automation` with `descriptorMode: "balanced"`.
2) Request is forwarded to the DOM injection script.
3) Script chooses full or balanced serializer based on `descriptorMode`.
4) Results are returned; text compression remains separate.

Error Handling
- Unknown `descriptorMode` falls back to `full`.
- Missing/irrelevant attributes are returned as null.

Impacted Files
- src/automation/domTypes.ts
- src/automation/DomAutomationBridge.ts
- src/automation/domScript.ts
- src/agent/AgentCapabilityRouter.ts
- sidecar/dom/DomAutomation.ts
- sidecar/core/ToolRegistry.ts

Testing
- Update/extend DOM automation tests to verify balanced output fields.
- Manual sanity: run `query` with `descriptorMode: "balanced"` and verify schema.
