# Disable Webview Automation (Stagehand-Only)

Date: 2026-02-24

**Goal**
Disable all webview/DOM automation and remove in-app browsing UI, leaving Stagehand as the only automation path. This is intended to stop repeated DOM automation timeouts and replan loops, and to simplify the automation model.

**Non-Goals**
- Do not change Stagehand behavior or provider configuration.
- Do not add new automation capabilities.
- Do not remove core app settings, logs, or onboarding flows unrelated to browsing UI.

**Approach**
Stagehand-only mode. The app will not create or manage content webviews for browsing, and no DOM or webview-based automation tools will be exposed. Any request to use those tools should return a clear “disabled” error immediately.

**Architecture**
- Sidecar exposes only Stagehand for `browser.*` calls.
- All DOM/webview automation tools are unregistered or guarded so they cannot be invoked.
- Frontend does not start DOM automation bridges or routers.
- Tabs UI and any browsing surfaces are removed or hidden from normal flows.

**Components**
- Sidecar: `sidecar/dom/BrowserAutomationRouter.ts` only instantiates Stagehand provider. Webview provider is not available. Any fallback to webview returns a disabled error without retry loops.
- Sidecar: `sidecar/main.ts` does not construct `WebviewProvider` or wire DOM automation into the router.
- Sidecar: `sidecar/core/ToolRegistry.ts` removes or gates `dom.automation`, `tab.*`, `nav.*`, and any webview-only tools.
- Frontend: `src/main.ts` does not create `DomAutomationBridge` or `SidecarAutomationRouter`.
- Frontend: `src/agent/AgentCapabilityRouter.ts` removes `dom` capability handling and any tab/nav automation wiring.
- Frontend: Tabs UI is hidden or removed, including entry points that create or control content webviews.
- Tauri: keep base window/webview infrastructure, but do not create child webviews for tabs.

**Data Flow**
- `browser.*` tool calls are handled by Stagehand only.
- Any attempt to use `dom.automation`, `tab.*`, `nav.*`, or related webview tools returns a hard failure indicating Stagehand-only mode.

**Error Handling**
- Use a single, clear error string for disabled webview paths, for example:
  `Webview automation disabled (Stagehand-only mode).`
- Avoid retries or replans when a disabled tool is invoked.

**User Experience**
- Remove in-app browsing surfaces from the UI.
- Settings or onboarding entries related to webview automation are hidden or marked as unavailable.

**Testing**
- `npm run test`
- Add unit coverage if available: `dom.automation` not registered in tool registry.
- Add unit coverage if available: `BrowserAutomationRouter` refuses webview fallback.
- Manual smoke: app launches without tabs UI.
- Manual smoke: Stagehand automation still operates.

**Risks**
- Features that depend on DOM automation will no longer function.
- Some UI flows may need explicit hiding to prevent dead-end states.

**Rollout**
- Ship as a single change set; Stagehand-only is the new default mode.
