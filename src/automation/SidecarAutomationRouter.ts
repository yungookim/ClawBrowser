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
      this.handleRequest(params as DomAutomationRequest).catch((err) => {
        console.error('Dom automation request failed:', err);
      });
    });
  }

  private async handleRequest(params: DomAutomationRequest): Promise<void> {
    if (!params || !params.requestId) return;
    if (!Array.isArray(params.actions) || params.actions.length === 0) {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
      await this.sidecar.send('domAutomationResult', result);
    } catch (err) {
      console.warn('Failed to send domAutomationResult to sidecar:', err);
    }
  }
}
