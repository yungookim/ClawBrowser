import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ModelManager } from './ModelManager.js';
import type { CommandExecutor } from './CommandExecutor.js';
import type { ModelRole } from './ModelManager.js';

const MAX_HISTORY = 40;

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

/**
 * AgentCore orchestrates LLM interactions with workspace context
 * and conversation history management.
 */
export class AgentCore {
  private modelManager: ModelManager;
  private commandExecutor: CommandExecutor | null;
  private history: BaseMessage[] = [];

  constructor(modelManager: ModelManager, commandExecutor?: CommandExecutor) {
    this.modelManager = modelManager;
    this.commandExecutor = commandExecutor || null;
  }

  /** Build the system prompt from workspace files and current context. */
  private buildSystemPrompt(context: AgentContext): string {
    const parts: string[] = [];

    parts.push('You are Claw, the AI assistant built into ClawBrowser.');
    parts.push('You help the user browse the web, manage tabs, fill forms, and complete tasks.');
    parts.push('You have access to the user\'s browser tabs and can execute actions on their behalf.');
    parts.push('Be concise, helpful, and proactive.');
    parts.push('If you need to run a terminal command, respond ONLY with JSON:');
    parts.push('{"tool":"terminalExec","command":"<command>","args":["arg1","arg2"],"cwd":"/path/optional"}');
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
    const role = await this.selectRole(systemPrompt, context);
    const model = this.pickModel(role);
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

  private async selectRole(systemPrompt: string, context: AgentContext): Promise<ModelRole> {
    const router = this.modelManager.createModel('primary');
    if (!router) return 'primary';

    const routingPrompt = [
      'You are a router that selects which model should handle the request.',
      'Choose one of: primary, secondary, subagent.',
      '- primary: main chat, planning, general reasoning.',
      '- secondary: fast, cheap, simple queries.',
      '- subagent: hard or expensive tasks needing depth.',
      'Respond ONLY with JSON: {"role":"primary|secondary|subagent","reason":"..."}',
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
        new HumanMessage(contextBits || systemPrompt),
      ]);
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
      const parsed = this.safeJsonParse(content);
      const role = parsed?.role as ModelRole | undefined;
      if (role === 'primary' || role === 'secondary' || role === 'subagent') {
        return role;
      }
    } catch (err) {
      console.error('[AgentCore] Routing error:', err);
    }
    return 'primary';
  }

  private async invokeWithTools(
    model: NonNullable<ReturnType<ModelManager['createModel']>>,
    messages: BaseMessage[],
  ): Promise<string> {
    const response = await model.invoke(messages);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    const toolCall = this.parseToolCall(content);
    if (!toolCall) {
      return content;
    }

    if (!this.commandExecutor) {
      return 'Tool execution unavailable.';
    }

    let toolResult: { ok: boolean; exitCode?: number; stdout?: string; stderr?: string; error?: string };
    try {
      const result = await this.commandExecutor.execute(toolCall.command, toolCall.args, toolCall.cwd);
      toolResult = { ok: result.exitCode === 0, ...result };
    } catch (err) {
      toolResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const followUp = await model.invoke([
      ...messages,
      new AIMessage(content),
      new SystemMessage('Tool result (do not call tools again):'),
      new HumanMessage(JSON.stringify(toolResult)),
    ]);

    return typeof followUp.content === 'string'
      ? followUp.content
      : JSON.stringify(followUp.content);
  }

  private parseToolCall(content: string): { command: string; args: string[]; cwd?: string } | null {
    const parsed = this.safeJsonParse(content);
    if (!parsed || parsed.tool !== 'terminalExec') return null;
    if (typeof parsed.command !== 'string') return null;
    const args = Array.isArray(parsed.args) ? parsed.args.map((arg: unknown) => String(arg)) : [];
    const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : undefined;
    return { command: parsed.command, args, cwd };
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
