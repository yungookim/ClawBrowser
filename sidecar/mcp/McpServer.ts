import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import { URL } from 'node:url';
import { DebugStore } from '../core/DebugStore.js';
import { DailyLog } from '../memory/DailyLog.js';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: number | string | null;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | string | null;
};

export class McpServer {
  private server: http.Server | null = null;
  private debugStore: DebugStore;
  private dailyLog: DailyLog;

  constructor(debugStore: DebugStore, dailyLog: DailyLog) {
    this.debugStore = debugStore;
    this.dailyLog = dailyLog;
  }

  start(port: number): void {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('Missing URL');
        return;
      }

      if (req.method === 'GET' && req.url.startsWith('/health')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'POST' && req.url.startsWith('/mcp')) {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          let payload: JsonRpcRequest;
          try {
            payload = JSON.parse(body) as JsonRpcRequest;
          } catch (err) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
            return;
          }

          const response = await this.handleRpc(payload);
          if (payload.id === undefined || payload.id === null) {
            res.writeHead(204);
            res.end();
            return;
          }
          res.writeHead(response.error ? 500 : 200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(response));
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    this.server.listen(port, '127.0.0.1', () => {
      console.error(`[mcp] server listening on http://127.0.0.1:${port}/mcp`);
    });

    this.server.on('error', (err) => {
      console.error('[mcp] server error:', err);
    });
  }

  private async handleRpc(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = request.id ?? null;
    const method = request.method;
    const params = request.params || {};

    try {
      switch (method) {
        case 'initialize':
          return this.ok(id, {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'clawbrowser-debug', version: '0.1.0' },
            capabilities: {
              resources: { subscribe: false },
              tools: { listChanged: false },
            },
          });
        case 'resources/list':
          return this.ok(id, await this.listResources());
        case 'resources/read':
          return this.ok(id, await this.readResource(params));
        case 'tools/list':
          return this.ok(id, { tools: [] });
        case 'tools/call':
          return this.ok(id, {
            content: [{ type: 'text', text: 'No tools available.' }],
            isError: true,
          });
        case 'prompts/list':
          return this.ok(id, { prompts: [] });
        case 'ping':
          return this.ok(id, { ok: true });
        default:
          return this.err(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.err(id, -32000, message);
    }
  }

  private async listResources(): Promise<{ resources: Array<Record<string, unknown>> }> {
    const resources: Array<Record<string, unknown>> = [];
    const logs = await this.dailyLog.listLogs();
    resources.push({
      uri: 'claw://logs',
      name: 'Logs Index',
      mimeType: 'application/json',
      description: 'Available daily log dates.',
    });
    logs.forEach((date) => {
      resources.push({
        uri: `claw://logs/${date}`,
        name: `Log ${date}`,
        mimeType: 'text/markdown',
        description: `Daily log for ${date}.`,
      });
    });

    resources.push({
      uri: 'claw://debug/events',
      name: 'Debug Events',
      mimeType: 'application/json',
      description: 'Recent debug events (console, render, errors).',
    });
    resources.push({
      uri: 'claw://debug/renders',
      name: 'Latest Renders',
      mimeType: 'application/json',
      description: 'Latest render snapshot per tab.',
    });
    resources.push({
      uri: 'claw://debug/screenshots',
      name: 'Latest Screenshots',
      mimeType: 'application/json',
      description: 'Latest screenshot metadata per tab.',
    });

    const screenshots = this.debugStore.getLatestScreenshots();
    Object.entries(screenshots).forEach(([tabId, entry]) => {
      resources.push({
        uri: `claw://debug/screenshots/${tabId}`,
        name: `Screenshot ${tabId}`,
        mimeType: entry.mime,
        description: `Latest screenshot for tab ${tabId}.`,
      });
    });

    resources.push({
      uri: 'claw://debug/tabs',
      name: 'Known Tabs',
      mimeType: 'application/json',
      description: 'Tab IDs seen in debug events.',
    });

    return { resources };
  }

  private async readResource(params: Record<string, unknown>): Promise<{ contents: Array<Record<string, unknown>> }> {
    const uri = String(params.uri || '');
    if (!uri) {
      throw new Error('Missing uri');
    }

    const parsed = new URL(uri);
    const host = parsed.hostname;
    const path = parsed.pathname || '/';

    if (host === 'logs') {
      if (path === '/' || path === '') {
        const logs = await this.dailyLog.listLogs();
        return this.text(uri, JSON.stringify({ logs }, null, 2), 'application/json');
      }
      const date = path.replace(/^\//, '');
      const content = await this.dailyLog.readDate(date);
      return this.text(uri, content || '', 'text/markdown');
    }

    if (host === 'debug') {
      if (path === '/events') {
        const limit = Number(parsed.searchParams.get('limit') || '200');
        const events = this.debugStore.getEvents(Number.isFinite(limit) ? limit : 200);
        return this.text(uri, JSON.stringify({ events }, null, 2), 'application/json');
      }
      if (path === '/renders') {
        const renders = this.debugStore.getLatestRenders();
        return this.text(uri, JSON.stringify({ renders }, null, 2), 'application/json');
      }
      if (path === '/screenshots') {
        const screenshots = this.debugStore.getLatestScreenshots();
        return this.text(uri, JSON.stringify({ screenshots }, null, 2), 'application/json');
      }
      if (path.startsWith('/screenshots/')) {
        const tabId = path.replace('/screenshots/', '');
        const entry = this.debugStore.getScreenshot(tabId);
        if (!entry) {
          throw new Error(`No screenshot for tab ${tabId}`);
        }
        const data = await fs.readFile(entry.path);
        return this.blob(uri, data.toString('base64'), entry.mime);
      }
      if (path === '/tabs') {
        const tabs = this.debugStore.getTabIds();
        return this.text(uri, JSON.stringify({ tabs }, null, 2), 'application/json');
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  }

  private ok(id: number | string | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private err(id: number | string | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  private text(uri: string, text: string, mimeType: string): { contents: Array<Record<string, unknown>> } {
    return { contents: [{ uri, mimeType, text }] };
  }

  private blob(uri: string, base64: string, mimeType: string): { contents: Array<Record<string, unknown>> } {
    return { contents: [{ uri, mimeType, blob: base64 }] };
  }
}
