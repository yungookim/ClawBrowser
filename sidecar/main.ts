import * as readline from 'node:readline';

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

// Register built-in handlers
handlers.set('ping', async () => ({
  pong: true,
  uptime: Date.now() - startTime,
}));

handlers.set('agentQuery', async (params) => {
  // Stub: returns echo until AgentCore is wired in Phase 4
  const userQuery = params.userQuery as string || '';
  return {
    reply: `[Agent stub] Received: "${userQuery}"`,
  };
});

handlers.set('configureModel', async (params) => {
  // Stub: model configuration will be handled by ModelManager in Phase 4
  const provider = params.provider as string || 'unknown';
  const model = params.model as string || 'unknown';
  console.error(`[sidecar] Model configured: ${provider}/${model}`);
  return { status: 'ok' };
});

handlers.set('tabUpdate', async (params) => {
  // Stub: context tracking for agent awareness
  const tabCount = params.tabCount as number || 0;
  const activeTabTitle = params.activeTabTitle as string || '';
  console.error(`[sidecar] Tab update: ${tabCount} tabs, active: "${activeTabTitle}"`);
  return { status: 'ok' };
});

handlers.set('triggerReflection', async () => {
  // Stub: nightly reflection will be implemented in Phase 6
  console.error('[sidecar] Reflection triggered (stub)');
  return { status: 'ok', message: 'Reflection not yet implemented' };
});

handlers.set('getMemory', async () => {
  // Stub: memory retrieval will be implemented in Phase 5
  return { files: {}, memories: [] };
});

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

// Main: read stdin line by line, parse JSON-RPC, process
function main(): void {
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
      // If we can't parse, we can't respond (no id)
    }
  });

  rl.on('close', () => {
    console.error('[sidecar] stdin closed, shutting down');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[sidecar] SIGTERM received, shutting down');
    process.exit(0);
  });
}

// Export handlers map so Phase 4+ can register new handlers
export { handlers, sendNotification, sendResponse, sendError };
export type { Handler, JsonRpcRequest, JsonRpcResponse };

main();
