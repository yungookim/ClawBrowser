import * as readline from 'node:readline';
import * as path from 'node:path';
import { ModelManager, type Provider, type ModelRole } from './core/ModelManager.js';
import { AgentCore } from './core/AgentCore.js';
import { Swarm } from './core/Swarm.js';
import { WorkspaceFiles } from './memory/WorkspaceFiles.js';
import { DailyLog } from './memory/DailyLog.js';
import { SystemLogger, type LogLevel } from './logging/SystemLogger.js';
import { QmdMemory } from './memory/QmdMemory.js';
import { Heartbeat } from './cron/Heartbeat.js';
import { Reflection } from './cron/Reflection.js';
import { DomAutomation, type DomAutomationResult } from './dom/DomAutomation.js';
import { StagehandBridge } from './dom/StagehandBridge.js';
import { BrowserAutomationRouter } from './dom/BrowserAutomationRouter.js';
import { StagehandProvider } from './dom/providers/StagehandProvider.js';
import { WebviewProvider } from './dom/providers/WebviewProvider.js';
import { ConfigStore, type AppConfig, type CommandAllowlistEntry } from './core/ConfigStore.js';
import { CommandExecutor } from './core/CommandExecutor.js';
import { ToolRegistry } from './core/ToolRegistry.js';
import { AgentDispatcher, type AgentResult } from './core/AgentDispatcher.js';

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
const HOSTED_PROVIDERS = new Set<Provider>(['openai', 'anthropic', 'groq']);

function providerRequiresApiKey(provider: Provider): boolean {
  return HOSTED_PROVIDERS.has(provider);
}

function resolveDevLogBaseDir(): string | null {
  const raw = process.env.CLAW_LOG_DIR;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

// Subsystem instances (initialized in boot())
let modelManager: ModelManager;
let agentCore: AgentCore;
let swarm: Swarm;
let workspace: WorkspaceFiles;
let dailyLog: DailyLog;
let systemLogger: SystemLogger;
let qmdMemory: QmdMemory;
let heartbeat: Heartbeat;
let reflection: Reflection;
let domAutomation: DomAutomation;
let stagehandBridge: StagehandBridge | undefined;
let browserAutomationRouter: BrowserAutomationRouter | undefined;
let configStore: ConfigStore;
let appConfig: AppConfig;
let commandExecutor: CommandExecutor;
let toolRegistry: ToolRegistry;
let agentDispatcher: AgentDispatcher;

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

function isDomAutomationResult(value: unknown): value is DomAutomationResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.requestId === 'string'
    && typeof record.ok === 'boolean'
    && Array.isArray(record.results);
}

function isAgentResult(value: unknown): value is AgentResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.requestId === 'string'
    && typeof record.ok === 'boolean';
}

/** Initialize all subsystems. */
async function boot(): Promise<void> {
  const devLogBaseDir = resolveDevLogBaseDir();
  systemLogger = new SystemLogger(devLogBaseDir
    ? { logsDir: path.join(devLogBaseDir, 'system'), minLevel: 'debug' }
    : undefined,
  );
  try {
    await systemLogger.initialize();
    systemLogger.attachConsole();
  } catch (err) {
    console.error('[sidecar] System logger init failed:', err);
  }

  console.error('[sidecar] Booting subsystems...');

  // Core
  modelManager = new ModelManager();
  configStore = new ConfigStore();
  appConfig = await configStore.load();
  stagehandBridge = new StagehandBridge(modelManager, configStore, { systemLogger });
  commandExecutor = new CommandExecutor();
  try {
    commandExecutor.setAllowlist(appConfig.commandAllowlist);
  } catch (err) {
    console.error('[sidecar] Invalid allowlist, disabling:', err);
    commandExecutor.setAllowlist([]);
  }
  toolRegistry = new ToolRegistry();
  if (!agentDispatcher) {
    agentDispatcher = new AgentDispatcher(sendNotification);
  }
  if (!browserAutomationRouter) {
    const stagehandProvider = new StagehandProvider(stagehandBridge);
    const webviewProvider = new WebviewProvider(agentDispatcher, domAutomation, modelManager, systemLogger);
    browserAutomationRouter = new BrowserAutomationRouter({
      stagehandProvider,
      webviewProvider,
      systemLogger,
    });
  }
  agentCore = new AgentCore(
    modelManager,
    commandExecutor,
    toolRegistry,
    agentDispatcher,
    stagehandBridge,
    systemLogger,
    browserAutomationRouter,
  );
  swarm = new Swarm(
    modelManager,
    toolRegistry,
    agentDispatcher,
    commandExecutor,
    sendNotification,
    stagehandBridge,
    systemLogger,
    browserAutomationRouter,
  );

  await configureWorkspace(appConfig.workspacePath);

  // Configure models from persisted config (no API keys at rest)
  for (const [role, config] of Object.entries(appConfig.models || {})) {
    if (!config) continue;
    if (providerRequiresApiKey(config.provider)) {
      console.warn(`[sidecar] Skipping ${role} model config until API key is provided.`);
      continue;
    }
    modelManager.configure({ ...config, role: role as ModelRole });
  }

  console.error('[sidecar] All subsystems booted');
}

