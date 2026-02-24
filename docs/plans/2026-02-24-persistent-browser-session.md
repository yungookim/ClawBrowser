# Persistent Browser Session Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a nav bar button that opens a persistent Stagehand browser session so logins survive restarts.

**Architecture:** Wire a new `browserOpen` JSON-RPC method from the frontend to the sidecar. Stagehand launches with a single shared `userDataDir` (persisted on disk), and `openSession()` opens a blank tab for manual login.

**Tech Stack:** Tauri + TypeScript frontend, Node sidecar, Stagehand (Playwright), Vitest.

---

### Task 1: Persist Stagehand profile + openSession

**Files:**
- Modify: `sidecar/dom/StagehandBridge.ts`
- Modify: `tests/sidecar/stagehand-bridge.test.ts`

**Step 1: Write the failing test**

Add tests that assert:
- `localBrowserLaunchOptions.userDataDir` is set to `<workspace>/browser-profile/default` when `workspacePath` is configured.
- `localBrowserLaunchOptions.preserveUserDataDir` is `true`.
- `openSession()` opens a new page (calls `context.newPage()` and `page.goto('about:blank')`).

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ...inside tests
it('configures a persistent userDataDir', async () => {
  const workspacePath = '/tmp/clawbrowser-workspace';
  const bridge = new StagehandBridge(new ModelManager(), makeConfigStore({}, workspacePath), {
    createStagehand: stagehandMocks.createStagehand,
  });

  await bridge.act('do');

  const options = stagehandMocks.createStagehand.mock.calls[0][0];
  expect(options.localBrowserLaunchOptions?.userDataDir)
    .toBe(path.join(workspacePath, 'browser-profile', 'default'));
  expect(options.localBrowserLaunchOptions?.preserveUserDataDir).toBe(true);
});

it('opens a session tab', async () => {
  const bridge = new StagehandBridge(new ModelManager(), makeConfigStore(), {
    createStagehand: stagehandMocks.createStagehand,
  });

  await bridge.openSession();

  expect(stagehandMocks.context?.newPage).toHaveBeenCalled();
  expect(stagehandMocks.page?.goto).toHaveBeenCalledWith('about:blank');
});
```

Mock `fs.mkdir` to avoid touching disk:
```ts
const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined as never);
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sidecar/stagehand-bridge.test.ts --config vitest.config.ts`
Expected: FAIL with missing `openSession()` and missing `userDataDir` assertions.

**Step 3: Write minimal implementation**

- In `StagehandBridge`, add a helper that resolves a persistent profile path:
  - If `configStore.get().workspacePath` is set, use `<workspacePath>/browser-profile/default`.
  - Otherwise use `~/.clawbrowser/workspace/browser-profile/default`.
  - `await fs.mkdir(profileDir, { recursive: true })`.
- Pass `userDataDir` + `preserveUserDataDir: true` to `localBrowserLaunchOptions` during init.
- Add `openSession()` that ensures Stagehand is initialized and opens a new page to `about:blank`.

```ts
async openSession(): Promise<void> {
  const stagehand = await this.ensureHealthy();
  await this.openNewTab(stagehand, 'about:blank');
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sidecar/stagehand-bridge.test.ts --config vitest.config.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add sidecar/dom/StagehandBridge.ts tests/sidecar/stagehand-bridge.test.ts
git commit -m "feat: persist Stagehand session profile"
```

---

### Task 2: Wire browserOpen RPC + UI button

**Files:**
- Modify: `sidecar/main.ts`
- Modify: `src/agent/SidecarBridge.ts`
- Modify: `src/navigation/NavBar.ts`
- Modify: `src/main.ts`

**Step 1: Write the failing test**

No existing frontend test harness for NavBar RPC wiring. Skip automated test; rely on manual verification in Task 3.

**Step 2: Implement minimal wiring**

- `sidecar/main.ts`: add `handlers.set('browserOpen', ...)` that calls `stagehandBridge.openSession()` and returns `{ status: 'ok' }`.
- `src/agent/SidecarBridge.ts`: add `browserOpen()` that sends `browserOpen`.
- `src/navigation/NavBar.ts`: add `Open Session` button and `onOpenSession` callback in options.
- `src/main.ts`: pass `onOpenSession` callback and optionally disable button while opening.

**Step 3: Manual quick check**

Start the app and click `Open Session`; ensure a browser window opens.

**Step 4: Commit**

```bash
git add sidecar/main.ts src/agent/SidecarBridge.ts src/navigation/NavBar.ts src/main.ts
git commit -m "feat: add Open Session button"
```

---

### Task 3: Manual persistence verification

**Files:**
- None (manual test)

**Step 1: Manual test**

1. Run `npm run dev`.
2. Click `Open Session`.
3. Log in to a web service.
4. Quit and restart ClawBrowser.
5. Click `Open Session` again and verify you remain logged in.

**Step 2: Record results**

Note any failures or required tweaks (profile path, permissions, etc.).

