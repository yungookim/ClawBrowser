import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

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
  private nextId = 1;
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }> = new Map();
  private notificationHandlers: NotificationHandler[] = [];
  private unlistenFn: UnlistenFn | null = null;
  private ready = false;

  async start(): Promise<void> {
    // Listen for sidecar messages relayed via Tauri events
    this.unlistenFn = await listen<string>('sidecar-message', (event) => {
      this.handleMessage(event.payload);
    });

    this.ready = true;
  }

  async stop(): Promise<void> {
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
    this.ready = false;

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Sidecar stopped'));
    }
    this.pendingRequests.clear();
  }

  async send(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.ready) {
      throw new Error('Sidecar not started');
    }

    const id = this.nextId++;

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

    // Send via Rust relay
    await invoke('sidecar_send', { method, params });

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

  async configureModel(provider: string, model: string, apiKey: string, primary: boolean): Promise<void> {
    await this.send('configureModel', { provider, model, apiKey, primary });
  }

  async tabUpdate(tabCount: number, activeTabTitle: string): Promise<void> {
    await this.send('tabUpdate', { tabCount, activeTabTitle });
  }

  async triggerReflection(): Promise<void> {
    await this.send('triggerReflection', {});
  }

  async ping(): Promise<{ pong: boolean; uptime: number }> {
    return this.send('ping', {}) as Promise<{ pong: boolean; uptime: number }>;
  }

  private handleMessage(payload: string | SidecarNotification | JsonRpcResponse): void {
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
