import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { TabManager } from '../tabs/TabManager';
import { buildDomAutomationScript } from './domScript';
import type { DomAction, DomAutomationRequest, DomAutomationResult } from './domTypes';
import { Permissions } from '../security/Permissions';

type PendingRequest = {
  resolve: (value: DomAutomationResult) => void;
  reject: (reason: Error) => void;
  timeoutId: number;
};

export class DomAutomationBridge {
  private tabManager: TabManager;
  private pending: Map<string, PendingRequest> = new Map();
  private unlisten: UnlistenFn | null = null;
  private activeCount = 0;
  private onActivityChange?: (active: boolean, pending: number) => void;

  constructor(tabManager: TabManager, options?: { onActivityChange?: (active: boolean, pending: number) => void }) {
    this.tabManager = tabManager;
    this.onActivityChange = options?.onActivityChange;
  }

  async start(): Promise<void> {
    if (this.unlisten) return;
    console.log('[DomAutomationBridge] start: registering claw-dom-automation listener');
    this.unlisten = await listen<DomAutomationResult>('claw-dom-automation', (event) => {
      console.log(`[DomAutomationBridge] EVENT received claw-dom-automation:`, JSON.stringify(event.payload ?? null).slice(0, 500));
      this.handleResult(event.payload);
    });
    console.log('[DomAutomationBridge] start: listener registered');
  }

  async stop(): Promise<void> {
    if (this.unlisten) {
      await this.unlisten();
      this.unlisten = null;
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Dom automation stopped'));
    }
    this.pending.clear();
    this.setActiveCount(0);
  }

  async execute(
    actions: DomAction[],
    options: { tabId?: string; timeoutMs?: number; returnMode?: 'all' | 'last' | 'none'; descriptorMode?: 'full' | 'balanced' } = {},
  ): Promise<DomAutomationResult> {
    const request: DomAutomationRequest = {
      requestId: this.createRequestId(),
      tabId: options.tabId,
      actions,
      timeoutMs: options.timeoutMs,
      returnMode: options.returnMode,
      descriptorMode: options.descriptorMode,
    };
    return this.executeRequest(request);
  }

  async executeRequest(request: DomAutomationRequest): Promise<DomAutomationResult> {
    if (!request.requestId) {
      request.requestId = this.createRequestId();
      console.log(`[DomAutomationBridge] executeRequest: generated requestId=${request.requestId}`);
    }
    const requestId = request.requestId;

    const tabId = request.tabId || this.tabManager.getActiveTabId();
    if (!tabId) {
      console.error(`[DomAutomationBridge] executeRequest: NO ACTIVE TAB — request.tabId=${request.tabId} activeTabId=${this.tabManager.getActiveTabId()}`);
      throw new Error('No active tab for dom automation');
    }

    request.tabId = tabId;
    const tab = this.tabManager.getTabById(tabId);
    const tabUrl = tab?.url || 'unknown';
    const origin = Permissions.getOrigin(tab?.url);

    console.log(`[DomAutomationBridge] executeRequest: reqId=${requestId} tabId=${tabId} url=${tabUrl} origin=${origin} actions=${request.actions?.length || 0} actionTypes=[${(request.actions || []).map((a: any) => a.type).join(',')}]`);

    if (Permissions.requiresPermission(origin)) {
      const allowed = await Permissions.ensureDomAutomation(origin || '');
      if (!allowed) {
        console.error(`[DomAutomationBridge] executeRequest: BLOCKED by permissions for ${origin}`);
        throw new Error(`DOM automation blocked for ${origin}`);
      }
    }

    const script = buildDomAutomationScript(request);
    const timeoutMs = typeof request.timeoutMs === 'number' ? request.timeoutMs : 30_000;

    console.log(`[DomAutomationBridge] executeRequest: script built (${script.length} chars), timeoutMs=${timeoutMs}, injecting into tabId=${tabId}`);

    const resultPromise = new Promise<DomAutomationResult>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        console.error(`[DomAutomationBridge] TIMEOUT reqId=${requestId} after ${timeoutMs}ms — pending keys: [${[...this.pending.keys()].join(', ')}]`);
        this.pending.delete(requestId);
        this.decrementActive();
        reject(new Error(`Dom automation timeout (${requestId})`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeoutId });
    });

    try {
      this.incrementActive();
      await this.tabManager.injectJs(tabId, script);
      console.log(`[DomAutomationBridge] executeRequest: script injected successfully into tabId=${tabId}`);
    } catch (err) {
      console.error(`[DomAutomationBridge] executeRequest: INJECTION FAILED tabId=${tabId}`, err);
      this.clearPending(requestId);
      this.decrementActive();
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Dom automation injection failed: ${message}`);
    }

    return resultPromise;
  }

  private handleResult(result: DomAutomationResult): void {
    if (!result || !result.requestId) {
      console.warn(`[DomAutomationBridge] handleResult: DROPPED — missing requestId. payload keys: [${result ? Object.keys(result).join(', ') : 'null'}]`);
      return;
    }
    const pending = this.pending.get(result.requestId);
    if (!pending) {
      console.warn(`[DomAutomationBridge] handleResult: NO PENDING for reqId=${result.requestId} — pending keys: [${[...this.pending.keys()].join(', ')}]`);
      return;
    }
    console.log(`[DomAutomationBridge] handleResult: RESOLVED reqId=${result.requestId} ok=${result.ok} results=${result.results?.length || 0}${result.error ? ` error="${result.error.message}"` : ''}`);
    this.pending.delete(result.requestId);
    clearTimeout(pending.timeoutId);
    this.decrementActive();
    pending.resolve(result);
  }

  private clearPending(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pending.delete(requestId);
  }

  private setActiveCount(count: number): void {
    const next = Math.max(0, count);
    if (this.activeCount === next) return;
    this.activeCount = next;
    if (this.onActivityChange) {
      this.onActivityChange(this.activeCount > 0, this.activeCount);
    }
  }

  private incrementActive(): void {
    this.setActiveCount(this.activeCount + 1);
  }

  private decrementActive(): void {
    this.setActiveCount(this.activeCount - 1);
  }

  private createRequestId(): string {
    if (globalThis.crypto && 'randomUUID' in globalThis.crypto) {
      return globalThis.crypto.randomUUID();
    }
    return `dom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
