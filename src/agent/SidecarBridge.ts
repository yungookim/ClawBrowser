import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Command, Child } from '@tauri-apps/plugin-shell';
import type { DomAutomationResult, DomAutomationRequest } from '../automation/domTypes';

interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params: unknown;
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: string;
  result?: unknown;
  error?: { code: number; message: string };
  id: number;
}

interface SidecarNotification {
  method: string;
  params: Record<string, unknown>;
}

type NotificationHandler = (method: string, params: Record<string, unknown>) => void;

export class SidecarBridge {
  private child: Child | null = null;
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }> = new Map();
  private notificationHandlers: NotificationHandler[] = [];
  private unlistenRequest: UnlistenFn | null = null;
  private unlistenMessage: UnlistenFn | null = null;
  private ready = false;

  async start(): Promise<void> {
    // Listen for sidecar-request events from Rust -- write them to sidecar stdin
    this.unlistenRequest = await listen<JsonRpcRequest>('sidecar-request', (event) => {
      this.writeToSidecar(event.payload);
    });

    // Listen for sidecar-message events from Rust -- handle responses/notifications
    this.unlistenMessage = await listen<JsonRpcResponse | SidecarNotification>('sidecar-message', (event) => {
      this.handleMessage(event.payload);
    });

    // Spawn the sidecar process via Tauri shell plugin
    const sidecarName = import.meta.env.VITE_SIDECAR_NAME || 'sidecar/clawbrowser-agent';
    const command = Command.sidecar(sidecarName);

    command.stdout.on('data', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // Relay stdout lines to Rust via sidecar_receive
      invoke('sidecar_receive', { message: trimmed }).catch((err) => {
        console.error('sidecar_receive failed:', err);
      });
    });

    command.stderr.on('data', (line: string) => {
      console.warn('[sidecar stderr]', line);
    });

    command.on('error', (error: string) => {
      console.error('[sidecar error]', error);
      this.ready = false;
    });

    command.on('close', (data: { code: number | null; signal: number | null }) => {
      console.warn('[sidecar closed]', data);
      this.ready = false;
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error('Sidecar process exited'));
      }
      this.pendingRequests.clear();
    });

    this.child = await command.spawn();

    // Notify Rust that sidecar is starting
    await invoke('start_sidecar');

    this.ready = true;
  }

  async stop(): Promise<void> {
    if (this.unlistenRequest) {
      this.unlistenRequest();
      this.unlistenRequest = null;
    }
    if (this.unlistenMessage) {
      this.unlistenMessage();
      this.unlistenMessage = null;
    }
    if (this.child) {
      await this.child.kill();
      this.child = null;
    }
    this.ready = false;

    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Sidecar stopped'));
    }
    this.pendingRequests.clear();
  }

  async send(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.ready) {
      throw new Error('Sidecar not started');
    }

    // Rust assigns the request ID and emits sidecar-request for us to write to stdin
    const id: number = await invoke('sidecar_send', { method, params });

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Sidecar request timeout: ${method}`));
        }
      }, 30_000);
    });

    return promise;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandlers.push(handler);
  }

  async agentQuery(userQuery: string, activeTabUrl?: string, activeTabTitle?: string, tabCount?: number): Promise<string> {
    const result = await this.send('agentQuery', {
      userQuery,
      activeTabUrl,
      activeTabTitle,
      tabCount,
    }) as { reply: string };
    return result.reply;
  }

  async configureModel(
    provider: string,
    model: string,
    apiKey: string | undefined,
    role: string,
    baseUrl?: string,
    temperature?: number,
  ): Promise<void> {
    await this.send('configureModel', { provider, model, apiKey, role, baseUrl, temperature });
  }

  async getConfig(): Promise<{
    onboardingComplete: boolean;
    workspacePath: string | null;
    models: Record<string, { provider: string; model: string; baseUrl?: string; temperature?: number }>;
    commandAllowlist: Array<{ command: string; argsRegex: string[] }>;
  }> {
    return this.send('getConfig', {}) as Promise<{
      onboardingComplete: boolean;
      workspacePath: string | null;
      models: Record<string, { provider: string; model: string; baseUrl?: string; temperature?: number }>;
      commandAllowlist: Array<{ command: string; argsRegex: string[] }>;
    }>;
  }

  async updateConfig(partial: Record<string, unknown>): Promise<{ status: string }> {
    return this.send('updateConfig', partial) as Promise<{ status: string }>;
  }

  async loadVault(): Promise<{ data: string | null }> {
    return this.send('loadVault', {}) as Promise<{ data: string | null }>;
  }

  async saveVault(data: string): Promise<{ status: string }> {
    return this.send('saveVault', { data }) as Promise<{ status: string }>;
  }

  async terminalExec(command: string, args: string[], cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.send('terminalExec', { command, args, cwd }) as Promise<{ exitCode: number; stdout: string; stderr: string }>;
  }

  async tabUpdate(tabCount: number, activeTabTitle: string): Promise<void> {
    await this.send('tabUpdate', { tabCount, activeTabTitle });
  }

  async triggerReflection(): Promise<{ status: string; summary?: string; memoriesAdded?: number }> {
    return this.send('triggerReflection', {}) as Promise<{ status: string; summary?: string; memoriesAdded?: number }>;
  }

  async ping(): Promise<{ pong: boolean; uptime: number }> {
    return this.send('ping', {}) as Promise<{ pong: boolean; uptime: number }>;
  }

  async getStatus(): Promise<{
    uptime: number;
    heartbeat: {
      lastPulse: string;
      uptime: number;
      activeTabs: number;
      activeTabTitle: string;
      currentContext: string;
      pendingActions: string[];
    };
    modelsConfigured: number;
    historyLength: number;
    memoryStatus?: { totalDocuments: number; needsEmbedding: number } | null;
  }> {
    return this.send('getStatus', {}) as Promise<{
      uptime: number;
      heartbeat: {
        lastPulse: string;
        uptime: number;
        activeTabs: number;
        activeTabTitle: string;
        currentContext: string;
        pendingActions: string[];
      };
      modelsConfigured: number;
      historyLength: number;
      memoryStatus?: { totalDocuments: number; needsEmbedding: number } | null;
    }>;
  }

  async getMemory(query?: string): Promise<{
    files: Record<string, string>;
    memories: Array<{ id: string; content: string; title: string; score?: number }>;
  }> {
    return this.send('getMemory', { query }) as Promise<{
      files: Record<string, string>;
      memories: Array<{ id: string; content: string; title: string; score?: number }>;
    }>;
  }

  async listModels(): Promise<Array<{
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    role: string;
    temperature?: number;
  }>> {
    const result = await this.send('listModels', {}) as { models: Array<{
      provider: string;
      model: string;
      apiKey?: string;
      baseUrl?: string;
      role: string;
      temperature?: number;
    }> };
    return result.models;
  }

  async listLogs(): Promise<string[]> {
    const result = await this.send('listLogs', {}) as { logs: string[] };
    return result.logs;
  }

  async domAutomation(request: Omit<DomAutomationRequest, 'requestId'>): Promise<DomAutomationResult> {
    return this.send('domAutomation', request) as Promise<DomAutomationResult>;
  }

  async readLog(date: string): Promise<{ date: string; content: string }> {
    return this.send('readLog', { date }) as Promise<{ date: string; content: string }>;
  }

  async getLogsDir(): Promise<{ path: string }> {
    return this.send('getLogsDir', {}) as Promise<{ path: string }>;
  }

  async debugEvent(event: Record<string, unknown>): Promise<void> {
    await this.send('debugEvent', event);
  }

  async storeScreenshot(payload: {
    tabId: string;
    url?: string;
    title?: string;
    mime: string;
    dataBase64: string;
  }): Promise<{ status: string; path?: string }> {
    return this.send('storeScreenshot', payload) as Promise<{ status: string; path?: string }>;
  }

  async logSystemEvent(level: string, message: string): Promise<void> {
    await this.send('logSystemEvent', { level, message });
  }

  private writeToSidecar(request: JsonRpcRequest): void {
    if (!this.child) return;
    const line = JSON.stringify(request) + '\n';
    this.child.write(line).catch((err) => {
      console.error('Failed to write to sidecar stdin:', err);
    });
  }

  private handleMessage(payload: JsonRpcResponse | SidecarNotification | string): void {
    let msg: JsonRpcResponse | SidecarNotification;

    if (typeof payload === 'string') {
      try {
        msg = JSON.parse(payload);
      } catch {
        return;
      }
    } else {
      msg = payload;
    }

    // Check if it's a response (has id)
    if ('id' in msg && (msg as JsonRpcResponse).id !== undefined) {
      const response = msg as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    } else if ('method' in msg) {
      // Notification (no id)
      const notification = msg as SidecarNotification;
      for (const handler of this.notificationHandlers) {
        handler(notification.method, notification.params);
      }
    }
  }
}