async function configureWorkspace(workspacePath: string | null): Promise<void> {
  const resolvedWorkspace = workspacePath || undefined;

  workspace = new WorkspaceFiles(resolvedWorkspace);
  await workspace.initialize();

  const workspaceDir = workspace.getWorkspaceDir();
  const logsDir = resolveDevLogBaseDir() || path.join(workspaceDir, 'logs');
  const systemLogsDir = path.join(logsDir, 'system');
  const memoryDb = path.join(workspaceDir, 'memory', 'index.sqlite');

  dailyLog = new DailyLog(logsDir);
  await dailyLog.initialize();

  systemLogger.setLogsDir(systemLogsDir);
  try {
    await systemLogger.initialize();
  } catch (err) {
    console.error('[sidecar] System logger init failed:', err);
  }

  if (qmdMemory) {
    qmdMemory.close();
  }
  qmdMemory = new QmdMemory(memoryDb);
  try {
    await qmdMemory.initialize();
  } catch (err) {
    console.error('[sidecar] qmd initialization failed (non-fatal):', err);
  }

  if (heartbeat) {
    heartbeat.stop();
  }
  heartbeat = new Heartbeat(workspace);
  heartbeat.start();

  if (reflection) {
    reflection.stop();
  }
  reflection = new Reflection(workspace, dailyLog, modelManager);
  reflection.setMemoryHandler(async (memories) => {
    for (const mem of memories) {
      await qmdMemory.addDocument(mem.id, mem.content, { title: mem.tags.join(', ') });
    }
  });
  reflection.start();

  commandExecutor?.setWorkspaceDir(workspaceDir);
}

function validateAllowlist(entries: CommandAllowlistEntry[]): void {
  for (const entry of entries) {
    const patterns = Array.isArray(entry.argsRegex) ? entry.argsRegex : [];
    for (const pattern of patterns) {
      try {
        new RegExp(pattern);
      } catch (err) {
        throw new Error(`Invalid regex for ${entry.command}: ${pattern}`);
      }
    }
  }
}

