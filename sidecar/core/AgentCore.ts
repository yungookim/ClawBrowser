import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ModelManager } from './ModelManager.js';
import type { CommandExecutor } from './CommandExecutor.js';
import type { ModelRole } from './ModelManager.js';
import { ToolRegistry, type ParsedToolCall } from './ToolRegistry.js';
import { AgentDispatcher } from './AgentDispatcher.js';

const MAX_HISTORY = 40;
const MAX_TOOL_RESULT_CHARS = 4_000;
const MAX_RECOVERY_RETRIES = 2;

function isRetryable(err: Error): boolean {
  const msg = err.message.toLowerCase();
  if (msg.includes('process exited') || msg.includes('not started') || msg.includes('not configured')) {
    return false;
  }
  return msg.includes('timeout') || msg.includes('rate') || msg.includes('429')
    || msg.includes('503') || msg.includes('500') || msg.includes('failed')
    || msg.includes('econnreset') || msg.includes('econnrefused');
}

/** Compress text for LLM context: collapse whitespace, strip HTML tags, truncate. */
function compressForLLM(text: string, maxLength: number): string {
  let compressed = text.replace(/<[^>]+>/g, ' ');
  compressed = compressed.replace(/\s+/g, ' ').trim();
  if (compressed.length <= maxLength) return compressed;
  return compressed.substring(0, maxLength) + `... [truncated, ${text.length} chars total]`;
}

export interface AgentContext {
  activeTabUrl?: string;
  activeTabTitle?: string;
  tabCount?: number;
  userQuery: string;
  workspaceFiles?: Record<string, string>;
}

export interface AgentResponse {
  reply: string;
}

export interface RouteDecision {
  role: ModelRole;
  complexity: 'simple' | 'complex';
  reason: string;
}

/**
 * AgentCore orchestrates LLM interactions with workspace context
 * and conversation history management.
 */
export class AgentCore {
  private static readonly MAX_SIMPLE_TOOL_ITERATIONS = 5;

  private modelManager: ModelManager;
  private commandExecutor: CommandExecutor | null;
  private toolRegistry: ToolRegistry;
  private dispatcher: AgentDispatcher | null;
  private history: BaseMessage[] = [];

  constructor(
    modelManager: ModelManager,
    commandExecutor?: CommandExecutor,
    toolRegistry?: ToolRegistry,
    dispatcher?: AgentDispatcher,
  ) {
    this.modelManager = modelManager;
    this.commandExecutor = commandExecutor || null;
    this.toolRegistry = toolRegistry || new ToolRegistry();
    this.dispatcher = dispatcher || null;
  }

  /** Build the system prompt from workspace files and current context. */
  private buildSystemPrompt(context: AgentContext): string {
    const parts: string[] = [];

    parts.push('You are Claw, the AI assistant built into ClawBrowser.');
    parts.push('You help the user browse the web, manage tabs, fill forms, and complete tasks.');
    parts.push('You have access to the user\'s browser tabs and can execute actions on their behalf.');
    parts.push('Be concise, helpful, and proactive.');
    parts.push('If you need to perform an action, respond ONLY with a single JSON tool call.');
    parts.push('Format: {"tool":"<tool-name>","params":{...}}');
    parts.push('Terminal: {"tool":"terminalExec","command":"<command>","args":["arg1","arg2"],"cwd":"/path/optional"}');
    parts.push('Available tools:');
    parts.push(this.toolRegistry.describeTools());
    parts.push('Only use allowlisted commands such as codex or claude code.');

    if (context.workspaceFiles) {
      for (const [filename, content] of Object.entries(context.workspaceFiles)) {
        if (content.trim()) {
          parts.push(`\n--- ${filename} ---\n${content}`);
        }
      }
    }

    if (context.activeTabUrl) {
      parts.push(`\nCurrent tab: ${context.activeTabTitle || 'Untitled'} (${context.activeTabUrl})`);
    }
    if (context.tabCount !== undefined) {
      parts.push(`Open tabs: ${context.tabCount}`);
    }

    return parts.join('\n');
  }

  /** Process a user query and return the agent's response. */
  async query(context: AgentContext): Promise<AgentResponse> {
    const systemPrompt = this.buildSystemPrompt(context);
    const route = await this.classifyAndRoute(context);
    const model = this.pickModel(route.role);
    if (!model) {
      return { reply: 'No AI model configured. Please set up a model in Settings.' };
    }

    // Add user message to history
    const userMessage = new HumanMessage(context.userQuery);
    this.history.push(userMessage);

    // Trim history if too long
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }

