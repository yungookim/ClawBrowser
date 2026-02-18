# Available Tools

## Tab Control

- `create_tab(url)` — Open a new tab with the given URL
- `close_tab(tabId)` — Close a tab
- `switch_tab(tabId)` — Switch to a tab
- `navigate_tab(tabId, url)` — Navigate a tab to a URL
- `list_tabs()` — Get all open tabs
- `get_active_tab()` — Get the current active tab ID

## DOM Interaction

- `run_js_in_tab(tabId, code)` — Execute JavaScript in a tab's webview

## Memory

- `workspace.read(filename)` — Read a workspace file
- `workspace.write(filename, content)` — Write a workspace file
- `workspace.append(filename, content)` — Append to a workspace file
- `memory.search(query, topK)` — Semantic search over indexed memories
- `memory.add(id, content, metadata)` — Add a memory entry
- `dailyLog.log(entry)` — Log an entry to today's daily log

## Model

- `configureModel(provider, model, apiKey, primary)` — Set up a model provider
