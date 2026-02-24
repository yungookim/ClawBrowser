import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ParsedToolCall } from '../core/ToolRegistry.js';
import type { SystemLogger } from '../logging/SystemLogger.js';

export type BrowserAutomationAction = 'navigate' | 'act' | 'extract' | 'observe' | 'screenshot';

export type BrowserAutomationContext = {
  traceId: string;
  stepId?: string;
};

export type BrowserAutomationResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  meta?: {
    provider?: string;
    fallback?: 'retry' | 'webview' | null;
  };
};

export type ScreenshotPayload = {
  mime: string;
  dataBase64: string;
  byteLength?: number;
};

export type HybridSnapshot = {
  a11yTree?: unknown;
  minimalDom?: unknown;
  [key: string]: unknown;
};

export interface BrowserAutomationProvider {
  name: string;
  execute(action: BrowserAutomationAction, params: Record<string, unknown>): Promise<unknown>;
  captureScreenshot?: (fullPage?: boolean) => Promise<ScreenshotPayload>;
  captureSnapshot?: (context: { action: BrowserAutomationAction; params: Record<string, unknown> }) => Promise<HybridSnapshot>;
}

type TraceSummary = {
  traceId: string;
  attempts: number;
  successes: number;
  failures: number;
  providers: Record<string, { attempts: number; successes: number; failures: number }>;
  lastOutcome?: {
    provider: string;
    ok: boolean;
    reason?: string;
    action: BrowserAutomationAction;
    attemptId: string;
  };
  updatedAt: string;
};

type StepState = {
  stagehandRetryUsed: boolean;
  stagehandDisabled: boolean;
};

type TraceState = {
  traceId: string;
  dir: string;
  attempts: number;
  summary: TraceSummary;
  stepStates: Map<string, StepState>;
};

type RouterOptions = {
  stagehandProvider: BrowserAutomationProvider;
  webviewProvider?: BrowserAutomationProvider | null;
  systemLogger?: SystemLogger | null;
  retentionRuns?: number;
};

const DEFAULT_RETENTION_RUNS = 20;
const WEBVIEW_DISABLED_ERROR = 'Webview automation disabled (Stagehand-only mode).';

export class BrowserAutomationRouter {
  private stagehandProvider: BrowserAutomationProvider;
  private webviewProvider: BrowserAutomationProvider | null;
  private systemLogger: SystemLogger | null;
  private retentionRuns: number;
  private traceStates = new Map<string, TraceState>();
  private lastPruneAt: number | null = null;

  constructor(options: RouterOptions) {
    this.stagehandProvider = options.stagehandProvider;
    this.webviewProvider = options.webviewProvider || null;
    this.systemLogger = options.systemLogger || null;
    this.retentionRuns = options.retentionRuns || DEFAULT_RETENTION_RUNS;
  }

  async execute(toolCall: Extract<ParsedToolCall, { kind: 'agent' }>, context: BrowserAutomationContext): Promise<BrowserAutomationResult> {
    if (!toolCall || toolCall.kind !== 'agent') {
      return { ok: false, error: 'Invalid browser automation tool call.' };
    }

    const action = toolCall.action as BrowserAutomationAction;
    const params = toolCall.params || {};
    const traceState = await this.ensureTraceState(context);
    const stepState = this.getStepState(traceState, context.stepId);
    const toolArgsHash = this.hashParams(params);

    const shouldUseStagehand = !stepState.stagehandDisabled;
    if (shouldUseStagehand) {
      const stagehandResult = await this.runProviderAttempt({
        provider: this.stagehandProvider,
        action,
        params,
        traceState,
        stepId: context.stepId,
        stepState,
        toolArgsHash,
      });

      if (stagehandResult.ok) {
        return stagehandResult;
      }

      if (!stepState.stagehandRetryUsed) {
        stepState.stagehandRetryUsed = true;
        await this.logFallback(traceState, stepState, context.stepId, action, toolArgsHash, stagehandResult.error || 'Stagehand failed', 'retry');
        return {
          ok: false,
          error: `Stagehand failed: ${stagehandResult.error || 'unknown error'}. Retry the same browser.* tool once more.`,
          meta: { provider: this.stagehandProvider.name, fallback: 'retry' },
        };
      }

      stepState.stagehandDisabled = true;
      if (!this.webviewProvider) {
        await this.logFallback(traceState, stepState, context.stepId, action, toolArgsHash, stagehandResult.error || 'Stagehand failed', 'webview');
        return {
          ok: false,
          error: `Stagehand failed twice: ${stagehandResult.error || 'unknown error'}. ${WEBVIEW_DISABLED_ERROR}`,
          meta: { provider: this.stagehandProvider.name, fallback: null },
        };
      }
      await this.logFallback(traceState, stepState, context.stepId, action, toolArgsHash, stagehandResult.error || 'Stagehand failed', 'webview');
    }

    if (!this.webviewProvider) {
      const reason = shouldUseStagehand ? 'Stagehand failed twice.' : 'Stagehand disabled.';
      return {
        ok: false,
        error: `${reason} ${WEBVIEW_DISABLED_ERROR}`,
        meta: { provider: this.stagehandProvider.name, fallback: null },
      };
    }

    const webviewResult = await this.runProviderAttempt({
      provider: this.webviewProvider,
      action,
      params,
      traceState,
      stepId: context.stepId,
      stepState,
      toolArgsHash,
    });

    if (webviewResult.ok) {
      return webviewResult;
    }

    const stagehandReason = shouldUseStagehand ? 'Stagehand failed twice.' : 'Stagehand disabled.';
    const webviewReason = webviewResult.error || 'Webview fallback failed.';
    return {
      ok: false,
      error: `${stagehandReason} Webview fallback failed: ${webviewReason}.`,
      meta: { provider: this.webviewProvider.name, fallback: 'webview' },
    };
  }

