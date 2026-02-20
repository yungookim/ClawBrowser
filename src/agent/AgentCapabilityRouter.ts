import type { AgentControlSettings, AgentRequest, AgentResult } from './types';
import { DEFAULT_AGENT_CONTROL } from './types';
import { SidecarBridge } from './SidecarBridge';
import { TabManager } from '../tabs/TabManager';
import type { DomAutomationBridge } from '../automation/DomAutomationBridge';
import type { DomAutomationRequest } from '../automation/domTypes';

type RouterOptions = {
  domAutomation?: DomAutomationBridge;
};

export class AgentCapabilityRouter {
  private sidecar: SidecarBridge;
  private tabManager: TabManager;
  private domAutomation?: DomAutomationBridge;
  private started = false;
  private cachedConfig: AgentControlSettings = DEFAULT_AGENT_CONTROL;
  private lastConfigAt = 0;
  private configTtlMs = 5_000;

  constructor(sidecar: SidecarBridge, tabManager: TabManager, options: RouterOptions = {}) {
    this.sidecar = sidecar;
    this.tabManager = tabManager;
    this.domAutomation = options.domAutomation;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.sidecar.onNotification((method, params) => {
      if (method !== 'agentRequest') return;
      const req = params as AgentRequest;
      console.log(`[AgentCapabilityRouter] agentRequest received: reqId=${req?.requestId} capability=${req?.capability} action=${req?.action}`);
      this.handleRequest(req).catch((err) => {
        console.error('[AgentCapabilityRouter] handleRequest error:', err);
      });
    });
  }

  private async ensureConfig(): Promise<AgentControlSettings> {
    const now = Date.now();
    if (now - this.lastConfigAt < this.configTtlMs) {
      return this.cachedConfig;
    }
    try {
      const config = await this.sidecar.getConfig();
      if (config?.agentControl) {
        this.cachedConfig = config.agentControl;
      } else {
        this.cachedConfig = DEFAULT_AGENT_CONTROL;
      }
      this.lastConfigAt = now;
    } catch (err) {
      console.warn('Failed to refresh agent control config:', err);
    }
    return this.cachedConfig;
  }

  private async handleRequest(request: AgentRequest): Promise<void> {
    if (!request || !request.requestId) return;

    const config = await this.ensureConfig();
    if (!config.enabled || config.killSwitch) {
      await this.sendResult({
        requestId: request.requestId,
        ok: false,
        error: { message: 'Agent control disabled.' },
      });
      return;
    }

    if (request.destructive && config.destructiveConfirm !== 'none') {
      await this.sendResult({
        requestId: request.requestId,
        ok: false,
        error: { message: 'Destructive actions require confirmation.' },
      });
      return;
    }

    let result: AgentResult;
    try {
      const data = await this.executeRequest(request);
      result = { requestId: request.requestId, ok: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { requestId: request.requestId, ok: false, error: { message } };
    }

    await this.sendResult(result);
  }

  private async executeRequest(request: AgentRequest): Promise<unknown> {
    const params = request.params || {};

    switch (request.capability) {
      case 'tab':
        return this.handleTab(request.action, params);
      case 'nav':
        return this.handleNav(request.action, params);
      case 'dom':
        return this.handleDom(request.action, params);
      default:
        throw new Error(`Unsupported capability: ${request.capability}`);
    }
  }

  private async handleTab(action: string, params: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'create': {
        const url = typeof params.url === 'string' ? params.url : 'about:blank';
        const tabId = await this.tabManager.createTab(url);
        return { tabId };
      }
      case 'close': {
        const tabId = this.getRequiredString(params, 'tabId');
        await this.tabManager.closeTab(tabId);
        return { tabId };
      }
      case 'switch': {
        const tabId = this.getRequiredString(params, 'tabId');
        await this.tabManager.switchTab(tabId);
        return { tabId };
      }
      case 'navigate': {
        const url = this.getRequiredString(params, 'url');
        const tabId = typeof params.tabId === 'string' ? params.tabId : null;
        if (tabId) {
          await this.tabManager.navigateTab(tabId, url);
          return { tabId, url };
        }
        await this.tabManager.navigate(url);
        return { url };
      }
      case 'list': {
        return { tabs: this.tabManager.getTabs() };
      }
      case 'getActive': {
        return { tab: this.tabManager.getActiveTab() || null };
      }
      default:
        throw new Error(`Unsupported tab action: ${action}`);
    }
  }

  private async handleNav(action: string, params: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'back': {
        await this.tabManager.goBack();
        return { ok: true };
      }
      case 'forward': {
        await this.tabManager.goForward();
        return { ok: true };
      }
      case 'reload': {
        const tabId = typeof params.tabId === 'string' ? params.tabId : null;
        const tab = tabId ? this.tabManager.getTabById(tabId) : this.tabManager.getActiveTab();
        if (!tab) {
          throw new Error('No active tab to reload');
        }
        await this.tabManager.navigateTab(tab.id, tab.url);
        return { tabId: tab.id };
      }
      default:
        throw new Error(`Unsupported nav action: ${action}`);
    }
  }

  private async handleDom(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (action !== 'automation') {
      throw new Error(`Unsupported dom action: ${action}`);
    }
    if (!this.domAutomation) {
      throw new Error('DOM automation unavailable');
    }

    const actions = Array.isArray(params.actions) ? params.actions : null;
    if (!actions) {
      throw new Error('DOM automation requires actions array');
    }

    const request: DomAutomationRequest = {
      requestId: typeof params.requestId === 'string' ? params.requestId : undefined,
      tabId: typeof params.tabId === 'string' ? params.tabId : undefined,
      actions,
      timeoutMs: typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined,
      returnMode: typeof params.returnMode === 'string' ? params.returnMode as DomAutomationRequest['returnMode'] : undefined,
      descriptorMode: typeof params.descriptorMode === 'string'
        && (params.descriptorMode === 'full' || params.descriptorMode === 'balanced')
        ? params.descriptorMode as DomAutomationRequest['descriptorMode']
        : undefined,
    };

    console.log(`[AgentCapabilityRouter] handleDom: reqId=${request.requestId || 'none (bridge will generate)'} tabId=${request.tabId || 'none (will use active)'} actions=${actions.length} actionTypes=[${actions.map((a: any) => a.type).join(',')}]`);

    try {
      const result = await this.domAutomation.executeRequest(request);
      console.log(`[AgentCapabilityRouter] handleDom: SUCCESS reqId=${(result as any)?.requestId} ok=${(result as any)?.ok}`);
      return result;
    } catch (err) {
      console.error(`[AgentCapabilityRouter] handleDom: FAILED`, err);
      throw err;
    }
  }

  private getRequiredString(params: Record<string, unknown>, key: string): string {
    const value = params[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Missing ${key}`);
    }
    return value;
  }

  private async sendResult(result: AgentResult): Promise<void> {
    console.log(`[AgentCapabilityRouter] sendResult: reqId=${result.requestId} ok=${result.ok}${result.error ? ` error="${result.error.message}"` : ''}`);
    try {
      await this.sidecar.send('agentResult', result);
      console.log(`[AgentCapabilityRouter] sendResult: sent successfully`);
    } catch (err) {
      console.warn('[AgentCapabilityRouter] sendResult: FAILED to send agentResult to sidecar:', err);
    }
  }
}