    // Build messages array
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...this.history,
    ];

    try {
      const reply = await this.invokeWithTools(model, messages);
      this.history.push(new AIMessage(reply));
      return { reply };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[AgentCore] Model invocation error:', message);
      return { reply: `Error: ${message}` };
    }
  }

  private pickModel(role: ModelRole): ReturnType<ModelManager['createModel']> {
    if (role === 'secondary') {
      return this.modelManager.createModel('secondary') || this.modelManager.createModel('primary');
    }
    if (role === 'subagent') {
      return this.modelManager.createModel('subagent') || this.modelManager.createModel('primary');
    }
    return this.modelManager.createModel('primary');
  }

  async classifyAndRoute(context: AgentContext): Promise<RouteDecision> {
    const defaultDecision: RouteDecision = { role: 'primary', complexity: 'simple', reason: 'fallback' };

    const router = this.modelManager.createModel('primary');
    if (!router) return defaultDecision;

    const routingPrompt = [
      'You are a router that classifies user requests and selects the best model.',
      '',
      'Determine TWO things:',
      '1. Which model role should handle the request: primary, secondary, or subagent.',
      '   - primary: main chat, planning, general reasoning.',
      '   - secondary: fast, cheap, simple queries (greetings, single facts, quick lookups).',
      '   - subagent: hard or expensive tasks needing depth.',
      '',
      '2. The complexity of the request: simple or complex.',
      '   - simple: single action or direct answer. Examples:',
      '     "What time is it?" — direct factual question',
      '     "Open a new tab" — single browser action',
      '     "Close this tab" — single browser action',
      '     "What is the title of this page?" — direct lookup',
      '   - complex: needs multiple sequential browser actions, research, or multi-page browsing. Examples:',
      '     "Compare prices of X across Amazon, Best Buy, and B&H" — multi-site research',
      '     "Find and summarize the top 5 articles about AI" — multi-page browsing + synthesis',
      '     "Fill out this form with my info, then submit and screenshot the confirmation" — multi-step workflow',
      '     "Research competitors and create a comparison table" — research + generation',
      '',
      'Respond ONLY with JSON: {"role":"primary|secondary|subagent","complexity":"simple|complex","reason":"..."}',
    ].join('\n');

    const contextBits = [
      context.activeTabTitle ? `Active tab: ${context.activeTabTitle}` : '',
      context.activeTabUrl ? `Active URL: ${context.activeTabUrl}` : '',
      context.tabCount !== undefined ? `Open tabs: ${context.tabCount}` : '',
      `User query: ${context.userQuery}`,
    ].filter(Boolean).join('\n');

    try {
      const response = await router.invoke([
        new SystemMessage(routingPrompt),
        new HumanMessage(contextBits),
      ]);
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
      const parsed = this.safeJsonParse(content);
      const role = parsed?.role as ModelRole | undefined;
      const complexity = parsed?.complexity as 'simple' | 'complex' | undefined;
      const reason = parsed?.reason as string | undefined;

      if ((role === 'primary' || role === 'secondary' || role === 'subagent')
        && (complexity === 'simple' || complexity === 'complex')) {
        return { role, complexity, reason: reason || '' };
      }
    } catch (err) {
      console.error('[AgentCore] Routing error:', err);
    }
    return defaultDecision;
  }

  private async invokeWithRecovery(
    model: NonNullable<ReturnType<ModelManager['createModel']>>,
    messages: BaseMessage[],
    operation: string,
  ): Promise<{ content: string }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RECOVERY_RETRIES; attempt++) {
      try {
        const response = await model.invoke(messages);
        const content = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
        return { content };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;

        if (!isRetryable(error) || attempt >= MAX_RECOVERY_RETRIES) {
          throw error;
        }

        console.error(`[AgentCore] Retryable error on ${operation} (attempt ${attempt + 1}/${MAX_RECOVERY_RETRIES}): ${error.message}`);

        // Inject error context so the LLM can adapt
        messages = [
          ...messages,
          new HumanMessage(
            `The previous model call failed: ${error.message}. Adjust your approach — try a simpler action or different tool.`
          ),
        ];
      }
    }

    throw lastError || new Error('Recovery exhausted');
  }

  private async invokeWithTools(
    model: NonNullable<ReturnType<ModelManager['createModel']>>,
    messages: BaseMessage[],
  ): Promise<string> {
    let currentMessages = [...messages];
    let lastContent = '';

    for (let i = 0; i < AgentCore.MAX_SIMPLE_TOOL_ITERATIONS; i++) {
      const { content } = await this.invokeWithRecovery(model, currentMessages, `invokeWithTools iteration ${i}`);
      lastContent = content;

      const toolCall = this.toolRegistry.parseToolCall(content);
      if (!toolCall) {
        return content;
      }

      const toolResult = await this.executeToolCall(toolCall);

      currentMessages = [
        ...currentMessages,
        new AIMessage(content),
        new HumanMessage(compressForLLM(JSON.stringify(toolResult), MAX_TOOL_RESULT_CHARS)),
      ];
    }

    // Max iterations reached — return whatever the LLM last said
    return lastContent;
  }

  private async executeToolCall(toolCall: ParsedToolCall): Promise<{
    tool: string;
    ok: boolean;
    data?: unknown;
    error?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  }> {
    if (toolCall.kind === 'invalid') {
      return { tool: toolCall.tool || 'unknown', ok: false, error: toolCall.error };
    }

    if (toolCall.kind === 'terminal') {
      if (!this.commandExecutor) {
        return { tool: toolCall.tool, ok: false, error: 'Tool execution unavailable.' };
      }
      try {
        const result = await this.commandExecutor.execute(toolCall.command, toolCall.args, toolCall.cwd);
        return { tool: toolCall.tool, ok: result.exitCode === 0, ...result };
      } catch (err) {
        return { tool: toolCall.tool, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    if (!this.dispatcher) {
      return { tool: toolCall.tool, ok: false, error: 'Agent tool dispatcher unavailable.' };
    }

    try {
      const result = await this.dispatcher.request({
        capability: toolCall.capability,
        action: toolCall.action,
        params: toolCall.params,
        destructive: toolCall.destructive,
      });
      if (result.ok) {
        return { tool: toolCall.tool, ok: true, data: result.data };
      }
      return { tool: toolCall.tool, ok: false, error: result.error?.message || 'Agent action failed' };
    } catch (err) {
      return { tool: toolCall.tool, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private safeJsonParse(content: string): Record<string, unknown> | null {
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Clear conversation history. */
  clearHistory(): void {
    this.history = [];
  }

  /** Get current history length. */
  getHistoryLength(): number {
    return this.history.length;
  }
}
