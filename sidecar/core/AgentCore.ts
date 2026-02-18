import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ModelManager } from './ModelManager.js';

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
  private history: BaseMessage[] = [];

  constructor(modelManager: ModelManager) {
    this.modelManager = modelManager;
  }

  /** Build the system prompt from workspace files and current context. */
  private buildSystemPrompt(context: AgentContext): string {
    const parts: string[] = [];

    parts.push('You are Claw, the AI assistant built into ClawBrowser.');
    parts.push('You help the user browse the web, manage tabs, fill forms, and complete tasks.');
    parts.push('You have access to the user\'s browser tabs and can execute actions on their behalf.');
    parts.push('Be concise, helpful, and proactive.');

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
    const model = this.modelManager.createModel('primary');
    if (!model) {
      return { reply: 'No AI model configured. Please set up a model in Settings.' };
    }

    const systemPrompt = this.buildSystemPrompt(context);

    // Add user message to history
    this.history.push(new HumanMessage(context.userQuery));

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
      const response = await model.invoke(messages);
      const reply = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      // Add assistant response to history
      this.history.push(new AIMessage(reply));

      return { reply };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[AgentCore] Model invocation error:', message);
      return { reply: `Error: ${message}` };
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