  private async runProviderAttempt(input: {
    provider: BrowserAutomationProvider;
    action: BrowserAutomationAction;
    params: Record<string, unknown>;
    traceState: TraceState;
    stepId?: string;
    stepState: StepState;
    toolArgsHash: string;
  }): Promise<BrowserAutomationResult> {
    const { provider, action, params, traceState, toolArgsHash, stepState, stepId } = input;
    const attemptId = this.nextAttemptId(traceState);
    const startedAt = Date.now();

    await this.appendEvent(traceState, stepState, stepId, {
      event: 'start',
      attemptId,
      action,
      provider: provider.name,
      toolArgsHash,
    });

    try {
      const result = await provider.execute(action, params);
      const durationMs = Date.now() - startedAt;

      const screenshot = await this.captureScreenshot(provider, action, params, result);
      if (screenshot) {
        await this.writeScreenshot(traceState, attemptId, screenshot);
      }

      await this.appendEvent(traceState, stepState, stepId, {
        event: 'success',
        attemptId,
        action,
        provider: provider.name,
        toolArgsHash,
        durationMs,
      });
      this.updateSummary(traceState, provider.name, true, action, attemptId);

      return {
        ok: true,
        data: result,
        meta: { provider: provider.name, fallback: null },
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const error = err instanceof Error ? err.message : String(err);

      const screenshot = await this.captureScreenshot(provider, action, params, null).catch(() => null);
      if (screenshot) {
        await this.writeScreenshot(traceState, attemptId, screenshot);
      }

      if (provider.captureSnapshot) {
        try {
          const snapshot = await provider.captureSnapshot({ action, params });
          await this.writeSnapshot(traceState, attemptId, snapshot);
        } catch {
          // Ignore snapshot failures.
        }
      }

      await this.appendEvent(traceState, stepState, stepId, {
        event: 'failure',
        attemptId,
        action,
        provider: provider.name,
        toolArgsHash,
        durationMs,
        reason: this.redactString(error),
      });
      this.updateSummary(traceState, provider.name, false, action, attemptId, error);

      this.writeFailureSummary(traceState.traceId, provider.name, action, error);

      return {
        ok: false,
        error,
        meta: { provider: provider.name, fallback: null },
      };
    }
  }

  private async captureScreenshot(
    provider: BrowserAutomationProvider,
    action: BrowserAutomationAction,
    params: Record<string, unknown>,
    result: unknown,
  ): Promise<ScreenshotPayload | null> {
    if (action === 'screenshot' && this.isScreenshotPayload(result)) {
      return result;
    }
    if (!provider.captureScreenshot) return null;
    const fullPage = params.fullPage === true;
    try {
      return await provider.captureScreenshot(fullPage);
    } catch {
      return null;
    }
  }

  private isScreenshotPayload(value: unknown): value is ScreenshotPayload {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.mime === 'string' && typeof record.dataBase64 === 'string';
  }

  private async ensureTraceState(context: BrowserAutomationContext): Promise<TraceState> {
    const key = context.traceId;
    const existing = this.traceStates.get(key);
    if (existing) return existing;

    const dir = await this.createTraceDir(context.traceId);
    const summary: TraceSummary = {
      traceId: context.traceId,
      attempts: 0,
      successes: 0,
      failures: 0,
      providers: {},
      updatedAt: new Date().toISOString(),
    };

    const state: TraceState = {
      traceId: context.traceId,
      dir,
      attempts: 0,
      summary,
      stepStates: new Map(),
    };

    this.traceStates.set(key, state);
    await this.writeSummary(state);
    return state;
  }

  private getStepState(traceState: TraceState, stepId?: string): StepState {
    const key = stepId || 'default';
    const existing = traceState.stepStates.get(key);
    if (existing) return existing;
    const created: StepState = { stagehandRetryUsed: false, stagehandDisabled: false };
    traceState.stepStates.set(key, created);
    return created;
  }

  private nextAttemptId(traceState: TraceState): string {
    traceState.attempts += 1;
    traceState.summary.attempts += 1;
    return `attempt-${traceState.attempts}`;
  }

  private async logFallback(
    traceState: TraceState,
    stepState: StepState,
    stepId: string | undefined,
    action: BrowserAutomationAction,
    toolArgsHash: string,
    reason: string,
    fallback: 'retry' | 'webview',
  ): Promise<void> {
    await this.appendEvent(traceState, stepState, stepId, {
      event: 'fallback',
      attemptId: `fallback-${traceState.attempts}`,
      action,
      provider: this.stagehandProvider.name,
      toolArgsHash,
      reason: this.redactString(reason),
      fallback,
      stagehandDisabled: stepState.stagehandDisabled,
    });

    if (stepState.stagehandDisabled) {
      await this.appendEvent(traceState, stepState, stepId, {
        event: 'disabled',
        attemptId: `disabled-${traceState.attempts}`,
        action,
        provider: this.stagehandProvider.name,
        toolArgsHash,
      });
    }
  }

  private updateSummary(
    traceState: TraceState,
    providerName: string,
    ok: boolean,
    action: BrowserAutomationAction,
    attemptId: string,
    reason?: string,
  ): void {
    traceState.summary.updatedAt = new Date().toISOString();
    if (!traceState.summary.providers[providerName]) {
      traceState.summary.providers[providerName] = { attempts: 0, successes: 0, failures: 0 };
    }

    const providerSummary = traceState.summary.providers[providerName];
    providerSummary.attempts += 1;
    if (ok) {
      providerSummary.successes += 1;
      traceState.summary.successes += 1;
    } else {
      providerSummary.failures += 1;
      traceState.summary.failures += 1;
    }

    traceState.summary.lastOutcome = {
      provider: providerName,
      ok,
      reason: ok ? undefined : this.redactString(reason || ''),
      action,
      attemptId,
    };

    void this.writeSummary(traceState);
  }

  private async appendEvent(
    traceState: TraceState,
    stepState: StepState,
    stepId: string | undefined,
    event: Record<string, unknown>,
  ): Promise<void> {
    const payload = {
      ts: new Date().toISOString(),
      traceId: traceState.traceId,
      stepId,
      retryUsed: stepState.stagehandRetryUsed,
      stagehandDisabled: stepState.stagehandDisabled,
      ...event,
    };
    const line = JSON.stringify(payload) + '\n';
    try {
      await fs.appendFile(path.join(traceState.dir, 'attempt.jsonl'), line, 'utf-8');
    } catch {
      // Ignore file write failures.
    }
    if (this.systemLogger) {
      this.systemLogger.log('info', `[BrowserAutomation] ${line.trim()}`).catch(() => {
        // Ignore logging failures.
      });
    }
  }

  private async writeSummary(traceState: TraceState): Promise<void> {
    const summaryPath = path.join(traceState.dir, 'summary.json');
    try {
      await fs.writeFile(summaryPath, JSON.stringify(traceState.summary, null, 2), 'utf-8');
    } catch {
      // Ignore summary write failures.
    }
  }

  private async writeScreenshot(traceState: TraceState, attemptId: string, screenshot: ScreenshotPayload): Promise<void> {
    const artifactsDir = path.join(traceState.dir, 'artifacts');
    await fs.mkdir(artifactsDir, { recursive: true });
    const extension = this.extensionForMime(screenshot.mime);
    const filename = `screenshot-${attemptId}.${extension}`;
    const filePath = path.join(artifactsDir, filename);
    const buffer = Buffer.from(screenshot.dataBase64, 'base64');
    try {
      await fs.writeFile(filePath, buffer);
    } catch {
      // Ignore screenshot write failures.
    }
  }

  private async writeSnapshot(traceState: TraceState, attemptId: string, snapshot: HybridSnapshot): Promise<void> {
    const artifactsDir = path.join(traceState.dir, 'artifacts');
    await fs.mkdir(artifactsDir, { recursive: true });
    const filePath = path.join(artifactsDir, `snapshot-${attemptId}.json`);
    const redacted = this.redactSnapshot(snapshot);
    try {
      await fs.writeFile(filePath, JSON.stringify(redacted, null, 2), 'utf-8');
    } catch {
      // Ignore snapshot write failures.
    }
  }

  private extensionForMime(mime: string): string {
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('svg')) return 'svg';
    return 'bin';
  }

