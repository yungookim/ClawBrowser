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
    this.unlisten = await listen<DomAutomationResult>('claw-dom-automation', (event) => {
      this.handleResult(event.payload);
    });
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

  async execute(actions: DomAction[], options: { tabId?: string; timeoutMs?: number; returnMode?: 'all' | 'last' | 'none' } = {}): Promise<DomAutomationResult> {
    const request: DomAutomationRequest = {
      requestId: this.createRequestId(),
      tabId: options.tabId,
      actions,
      timeoutMs: options.timeoutMs,
      returnMode: options.returnMode,
    };
    return this.executeRequest(request);
  }

  async executeRequest(request: DomAutomationRequest): Promise<DomAutomationResult> {
    const tabId = request.tabId || this.tabManager.getActiveTabId();
    if (!tabId) {
      throw new Error('No active tab for dom automation');
    }

    request.tabId = tabId;
    const tab = this.tabManager.getTabById(tabId);
    const origin = Permissions.getOrigin(tab?.url);
    if (Permissions.requiresPermission(origin)) {
      const allowed = await Permissions.ensureDomAutomation(origin || '');
      if (!allowed) {
        throw new Error(`DOM automation blocked for ${origin}`);
      }
    }

    const script = buildDomAutomationScript(request);
    const timeoutMs = typeof request.timeoutMs === 'number' ? request.timeoutMs : 30_000;

    const resultPromise = new Promise<DomAutomationResult>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(request.requestId);
        this.decrementActive();
        reject(new Error(`Dom automation timeout (${request.requestId})`));
      }, timeoutMs);
      this.pending.set(request.requestId, { resolve, reject, timeoutId });
    });

    try {
      this.incrementActive();
      await this.tabManager.injectJs(tabId, script);
    } catch (err) {
      this.clearPending(request.requestId);
      this.decrementActive();
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Dom automation injection failed: ${message}`);
    }

    return resultPromise;
  }

  private handleResult(result: DomAutomationResult): void {
    if (!result || !result.requestId) return;
    const pending = this.pending.get(result.requestId);
    if (!pending) return;
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
