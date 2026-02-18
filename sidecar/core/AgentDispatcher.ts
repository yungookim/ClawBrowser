import { randomUUID } from 'node:crypto';

export interface AgentRequest {
  requestId?: string;
  capability: string;
  action: string;
  params?: Record<string, unknown>;
  destructive?: boolean;
  timeoutMs?: number;
}

export interface AgentResult {
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: { message: string };
}

type Pending = {
  resolve: (value: AgentResult) => void;
  reject: (reason: Error) => void;
  timeoutId: NodeJS.Timeout;
};

type Notify = (method: string, params?: Record<string, unknown>) => void;

export class AgentDispatcher {
  private pending = new Map<string, Pending>();
  private notify: Notify;

  constructor(notify: Notify) {
    this.notify = notify;
  }

  async request(params: AgentRequest): Promise<AgentResult> {
    const requestId = params.requestId || randomUUID();
    const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 30_000;

    const payload = {
      requestId,
      capability: params.capability,
      action: params.action,
      params: params.params || {},
      destructive: params.destructive || false,
    };

    this.notify('agentRequest', payload);

    return new Promise<AgentResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Agent request timeout (${requestId})`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeoutId });
    });
  }

  handleResult(result: AgentResult): void {
    if (!result || !result.requestId) return;
    const pending = this.pending.get(result.requestId);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pending.delete(result.requestId);
    pending.resolve(result);
  }
}
