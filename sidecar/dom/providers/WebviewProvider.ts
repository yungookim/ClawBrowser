import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentDispatcher } from '../../core/AgentDispatcher.js';
import type { ModelManager } from '../../core/ModelManager.js';
import type { SystemLogger } from '../../logging/SystemLogger.js';
import type { DomAutomation, DomAutomationRequest, DomAutomationResult } from '../DomAutomation.js';
import type { BrowserAutomationAction, BrowserAutomationProvider, ScreenshotPayload, HybridSnapshot } from '../BrowserAutomationRouter.js';

const DOM_ACTION_GUIDE = `You generate dom.automation actions for a webview.
Return JSON ONLY: {"actions":[...],"returnMode":"all|last|none", "timeoutMs":<ms?>}
Actions supported (use only what you need):
- click: {type:"click", target: <selector>}
- type: {type:"type", target:<selector>, text:"...", clear:true|false, pressEnter:true|false}
- press: {type:"press", key:"Enter", target?:<selector>}
- waitFor: {type:"waitFor", target?:<selector>, state:"visible|hidden|attached|detached", timeoutMs?:number}
- waitForText: {type:"waitForText", text:"...", exact?:boolean, timeoutMs?:number}
- getText: {type:"getText", target?:<selector>, trim?:boolean, maxLength?:number}
- getHTML: {type:"getHTML", target?:<selector>, outer?:boolean, maxLength?:number}
- getLinks: {type:"getLinks", target?:<selector>, maxResults?:number}
- getPageInfo: {type:"getPageInfo"}
- evaluate: {type:"evaluate", script:"<js>", args?:[]}
Selector can be a CSS string or object: {"css":"..."} or {"text":"..."} or {"role":"button","name":"Submit"}.
Keep actions <= 10. Use returnMode "none" for act, "last" for extract/observe.
If schema is provided for extract, prefer a single evaluate action that returns JSON matching the schema.`;

const DEFAULT_DOM_TIMEOUT_MS = 20_000;
const MAX_DOM_TIMEOUT_MS = 20_000;
const MIN_DOM_TIMEOUT_MS = 5_000;

const SCREENSHOT_SCRIPT = String.raw`
const doc = document.documentElement;
const width = Math.max(doc.scrollWidth, doc.clientWidth, window.innerWidth || 0);
const height = Math.max(doc.scrollHeight, doc.clientHeight, window.innerHeight || 0);
const serializer = new XMLSerializer();
const html = serializer.serializeToString(document.documentElement);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">'
  + '<foreignObject x="0" y="0" width="100%" height="100%">'
  + '<div xmlns="http://www.w3.org/1999/xhtml">' + html + '</div>'
  + '</foreignObject></svg>';
const encoder = new TextEncoder();
const bytes = encoder.encode(svg);
let binary = '';
for (let i = 0; i < bytes.length; i += 1) {
  binary += String.fromCharCode(bytes[i]);
}
const base64 = btoa(binary);
return { mime: 'image/svg+xml', dataBase64: base64, byteLength: bytes.length };
`;

