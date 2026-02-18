import * as readline from 'node:readline';
import * as path from 'node:path';
import { ModelManager, type Provider, type ModelRole } from './core/ModelManager.js';
import { AgentCore } from './core/AgentCore.js';
import { Swarm } from './core/Swarm.js';
import { WorkspaceFiles } from './memory/WorkspaceFiles.js';
import { DailyLog } from './memory/DailyLog.js';
import { QmdMemory } from './memory/QmdMemory.js';
import { Heartbeat } from './cron/Heartbeat.js';
import { Reflection } from './cron/Reflection.js';

// JSON-RPC 2.0 types
interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: number | string;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | string | null;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// Method handlers
type Handler = (params: Record<string, unknown>) => Promise<unknown>;

const startTime = Date.now();
const handlers = new Map<string, Handler>();

// Subsystem instances (initialized in boot())
let modelManager: ModelManager;
let agentCore: AgentCore;
let swarm: Swarm;
let workspace: WorkspaceFiles;
let dailyLog: DailyLog;
let qmdMemory: QmdMemory;
let heartbeat: Heartbeat;
let reflection: Reflection;

// Send a JSON-RPC notification (no id, fire-and-forget)
function sendNotification(method: string, params?: Record<string, unknown>): void {
  const notification: JsonRpcNotification = {
    jsonrpc: '2.0',
    method,
    params,
  };
  process.stdout.write(JSON.stringify(notification) + '\n');
}

// Send a JSON-RPC response
function sendResponse(id: number | string | null, result: unknown): void {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    result,
    id,
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

// Send a JSON-RPC error response
function sendError(id: number | string | null, code: number, message: string): void {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    error: { code, message },
    id,
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

/** Initialize all subsystems. */
async function boot(): Promise<void> {
  console.error('[sidecar] Booting subsystems...');

  // Core
  modelManager = new ModelManager();
  agentCore = new AgentCore(modelManager);
  swarm = new Swarm(modelManager);

  // Memory
  workspace = new WorkspaceFiles();
  await workspace.initialize();
  dailyLog = new DailyLog();
  await dailyLog.initialize();

  qmdMemory = new QmdMemory();
  try {
    await qmdMemory.initialize();
  } catch (err) {
    console.error('[sidecar] qmd initialization failed (non-fatal):', err);
  }

  // Cron
  heartbeat = new Heartbeat(workspace);
  heartbeat.start();

  reflection = new Reflection(workspace, dailyLog, modelManager);
  reflection.setMemoryHandler(async (memories) => {
    for (const mem of memories) {
      await qmdMemory.addDocument(mem.id, mem.content, { title: mem.tags.join(', ') });
    }
  });
  reflection.start();

  console.error('[sidecar] All subsystems booted');
}

/** Register all JSON-RPC method handlers. */
function registerHandlers(): void {
  handlers.set('ping', async () => ({
    pong: true,
    uptime: Date.now() - startTime,
  }));

  handlers.set('agentQuery', async (params) => {
    const userQuery = params.userQuery as string || '';
    const activeTabUrl = params.activeTabUrl as string | undefined;
    const activeTabTitle = params.activeTabTitle as string | undefined;
    const tabCount = params.tabCount as number | undefined;

    // Log the query
    await dailyLog.log(`User query: ${userQuery}`);

    // Load workspace files for context
    const workspaceFiles = await workspace.loadAll();

    // Query the agent
    const response = await agentCore.query({
      userQuery,
      activeTabUrl,
      activeTabTitle,
      tabCount,
      workspaceFiles,
    });

    // Log the response
    await dailyLog.log(`Agent reply: ${response.reply.substring(0, 100)}...`);

    return response;
  });

  handlers.set('swarmExecute', async (params) => {
    const task = params.task as string || '';
    const context = params.context as Record<string, string> | undefined;

    await dailyLog.log(`Swarm task: ${task}`);
    const result = await swarm.execute(task, context);
    await dailyLog.log(`Swarm result: ${result.substring(0, 100)}...`);

    return { result };
  });

  handlers.set('configureModel', async (params) => {
    const provider = params.provider as Provider;
    const model = params.model as string;
    const apiKey = params.apiKey as string | undefined;
    const baseUrl = params.baseUrl as string | undefined;
    const primary = params.primary as boolean ?? true;
    const role: ModelRole = primary ? 'primary' : 'subagent';

    modelManager.configure({
      provider,
      model,
      apiKey,
      baseUrl,
      role,
    });

    return { status: 'ok' };
  });

  handlers.set('tabUpdate', async (params) => {
    const tabCount = params.tabCount as number || 0;
    const activeTabTitle = params.activeTabTitle as string || '';

    heartbeat.updateTabState(tabCount, activeTabTitle);
    heartbeat.updateContext(activeTabTitle ? `browsing: ${activeTabTitle}` : 'idle');

    return { status: 'ok' };
  });

  handlers.set('triggerReflection', async () => {
    const result = await reflection.reflect();
    return {
      status: 'ok',
      summary: result?.summary || 'No reflection produced',
      memoriesAdded: result?.memories?.length || 0,
    };
  });

  handlers.set('getMemory', async (params) => {
    const query = params.query as string | undefined;
    const files = await workspace.loadAll();

    let memories: Array<{ id: string; content: string; title: string; score?: number }> = [];
    if (query) {
      memories = qmdMemory.search(query, 10);
    }

    return { files, memories };
  });

  handlers.set('clearHistory', async () => {
    agentCore.clearHistory();
    return { status: 'ok' };
  });

  handlers.set('getStatus', async () => {
    return {
      uptime: Date.now() - startTime,
      heartbeat: heartbeat.getState(),
      modelsConfigured: modelManager.listConfigs().length,
      historyLength: agentCore.getHistoryLength(),
    };
  });
}

// Process a single JSON-RPC request
async function processRequest(request: JsonRpcRequest): Promise<void> {
  const { method, params, id } = request;

  // If no id, it's a notification from the host -- no response needed
  if (id === undefined || id === null) {
    const handler = handlers.get(method);
    if (handler) {
      try {
        await handler(params || {});
      } catch (err) {
        console.error(`[sidecar] Notification handler error for ${method}:`, err);
      }
    }
    return;
  }

  const handler = handlers.get(method);
  if (!handler) {
    sendError(id, -32601, `Method not found: ${method}`);
    return;
  }

  try {
    const result = await handler(params || {});
    sendResponse(id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(id, -32000, message);
  }
}

// Main: boot subsystems, register handlers, read stdin
async function main(): Promise<void> {
  registerHandlers();

  try {
    await boot();
  } catch (err) {
    console.error('[sidecar] Boot failed:', err);
    // Continue anyway with degraded functionality
  }

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  // Announce readiness
  sendNotification('agentReady', { version: '0.1.0' });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const request = JSON.parse(trimmed) as JsonRpcRequest;
      if (request.jsonrpc !== '2.0') {
        console.error('[sidecar] Invalid JSON-RPC version:', trimmed);
        return;
      }
      await processRequest(request);
    } catch (err) {
      console.error('[sidecar] Failed to parse JSON-RPC:', trimmed, err);
    }
  });

  rl.on('close', () => {
    console.error('[sidecar] stdin closed, shutting down');
    heartbeat.stop();
    reflection.stop();
    qmdMemory.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[sidecar] SIGTERM received, shutting down');
    heartbeat.stop();
    reflection.stop();
    qmdMemory.close();
    process.exit(0);
  });
}

// Export for use by other modules
export { handlers, sendNotification, sendResponse, sendError };
export type { Handler, JsonRpcRequest, JsonRpcResponse };

main();