/** Register all JSON-RPC method handlers. */
function registerHandlers(): void {
  if (!domAutomation) {
    domAutomation = new DomAutomation(sendNotification);
  }
  if (!agentDispatcher) {
    agentDispatcher = new AgentDispatcher(sendNotification);
  }
  handlers.set('ping', async () => ({
    pong: true,
    uptime: Date.now() - startTime,
  }));

  handlers.set('getConfig', async () => appConfig);

  handlers.set('updateConfig', async (params) => {
    const incoming = (params || {}) as Partial<AppConfig>;
    if (incoming.commandAllowlist) {
      validateAllowlist(incoming.commandAllowlist);
    }

    appConfig = await configStore.update(incoming);
    if (incoming.commandAllowlist) {
      commandExecutor.setAllowlist(appConfig.commandAllowlist);
    }
    if (incoming.workspacePath !== undefined) {
      await configureWorkspace(appConfig.workspacePath);
    }

    return { status: 'ok', config: appConfig };
  });

  handlers.set('loadVault', async () => {
    const data = await configStore.loadVault();
    return { data };
  });

  handlers.set('saveVault', async (params) => {
    const data = params.data as string;
    if (!data || typeof data !== 'string') {
      throw new Error('Invalid vault data');
    }
    await configStore.saveVault(data);
    return { status: 'ok' };
  });

  handlers.set('agentQuery', async (params) => {
    const userQuery = params.userQuery as string || '';
    const activeTabUrl = params.activeTabUrl as string | undefined;
    const activeTabTitle = params.activeTabTitle as string | undefined;
    const tabCount = params.tabCount as number | undefined;

    // Log the query
    await dailyLog.log(`User query: ${userQuery}`);

    // Load workspace files for context
    const workspaceFiles = await workspace.loadAll();

    const context = {
      userQuery,
      activeTabUrl,
      activeTabTitle,
      tabCount,
      workspaceFiles,
    };

    // Route based on complexity
    const route = await agentCore.classifyAndRoute(context);

    let response: { reply: string };

    if (route.complexity === 'complex') {
      console.error(`[sidecar] Routing to Swarm (reason: ${route.reason})`);
      const result = await swarm.execute(userQuery, {}, {
        activeTabUrl,
        activeTabTitle,
        tabCount,
      });
      sendNotification('swarmComplete', { task: userQuery });
      response = { reply: result };
    } else {
      response = await agentCore.query(context);
    }

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

  handlers.set('swarmCancel', async () => {
    swarm.cancel();
    return { status: 'ok' };
  });

  handlers.set('configureModel', async (params) => {
    const provider = params.provider as Provider;
    const model = params.model as string;
    const apiKey = params.apiKey as string | undefined;
    const baseUrl = params.baseUrl as string | undefined;
    const temperature = params.temperature as number | undefined;
    const roleParam = params.role as ModelRole | undefined;
    const primary = params.primary as boolean | undefined;
    const role: ModelRole = roleParam === 'primary' || roleParam === 'secondary' || roleParam === 'subagent'
      ? roleParam
      : (primary ?? true ? 'primary' : 'subagent');

    modelManager.configure({
      provider,
      model,
      apiKey,
      baseUrl,
      role,
      temperature,
    });

    return { status: 'ok' };
  });

  handlers.set('terminalExec', async (params) => {
    const command = params.command as string;
    const args = Array.isArray(params.args) ? params.args.map((arg) => String(arg)) : [];
    const cwd = params.cwd as string | undefined;

    if (!command) {
      throw new Error('Command is required');
    }

    const result = await commandExecutor.execute(command, args, cwd);
    return result;
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

  handlers.set('listModels', async () => {
    return { models: modelManager.listConfigs() };
  });

  handlers.set('listLogs', async () => {
    const logs = await dailyLog.listLogs();
    return { logs };
  });

  handlers.set('getLogsDir', async () => {
    return { path: dailyLog.getLogsDir() };
  });

  handlers.set('readLog', async (params) => {
    const date = params.date as string | undefined;
    if (!date) return { date: '', content: '' };
    const content = await dailyLog.readDate(date);
    return { date, content };
  });

  handlers.set('logSystemEvent', async (params) => {
    const message = params.message as string | undefined;
    if (!message || !message.trim()) {
      return { status: 'ignored' };
    }
    const levelRaw = String(params.level || 'error').toLowerCase();
    const level = (['debug', 'info', 'warn', 'error'] as LogLevel[]).includes(levelRaw as LogLevel)
      ? (levelRaw as LogLevel)
      : 'error';
    try {
      await systemLogger.log(level, message.trim());
      return { status: 'ok' };
    } catch {
      return { status: 'error' };
    }
  });

  handlers.set('clearHistory', async () => {
    agentCore.clearHistory();
    return { status: 'ok' };
  });

  handlers.set('getStatus', async () => {
    let memoryStatus: { totalDocuments: number; needsEmbedding: number } | null = null;
    try {
      memoryStatus = qmdMemory.getStatus();
    } catch {
      memoryStatus = null;
    }
    return {
      uptime: Date.now() - startTime,
      heartbeat: heartbeat.getState(),
      modelsConfigured: modelManager.listConfigs().length,
      historyLength: agentCore.getHistoryLength(),
      memoryStatus,
    };
  });

  handlers.set('domAutomation', async (params) => {
    return domAutomation.request(params as {
      requestId?: string;
      tabId?: string;
      actions: Record<string, unknown>[];
      timeoutMs?: number;
      returnMode?: 'all' | 'last' | 'none';
    });
  });

  handlers.set('domAutomationResult', async (params) => {
    console.error(`[sidecar] domAutomationResult received: reqId=${(params as any)?.requestId} ok=${(params as any)?.ok}`);
    if (!isDomAutomationResult(params)) {
      console.error('[sidecar] Invalid domAutomationResult payload:', JSON.stringify(params).slice(0, 500));
      return { status: 'error' };
    }
    domAutomation.handleResult(params);
    return { status: 'ok' };
  });

  handlers.set('browserStatus', async () => {
    if (!stagehandBridge) {
      return {
        active: false,
        initializing: false,
        lastUsedAt: null,
        idleMs: null,
        lastError: 'Stagehand bridge not initialized',
        browserPid: null,
        wsEndpoint: null,
      };
    }
    return stagehandBridge.getStatus();
  });

  handlers.set('browserClose', async () => {
    if (stagehandBridge) {
      await stagehandBridge.close();
    }
    return { status: 'ok' };
  });

  handlers.set('agentResult', async (params) => {
    console.error(`[sidecar] agentResult received: reqId=${(params as any)?.requestId} ok=${(params as any)?.ok}`);
    if (!isAgentResult(params)) {
      console.error('[sidecar] Invalid agentResult payload:', JSON.stringify(params).slice(0, 500));
      return { status: 'error' };
    }
    agentDispatcher.handleResult(params);
    return { status: 'ok' };
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
    void stagehandBridge?.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[sidecar] SIGTERM received, shutting down');
    heartbeat.stop();
    reflection.stop();
    qmdMemory.close();
    void stagehandBridge?.close();
    process.exit(0);
  });
}

// Export for use by other modules
export { handlers, sendNotification, sendResponse, sendError };
export type { Handler, JsonRpcRequest, JsonRpcResponse };

main();