const SNAPSHOT_SCRIPT = String.raw`
const selectors = Array.isArray(args && args[0]) ? args[0] : [];
const MAX_NODES = 600;
let nodeCount = 0;

const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const truncate = (text, max) => {
  const value = String(text || '');
  if (!max || value.length <= max) return value;
  return value.slice(0, max) + '...';
};

const getRole = (el) => el.getAttribute && el.getAttribute('role') || null;
const getName = (el) => {
  if (!el) return '';
  const aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
  if (aria) return truncate(normalize(aria), 120);
  const alt = el.getAttribute && el.getAttribute('alt');
  if (alt) return truncate(normalize(alt), 120);
  const title = el.getAttribute && el.getAttribute('title');
  if (title) return truncate(normalize(title), 120);
  return truncate(normalize(el.textContent || ''), 120);
};

const isInteractive = (el) => {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (['button','a','input','select','textarea','option'].includes(tag)) return true;
  const role = getRole(el);
  return Boolean(role);
};

const describe = (el) => {
  if (!el || !el.tagName) return null;
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: el.className ? String(el.className).split(/\s+/).filter(Boolean).slice(0, 6) : [],
    role: getRole(el),
    name: getName(el),
    value: 'value' in el ? truncate(String(el.value || ''), 200) : null,
    rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
  };
};

const buildA11y = (el, depth) => {
  if (!el || nodeCount >= MAX_NODES || depth > 6) return null;
  const children = [];
  const childNodes = el.children || [];
  for (let i = 0; i < childNodes.length; i += 1) {
    const child = childNodes[i];
    const node = buildA11y(child, depth + 1);
    if (node) children.push(node);
    if (nodeCount >= MAX_NODES) break;
  }
  const role = getRole(el);
  const name = getName(el);
  const include = Boolean(role || name || isInteractive(el) || children.length);
  if (!include) return null;
  nodeCount += 1;
  return {
    tag: el.tagName ? el.tagName.toLowerCase() : 'unknown',
    role,
    name,
    states: {
      disabled: el.disabled || false,
      checked: el.checked || false,
      expanded: el.getAttribute && el.getAttribute('aria-expanded') === 'true',
    },
    children,
  };
};

const resolveTargets = (selector) => {
  if (!selector) return [];
  if (typeof selector === 'string') {
    try { return Array.from(document.querySelectorAll(selector)); } catch { return []; }
  }
  if (selector.css || selector.selector) {
    const css = selector.css || selector.selector;
    try { return Array.from(document.querySelectorAll(css)); } catch { return []; }
  }
  if (selector.id) {
    const el = document.getElementById(selector.id);
    return el ? [el] : [];
  }
  if (selector.text) {
    const matches = [];
    const targetText = normalize(selector.text);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const value = normalize(node.nodeValue || '');
      if (!value) continue;
      if (selector.exact ? value === targetText : value.includes(targetText)) {
        if (node.parentElement) matches.push(node.parentElement);
      }
      if (matches.length >= 5) break;
    }
    return matches;
  }
  return [];
};

const targets = [];
selectors.forEach((sel) => {
  resolveTargets(sel).forEach((el) => targets.push(el));
});

if (!targets.length && document.activeElement) {
  targets.push(document.activeElement);
}
if (!targets.length && document.body) {
  targets.push(document.body);
}

const minimalDom = targets.slice(0, 5).map((el) => {
  const ancestors = [];
  let current = el && el.parentElement;
  for (let i = 0; i < 2 && current; i += 1) {
    ancestors.push(describe(current));
    current = current.parentElement;
  }
  const siblings = el && el.parentElement
    ? Array.from(el.parentElement.children).slice(0, 6).map((sib) => describe(sib))
    : [];
  return {
    target: describe(el),
    ancestors,
    siblings,
  };
});

const a11yTree = buildA11y(document.body, 0);
return { a11yTree, minimalDom };
`;

export class WebviewProvider implements BrowserAutomationProvider {
  name = 'webview';
  private dispatcher: AgentDispatcher | null;
  private domAutomation: DomAutomation | null;
  private modelManager: ModelManager;
  private systemLogger: SystemLogger | null;
  private lastSelectors: unknown[] = [];
  private lastSelectorAt: number | null = null;

  constructor(
    dispatcher: AgentDispatcher | null,
    domAutomation: DomAutomation | null,
    modelManager: ModelManager,
    systemLogger?: SystemLogger | null,
  ) {
    this.dispatcher = dispatcher;
    this.domAutomation = domAutomation;
    this.modelManager = modelManager;
    this.systemLogger = systemLogger || null;
  }

