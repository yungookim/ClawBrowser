export type DebugEvent = {
  ts: string;
  source: string;
  type: string;
  tabId?: string;
  url?: string;
  title?: string;
  level?: string;
  message?: string;
  readyState?: string;
  viewport?: { w?: number; h?: number; dpr?: number };
  scroll?: { x?: number; y?: number };
  textSample?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  reason?: string;
  path?: string;
  mime?: string;
};

export type ScreenshotEntry = {
  ts: string;
  tabId: string;
  url?: string;
  title?: string;
  path: string;
  mime: string;
};

export class DebugStore {
  private events: DebugEvent[] = [];
  private maxEvents = 1000;
  private latestRenderByTab: Map<string, DebugEvent> = new Map();
  private latestScreenshotByTab: Map<string, ScreenshotEntry> = new Map();
  private knownTabs: Set<string> = new Set();

  addEvent(event: DebugEvent): void {
    const normalized: DebugEvent = {
      ts: event.ts || new Date().toISOString(),
      source: event.source || 'tab',
      type: event.type || 'event',
      tabId: event.tabId,
      url: event.url,
      title: event.title,
      level: event.level,
      message: event.message,
      readyState: event.readyState,
      viewport: event.viewport,
      scroll: event.scroll,
      textSample: event.textSample,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.stack,
      reason: event.reason,
      path: event.path,
      mime: event.mime,
    };

    if (normalized.tabId) {
      this.knownTabs.add(normalized.tabId);
    }

    if (normalized.type === 'render' && normalized.tabId) {
      this.latestRenderByTab.set(normalized.tabId, normalized);
    }

    this.events.push(normalized);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  }

  addScreenshot(entry: ScreenshotEntry): void {
    const normalized: ScreenshotEntry = {
      ts: entry.ts || new Date().toISOString(),
      tabId: entry.tabId,
      url: entry.url,
      title: entry.title,
      path: entry.path,
      mime: entry.mime,
    };
    this.latestScreenshotByTab.set(normalized.tabId, normalized);
    this.knownTabs.add(normalized.tabId);

    this.addEvent({
      ts: normalized.ts,
      source: 'tab',
      type: 'screenshot',
      tabId: normalized.tabId,
      url: normalized.url,
      title: normalized.title,
      path: normalized.path,
      mime: normalized.mime,
    });
  }

  getEvents(limit = 200): DebugEvent[] {
    if (limit <= 0) return [];
    return this.events.slice(Math.max(0, this.events.length - limit));
  }

  getLatestRenders(): Record<string, DebugEvent> {
    const result: Record<string, DebugEvent> = {};
    for (const [tabId, event] of this.latestRenderByTab.entries()) {
      result[tabId] = event;
    }
    return result;
  }

  getLatestScreenshots(): Record<string, ScreenshotEntry> {
    const result: Record<string, ScreenshotEntry> = {};
    for (const [tabId, entry] of this.latestScreenshotByTab.entries()) {
      result[tabId] = entry;
    }
    return result;
  }

  getTabIds(): string[] {
    return Array.from(this.knownTabs.values());
  }

  getScreenshot(tabId: string): ScreenshotEntry | undefined {
    return this.latestScreenshotByTab.get(tabId);
  }
}