  private redactSnapshot(snapshot: HybridSnapshot): HybridSnapshot {
    return this.redactValue(snapshot) as HybridSnapshot;
  }

  private redactValue(value: unknown, keyHint?: string): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactValue(item, keyHint));
    }
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') {
        if (keyHint && this.isUrlKey(keyHint)) {
          return this.redactUrl(value);
        }
      }
      return value;
    }

    const record = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      if (this.isSensitiveKey(key)) {
        redacted[key] = '[REDACTED]';
        continue;
      }
      if (this.isUrlKey(key) && typeof val === 'string') {
        redacted[key] = this.redactUrl(val);
        continue;
      }
      redacted[key] = this.redactValue(val, key);
    }
    return redacted;
  }

  private redactString(value: string): string {
    if (!value) return value;
    return value.replace(/https?:\/\/[^\s]+/g, (url) => this.redactUrl(url));
  }

  private redactUrl(value: string): string {
    try {
      const parsed = new URL(value);
      const keys = Array.from(parsed.searchParams.keys());
      if (!keys.length) {
        return `${parsed.origin}${parsed.pathname}${parsed.hash || ''}`;
      }
      const query = keys.map((key) => `${key}=[REDACTED]`).join('&');
      return `${parsed.origin}${parsed.pathname}?${query}${parsed.hash || ''}`;
    } catch {
      return value;
    }
  }

  private isSensitiveKey(key: string): boolean {
    const lower = key.toLowerCase();
    return lower === 'value' || lower.includes('password') || lower.includes('token') || lower.includes('secret');
  }

  private isUrlKey(key: string): boolean {
    const lower = key.toLowerCase();
    return lower === 'url' || lower === 'href' || lower === 'src';
  }

  private hashParams(params: Record<string, unknown>): string {
    const stable = this.stableStringify(params);
    return createHash('sha256').update(stable).digest('hex').slice(0, 12);
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (!value || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }

  private async createTraceDir(traceId: string): Promise<string> {
    const root = this.resolveLogRoot();
    const date = new Date().toISOString().slice(0, 10);
    const safeTraceId = traceId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join(root, date, safeTraceId);
    await fs.mkdir(path.join(dir, 'artifacts'), { recursive: true });

    await this.pruneOldRuns(root).catch(() => {
      // Ignore prune failures.
    });

    return dir;
  }

  private resolveLogRoot(): string {
    const base = process.env.CLAW_LOG_DIR
      ? path.resolve(process.env.CLAW_LOG_DIR)
      : path.join(os.homedir(), '.clawbrowser', 'workspace', 'logs');
    return path.join(base, 'browser-automation');
  }

  private async pruneOldRuns(root: string): Promise<void> {
    const now = Date.now();
    if (this.lastPruneAt && now - this.lastPruneAt < 60_000) return;
    this.lastPruneAt = now;

    let dateDirs: string[] = [];
    try {
      dateDirs = await fs.readdir(root);
    } catch {
      return;
    }

    const runs: Array<{ path: string; mtimeMs: number }> = [];
    for (const dateDir of dateDirs) {
      const datePath = path.join(root, dateDir);
      let stat;
      try {
        stat = await fs.stat(datePath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      let traceDirs: string[] = [];
      try {
        traceDirs = await fs.readdir(datePath);
      } catch {
        continue;
      }

      for (const traceDir of traceDirs) {
        const tracePath = path.join(datePath, traceDir);
        try {
          const traceStat = await fs.stat(tracePath);
          if (traceStat.isDirectory()) {
            runs.push({ path: tracePath, mtimeMs: traceStat.mtimeMs });
          }
        } catch {
          // Ignore.
        }
      }
    }

    if (runs.length <= this.retentionRuns) return;
    runs.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const toDelete = runs.slice(0, runs.length - this.retentionRuns);
    await Promise.all(toDelete.map((entry) => fs.rm(entry.path, { recursive: true, force: true }).catch(() => {
      // Ignore delete errors.
    })));
  }

  private writeFailureSummary(traceId: string, provider: string, action: string, reason: string): void {
    const message = `[BrowserAutomation] traceId=${traceId} provider=${provider} action=${action} failed: ${this.redactString(reason)}`;
    try {
      process.stderr.write(message + '\n');
    } catch {
      // Ignore stderr failures.
    }
  }
}

export function createBrowserAutomationTraceId(): string {
  return randomUUID();
}
