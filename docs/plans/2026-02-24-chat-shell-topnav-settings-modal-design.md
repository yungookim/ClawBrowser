# Chat-Only Shell with Top Nav + Settings Modal

Date: 2026-02-24

**Goal**
Convert the UI to a full-width chat-only interface with a top navigation bar that includes `Open session` and `Settings`. Move Settings into a modal dialog. Apply the Matrix background to the chat surface so it visually fills the app where the webview used to be.

**Non-Goals**
- No changes to sidecar or tool routing logic.
- No changes to chat functionality or agent behavior.
- No new browser automation.

**Approach**
Replace the 3-column layout with a single-column layout. Introduce a top nav bar with `Open session` and `Settings`. Render SettingsPanel inside a modal overlay (backdrop + dialog). Apply Matrix background to the chat section (not the full app).

**Architecture**
- App shell becomes vertical stack: top nav + chat area.
- Chat area is full width and hosts Matrix background.
- SettingsPanel is rendered in a modal dialog overlay, toggled by the top nav.

**Components**
- Top nav component (new or repurposed `NavBar`):
  - `Open session` button triggers the existing open-session behavior.
  - `Settings` button toggles the settings modal.
- Settings modal:
  - Backdrop + dialog.
  - Close on backdrop click and ESC.
- Chat surface:
  - `AgentPanel` expands to full width.
  - Matrix background is rendered within chat container.

**Data Flow**
- User clicks `Settings` → modal opens.
- User clicks `Open session` → open-session action is invoked.
- Chat input and agent message flow unchanged.

**Error Handling**
- Settings errors remain inside SettingsPanel.
- Modal open/close is fail-safe; no runtime errors on missing handler.

**Testing**
- Update frontend tests for:
  - presence of top nav
  - settings modal toggling
  - chat layout (no tabs/webview space)
- No sidecar test changes required.

**Risks**
- Layout regressions from changing app shell grid.
- Modal focus/scroll lock issues.

**Rollout**
- Single change set with layout + modal + top nav.
