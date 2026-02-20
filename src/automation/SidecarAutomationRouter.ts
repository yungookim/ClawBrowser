import type { DomAutomationRequest, DomAutomationResult } from './domTypes';
import { DomAutomationBridge } from './DomAutomationBridge';
import { SidecarBridge } from '../agent/SidecarBridge';

export class SidecarAutomationRouter {
  private sidecar: SidecarBridge;
  private dom: DomAutomationBridge;
  private started = false;

  constructor(sidecar: SidecarBridge, dom: DomAutomationBridge) {
    this.sidecar = sidecar;
    this.dom = dom;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.sidecar.onNotification((method, params) => {
      if (method !== 'domAutomationRequest') return;
      const req = params as DomAutomationRequest;
      console.log(`[SidecarAutomationRouter] domAutomationRequest received: reqId=${req?.requestId} tabId=${req?.tabId} actions=${req?.actions?.length || 0}`);
      this.handleRequest(req).catch((err) => {
        console.error('[SidecarAutomationRouter] handleRequest error:', err);
      });
    });
  }

  private async handleRequest(params: DomAutomationRequest): Promise<void> {
    if (!params || !params.requestId) {
      console.warn('[SidecarAutomationRouter] handleRequest: DROPPED — missing requestId');
      return;
    }
    if (!Array.isArray(params.actions) || params.actions.length === 0) {
      console.warn(`[SidecarAutomationRouter] handleRequest: REJECTED — empty/missing actions for reqId=${params.requestId}`);
      const errorResult: DomAutomationResult = {
        requestId: params.requestId,
        ok: false,
        results: [],
        error: { message: 'domAutomationRequest missing actions' },
        meta: { tabId: params.tabId },
      };
      await this.sidecar.send('domAutomationResult', errorResult);
      return;
    }

    let result: DomAutomationResult;
    try {
      result = await this.dom.executeRequest(params);
      console.log(`[SidecarAutomationRouter] executeRequest completed: reqId=${result.requestId} ok=${result.ok}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SidecarAutomationRouter] executeRequest FAILED: reqId=${params.requestId} error="${message}"`);
      result = {
        requestId: params.requestId,
        ok: false,
        results: [],
        error: {
          message,
        },
        meta: {
          tabId: params.tabId,
        },
      };
    }

    try {
      console.log(`[SidecarAutomationRouter] sending domAutomationResult: reqId=${result.requestId} ok=${result.ok}`);
      await this.sidecar.send('domAutomationResult', result);
    } catch (err) {
      console.warn('[SidecarAutomationRouter] FAILED to send domAutomationResult to sidecar:', err);
    }
  }
}
