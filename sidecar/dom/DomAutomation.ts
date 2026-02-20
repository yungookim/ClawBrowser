import { randomUUID } from 'node:crypto';

export type DomAutomationAction = Record<string, unknown>;

export interface DomAutomationRequest {
  requestId?: string;
  tabId?: string;
  actions: DomAutomationAction[];
  timeoutMs?: number;
  returnMode?: 'all' | 'last' | 'none';
  descriptorMode?: 'full' | 'balanced';
}

export interface DomAutomationResult {
  requestId: string;
  ok: boolean;
  results: Array<{ type: string; value?: unknown }>;
  error?: { message: string; actionIndex?: number; actionType?: string; stack?: string };
  meta?: { url?: string; title?: string; durationMs?: number; tabId?: string };
}

type Pending = {
  resolve: (value: DomAutomationResult) => void;
  reject: (reason: Error) => void;
  timeoutId: NodeJS.Timeout;
};

type Notify = (method: string, params?: Record<string, unknown>) => void;

export class DomAutomation {
  private pending = new Map<string, Pending>();
  private notify: Notify;

  constructor(notify: Notify) {
    this.notify = notify;
  }

  async request(params: DomAutomationRequest): Promise<DomAutomationResult> {
    const actions = Array.isArray(params.actions) ? params.actions : [];
    if (!actions.length) {
      throw new Error('domAutomation requires at least one action');
    }

    const requestId = params.requestId || randomUUID();
    const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 30_000;

    const requestPayload = {
      requestId,
      tabId: params.tabId,
      actions,
      timeoutMs,
      returnMode: params.returnMode,
      descriptorMode: params.descriptorMode,
    };

    console.error(`[DomAutomation/Sidecar] Sending domAutomationRequest: reqId=${requestId} tabId=${params.tabId || 'none'} actions=${actions.length} timeoutMs=${timeoutMs}`);
    this.notify('domAutomationRequest', requestPayload);

    return new Promise<DomAutomationResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.error(`[DomAutomation/Sidecar] TIMEOUT reqId=${requestId} after ${timeoutMs}ms — pending count: ${this.pending.size}`);
        this.pending.delete(requestId);
        reject(new Error(`Dom automation timeout (${requestId})`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeoutId });
    });
  }

  handleResult(result: DomAutomationResult): void {
    if (!result || !result.requestId) {
      console.error(`[DomAutomation/Sidecar] handleResult: dropped — missing requestId`, JSON.stringify(result));
      return;
    }
    const pending = this.pending.get(result.requestId);
    if (!pending) {
      console.error(`[DomAutomation/Sidecar] handleResult: no pending for reqId=${result.requestId} — pending keys: [${[...this.pending.keys()].join(', ')}]`);
      return;
    }
    console.error(`[DomAutomation/Sidecar] handleResult: resolved reqId=${result.requestId} ok=${result.ok}`);
    clearTimeout(pending.timeoutId);
    this.pending.delete(result.requestId);
    pending.resolve(result);
  }
}
