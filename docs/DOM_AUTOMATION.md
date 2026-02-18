# DOM Automation API

ClawBrowser exposes a maximal DOM automation surface through the sidecar JSON-RPC method `domAutomation`.
The sidecar forwards requests to the chrome webview, which injects a helper into the target tab and
executes the requested actions in page context. Results are returned asynchronously.

## Request

```json
{
  "tabId": "optional-tab-id",
  "timeoutMs": 30000,
  "returnMode": "all",
  "actions": [
    { "type": "click", "target": "#login" },
    { "type": "type", "target": { "label": "Email" }, "text": "user@example.com" },
    { "type": "type", "target": { "label": "Password" }, "text": "secret", "pressEnter": true }
  ]
}
```

`returnMode` controls the response payload:

- `all` (default): return all action results
- `last`: return only the final action result
- `none`: return an empty results array

## Selector (target)

The `target` can be a CSS selector string or an object:

```json
{ "css": "#submit" }
{ "selector": "button.primary" }
{ "xpath": "//button[contains(., 'Save')]" }
{ "text": "Continue", "exact": true }
{ "label": "Email" }
{ "role": "button" }
{ "name": "q" }
{ "testId": "checkout" }
{ "placeholder": "Search" }
{ "ariaLabel": "Close" }
{ "id": "main" }
{ "index": 0, "strict": true, "visible": true }
```

## Actions (maximal set)

- `click`: `{ type, target, button?, clickCount?, delayMs? }`
- `dblclick`: `{ type, target, button?, delayMs? }`
- `hover`: `{ type, target }`
- `focus`: `{ type, target }`
- `blur`: `{ type, target }`
- `type`: `{ type, target, text, delayMs?, clear?, pressEnter? }`
- `press`: `{ type, key, target?, modifiers? }`
- `setValue`: `{ type, target, value }`
- `clear`: `{ type, target }`
- `select`: `{ type, target, value?, label?, index? }`
- `submit`: `{ type, target }`
- `check`: `{ type, target, checked? }`
- `scroll`: `{ type, target?, x?, y?, by?, behavior? }`
- `scrollIntoView`: `{ type, target, block?, inline? }`
- `waitFor`: `{ type, target?, state?, timeoutMs? }`
- `waitForText`: `{ type, text, exact?, timeoutMs? }`
- `waitForFunction`: `{ type, script, timeoutMs? }`
- `exists`: `{ type, target }`
- `count`: `{ type, target }`
- `query`: `{ type, target, maxResults? }`
- `getText`: `{ type, target?, trim?, maxLength? }`
- `getHTML`: `{ type, target?, outer?, maxLength? }`
- `getValue`: `{ type, target }`
- `getAttribute`: `{ type, target, name }`
- `getProperty`: `{ type, target, name }`
- `setAttribute`: `{ type, target, name, value }`
- `removeAttribute`: `{ type, target, name }`
- `dispatchEvent`: `{ type, target, event, options? }`
- `getBoundingBox`: `{ type, target }`
- `getPageInfo`: `{ type }`
- `getLinks`: `{ type, target?, maxResults? }`
- `highlight`: `{ type, target, color?, durationMs? }`
- `clearHighlights`: `{ type }`
- `evaluate`: `{ type, script, args?, target? }` (unsafe, runs raw JS)

## Notes

- Actions run sequentially; results are returned per action.
- Cross-origin iframes are not accessible.
- Long text and HTML responses are truncated for safety.
- `evaluate` and `waitForFunction` expect JavaScript source as a function body; use `return` for values.
- If the Tauri JS event bridge is disabled in content webviews, automation will time out (no results can be emitted).
- Automation requests prompt for per-origin permission; "always allow" and "block" are stored locally.