  async execute(action: BrowserAutomationAction, params: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'navigate':
        return this.navigate(String(params.url || ''));
      case 'screenshot':
        return this.captureScreenshot(params.fullPage === true);
      case 'act':
      case 'extract':
      case 'observe':
        return this.runDomAutomation(action, params);
      default:
        throw new Error(`Unknown browser action: ${action}`);
    }
  }

  async captureScreenshot(_fullPage?: boolean): Promise<ScreenshotPayload> {
    const result = await this.runEvaluate(SCREENSHOT_SCRIPT, []);
    if (!result || typeof result !== 'object') {
      throw new Error('Webview screenshot failed');
    }
    return result as ScreenshotPayload;
  }

  async captureSnapshot(context: { action: BrowserAutomationAction; params: Record<string, unknown> }): Promise<HybridSnapshot> {
    const selectors = this.getRecentSelectors();
    const result = await this.runEvaluate(SNAPSHOT_SCRIPT, [selectors]);
    return result as HybridSnapshot;
  }

  private async navigate(url: string): Promise<unknown> {
    if (!this.dispatcher) {
      throw new Error('Webview dispatcher unavailable');
    }
    const result = await this.dispatcher.request({
      capability: 'tab',
      action: 'navigate',
      params: { url },
    });
    if (!result.ok) {
      throw new Error(result.error?.message || 'tab.navigate failed');
    }
    return result.data;
  }

  private async runDomAutomation(action: BrowserAutomationAction, params: Record<string, unknown>): Promise<unknown> {
    if (!this.domAutomation) {
      throw new Error('Dom automation unavailable');
    }

    const plan = await this.planDomActions(action, params);
    this.captureSelectors(plan);

    const result = await this.domAutomation.request(plan);
    if (!result.ok) {
      throw new Error(result.error?.message || 'dom.automation failed');
    }

    return this.formatDomResult(action, result, plan.returnMode);
  }

  private async planDomActions(action: BrowserAutomationAction, params: Record<string, unknown>): Promise<DomAutomationRequest> {
    const model = this.modelManager.createModel('primary');
    if (!model) {
      throw new Error('No model available for webview fallback');
    }

    const instruction = String(params.instruction || params.url || '');
    const schema = params.schema;
    const userPrompt = [
      `Action: ${action}`,
      `Instruction: ${instruction}`,
      schema ? `Schema: ${JSON.stringify(schema)}` : 'Schema: none',
    ].join('\n');

    const response = await model.invoke([
      new SystemMessage(DOM_ACTION_GUIDE),
      new HumanMessage(userPrompt),
    ]);

    const plan = this.parsePlan(response);
    if (plan) {
      return this.normalizePlan(plan, action);
    }

    const retry = await model.invoke([
      new SystemMessage(DOM_ACTION_GUIDE),
      new HumanMessage(`${userPrompt}\nYour previous response was invalid JSON. Return ONLY valid JSON.`),
    ]);

    const fallbackPlan = this.parsePlan(retry);
    if (!fallbackPlan) {
      throw new Error('Failed to generate dom.automation plan');
    }

    return this.normalizePlan(fallbackPlan, action);
  }

  private parsePlan(response: any): DomAutomationRequest | null {
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
    const trimmed = content.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(trimmed) as DomAutomationRequest;
      if (!parsed || !Array.isArray((parsed as any).actions)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private normalizePlan(plan: DomAutomationRequest, action: BrowserAutomationAction): DomAutomationRequest {
    const normalized: DomAutomationRequest = {
      actions: Array.isArray(plan.actions) ? plan.actions : [],
      timeoutMs: typeof plan.timeoutMs === 'number' ? plan.timeoutMs : undefined,
      returnMode: plan.returnMode,
      descriptorMode: plan.descriptorMode,
      tabId: plan.tabId,
    };

    if (!normalized.actions.length) {
      throw new Error('Dom automation plan contains no actions');
    }

    if (!normalized.returnMode) {
      normalized.returnMode = action === 'act' ? 'none' : 'last';
    }

    const desiredTimeout = typeof normalized.timeoutMs === 'number'
      ? normalized.timeoutMs
      : DEFAULT_DOM_TIMEOUT_MS;
    const clamped = Math.min(Math.max(desiredTimeout, MIN_DOM_TIMEOUT_MS), MAX_DOM_TIMEOUT_MS);
    normalized.timeoutMs = clamped;

    return normalized;
  }

  private formatDomResult(action: BrowserAutomationAction, result: DomAutomationResult, returnMode?: string): unknown {
    if (action === 'act') {
      return { status: 'ok' };
    }
    if (returnMode === 'last') {
      const last = result.results[result.results.length - 1];
      return last ? last.value : null;
    }
    return result.results;
  }

  private async runEvaluate(script: string, args: unknown[]): Promise<unknown> {
    if (!this.domAutomation) {
      throw new Error('Dom automation unavailable');
    }

    const request: DomAutomationRequest = {
      actions: [{
        type: 'evaluate',
        script,
        args,
      }],
      returnMode: 'last',
      timeoutMs: 20_000,
    };

    const result = await this.domAutomation.request(request);
    if (!result.ok) {
      throw new Error(result.error?.message || 'dom.automation evaluate failed');
    }

    const last = result.results[result.results.length - 1];
    return last ? last.value : null;
  }

  private captureSelectors(plan: DomAutomationRequest): void {
    const selectors: unknown[] = [];
    for (const action of plan.actions || []) {
      const target = (action as any).target;
      if (target) selectors.push(target);
      if (selectors.length >= 5) break;
    }
    if (selectors.length) {
      this.lastSelectors = selectors;
      this.lastSelectorAt = Date.now();
    }
  }

  private getRecentSelectors(): unknown[] {
    if (!this.lastSelectorAt) return [];
    if (Date.now() - this.lastSelectorAt > 60_000) return [];
    return this.lastSelectors;
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (!this.systemLogger) return;
    this.systemLogger.log(level, message).catch(() => {
      // Ignore logging failures.
    });
  }
}
