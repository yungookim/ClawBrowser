# ClawBrowser Security Hardening Plan (2026-02-18)

**Goal:** Add concrete, defense-in-depth security layers to make ClawBrowser very secure without blocking core functionality.

**Scope:** Tauri (Rust), chrome webview (TS), sidecar (Node), storage, update pipeline.

**Principles:**
- Least privilege for every IPC and system capability
- Explicit user consent for sensitive actions
- Encrypt sensitive data at rest and minimize data in memory
- Reduce attack surface in chrome webview and sidecar
- Signed builds and verified updates

---

## Phase S1: IPC and Capability Security

### Task S1.1: Tauri Capabilities + Command Allowlist
**Files:**
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/ipc.rs`

**Plan:**
- Define per-command capabilities (tab control, vault access, sidecar messaging) and restrict invocation to chrome webview only.
- Add a strict allowlist for IPC commands; reject unknowns with explicit error.
- Deny all IPC from content webviews.

**Acceptance:**
- Content webviews cannot invoke privileged commands.
- Attempted unauthorized calls return `AccessDenied` errors.

---

### Task S1.2: Sidecar Handshake + Session Token
**Files:**
- Modify: `src-tauri/src/sidecar.rs`
- Modify: `sidecar/main.ts`

**Plan:**
- Rust generates a per-session random token and passes it to the sidecar on launch.
- All JSON-RPC calls to/from sidecar must include the token.
- Reject any message without a valid token.

**Acceptance:**
- Sidecar only accepts messages with a valid token.
- Token rotates each app launch.

---

### Task S1.3: IPC Message Validation and Rate Limits
**Files:**
- Modify: `sidecar/main.ts`

**Plan:**
- Enforce max message size (e.g. 256KB).
- Validate JSON-RPC schema per method.
- Apply per-method rate limits to prevent flooding.

**Acceptance:**
- Oversized or malformed messages are rejected.
- Flooding tests show throttling.

---

## Phase S2: Chrome Webview Hardening

### Task S2.1: Strict CSP for Chrome Webview
**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Plan:**
- Add strict CSP that disallows remote scripts, inline scripts, and remote frames.
- Dev builds can relax CSP behind `TAURI_DEBUG` only.

**Acceptance:**
- Chrome UI loads without CSP violations.
- Remote script injection attempts are blocked.

---

### Task S2.2: Prevent Chrome Webview Navigation
**Files:**
- Modify: `src-tauri/src/lib.rs`

**Plan:**
- Block navigation away from local chrome UI (no remote URLs).
- If navigation is attempted, reset to home UI and log a warning.

**Acceptance:**
- Chrome webview cannot be navigated to arbitrary URLs.

---

### Task S2.3: DOM Injection Gate + Per-Origin Permissions
**Files:**
- Modify: `src-tauri/src/ipc.rs`
- Modify: `src/tabs/TabManager.ts`
- Create: `src/security/Permissions.ts`
- Create: `src/styles/permissions.css`

**Plan:**
- Add a permission system for DOM injection and automation.
- Require explicit user approval per origin for `run_js_in_tab`.
- Show visible indicator when automation is active.

**Acceptance:**
- Injection fails unless user granted permission for origin.
- Indicator appears while automation is active.

---

## Phase S3: Vault and Data-at-Rest Security

### Task S3.1: Encrypt Workspace and Logs
**Files:**
- Modify: `sidecar/memory/WorkspaceFiles.ts`
- Modify: `sidecar/memory/DailyLog.ts`
- Modify: `sidecar/memory/QmdMemory.ts`

**Plan:**
- Encrypt sensitive workspace files and logs with vault key.
- Separate non-sensitive metadata into a minimal plaintext index.
- Ensure qmd index is encrypted or stored inside an encrypted container.

**Acceptance:**
- Workspace files and logs are unreadable without vault unlock.

---

### Task S3.2: Stronger KDF + Key Handling
**Files:**
- Modify: `src/vault/Vault.ts`

**Plan:**
- Replace PBKDF2 with Argon2id or scrypt (configurable).
- Zeroize key material on lock and after use.
- Optional OS keychain integration for unlock convenience.

**Acceptance:**
- KDF is memory-hard and configurable.
- Keys are cleared on lock.

---

### Task S3.3: Sensitive Logging Redaction
**Files:**
- Modify: `sidecar/main.ts`
- Modify: `sidecar/memory/DailyLog.ts`

**Plan:**
- Add automatic redaction for API keys, tokens, passwords, and emails.
- Default to logging only structured metadata unless user opts in.

**Acceptance:**
- Redaction tests confirm secrets never hit disk.

---

## Phase S4: Model and Data Egress Controls

### Task S4.1: Provider Policy + Local-Only Mode
**Files:**
- Modify: `sidecar/core/ModelManager.ts`
- Modify: `src/onboarding/Wizard.ts`

**Plan:**
- Add a policy layer: local-only mode, per-provider allowlist, per-category restrictions.
- Require explicit user consent before sending sensitive data to remote models.

**Acceptance:**
- Remote providers cannot access sensitive categories without opt-in.

---

### Task S4.2: Cross-Origin Data Boundary
**Files:**
- Modify: `sidecar/core/AgentCore.ts`
- Modify: `src/agent/AgentPanel.ts`

**Plan:**
- Track active origin and prevent transferring content across origins without approval.
- Surface a consent dialog when crossing origin boundaries.

**Acceptance:**
- Cross-origin data transfer is blocked by default.

---

## Phase S5: Update and Supply-Chain Security

### Task S5.1: Signed Updates + Verification
**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `package.json`

**Plan:**
- Require signed updates and verification before install.
- Add CI step to sign artifacts.

**Acceptance:**
- Unsigned update artifacts are rejected.

---

### Task S5.2: Build Integrity and Dependency Guardrails
**Files:**
- Modify: `package.json`
- Create: `scripts/security-check.sh`

**Plan:**
- Add `npm audit` (or equivalent) and license checks.
- Pin critical dependencies and fail on high/critical vulnerabilities.

**Acceptance:**
- CI fails if critical vulnerabilities are detected.

---

## Phase S6: Permissions and UX Safeguards

### Task S6.1: Permission Prompts for Sensitive Actions
**Files:**
- Create: `src/security/PermissionPrompts.ts`
- Modify: `src/agent/AgentPanel.ts`
- Modify: `src/voice/VoiceInput.ts`

**Plan:**
- Prompt for clipboard read/write, microphone, file access, and DOM automation.
- Permissions are per-origin and revocable.

**Acceptance:**
- Sensitive actions are blocked without consent.

---

### Task S6.2: Safe Download and File Access
**Files:**
- Modify: `src-tauri/src/ipc.rs`

**Plan:**
- Add a safe download location and confirm downloads.
- Restrict file read/write to user-approved directories.

**Acceptance:**
- File access outside approved dirs is blocked.

---

## Deliverables
- A hardened IPC and capability layer
- Strict chrome webview CSP and navigation locks
- Encrypted data-at-rest for workspace, logs, and memory
- Consent-driven DOM injection and cross-origin boundaries
- Verified updates and supply-chain guardrails
- End-user permission UX for sensitive operations

## Notes
- This plan assumes existing tasks from `docs/plans/2026-02-17-clawbrowser-full-implementation.md` are completed or in progress.
- All new security prompts should be designed to minimize user fatigue while preserving safety.
