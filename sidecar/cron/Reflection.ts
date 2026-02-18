import cron from 'node-cron';
import { WorkspaceFiles } from '../memory/WorkspaceFiles.js';
import { DailyLog } from '../memory/DailyLog.js';
import { ModelManager } from '../core/ModelManager.js';
import { sendNotification } from '../main.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

const REFLECTION_SYSTEM_PROMPT = `You are the ClawBrowser AI agent performing nightly self-reflection.

Analyze today's interaction log and the current workspace files. Then produce structured updates:

Respond ONLY with a valid JSON object in this exact format:
{
  "soulUpdates": "New observations about communication style and personality preferences to append to SOUL.md",
  "userUpdates": "New facts, preferences, or biographical details about the user to append to USER.md",
  "identityUpdates": "New workflow patterns or role context to append to IDENTITY.md",
  "memories": [
    { "id": "unique-id", "content": "A discrete fact or observation worth remembering", "tags": ["tag1", "tag2"] }
  ],
  "summary": "One-sentence summary of what was learned today"
}

Rules:
- Only include updates that add NEW information not already in the workspace files
- Leave fields as empty strings if nothing new was learned for that file
- memories should be discrete, searchable facts (not full conversation summaries)
- Be concise. Each update field should be 1-3 bullet points at most.
- If today was uneventful, return empty strings and an empty memories array.`;

interface ReflectionOutput {
  soulUpdates: string;
  userUpdates: string;
  identityUpdates: string;
  memories: Array<{ id: string; content: string; tags: string[] }>;
  summary: string;
}

/**
 * Reflection runs at midnight (configurable), reads the daily log and workspace
 * files, sends them to the primary model for analysis, and applies updates to
 * SOUL.md, USER.md, and IDENTITY.md. Also produces new memory entries for qmd indexing.
 */
export class Reflection {
  private workspace: WorkspaceFiles;
  private dailyLog: DailyLog;
  private modelManager: ModelManager;
  private task: cron.ScheduledTask | null = null;
  private onNewMemories: ((memories: ReflectionOutput['memories']) => Promise<void>) | null = null;

  constructor(
    workspace: WorkspaceFiles,
    dailyLog: DailyLog,
    modelManager: ModelManager,
  ) {
    this.workspace = workspace;
    this.dailyLog = dailyLog;
    this.modelManager = modelManager;
  }

  /** Set a callback for when new memories are produced (for qmd indexing). */
  setMemoryHandler(handler: (memories: ReflectionOutput['memories']) => Promise<void>): void {
    this.onNewMemories = handler;
  }

  /** Start the nightly reflection cron job (midnight by default). */
  start(cronExpression: string = '0 0 * * *'): void {
    if (this.task) return;

    this.task = cron.schedule(cronExpression, () => {
      this.reflect().catch(err => {
        console.error('[Reflection] Nightly reflection failed:', err);
      });
    });

    console.error(`[Reflection] Scheduled at: ${cronExpression}`);
  }

  /** Stop the reflection cron job. */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  /** Run a reflection manually (also used by the cron trigger and triggerReflection RPC). */
  async reflect(): Promise<ReflectionOutput | null> {
    console.error('[Reflection] Starting reflection...');

    const model = this.modelManager.createModel('primary');
    if (!model) {
      console.error('[Reflection] No primary model configured, skipping');
      return null;
    }

    // Gather context
    const todayLog = await this.dailyLog.readToday();
    if (!todayLog.trim()) {
      console.error('[Reflection] No daily log entries, skipping');
      return null;
    }

    const workspaceFiles = await this.workspace.loadAll();

    // Build the user message with context
    const contextParts: string[] = [];
    contextParts.push("## Today's Log\n\n" + todayLog);

    for (const [filename, content] of Object.entries(workspaceFiles)) {
      if (filename === 'HEARTBEAT.md' || filename === 'BOOT.md') continue;
      contextParts.push(`## ${filename}\n\n${content}`);
    }

    const userMessage = contextParts.join('\n\n---\n\n');

    try {
      const response = await model.invoke([
        new SystemMessage(REFLECTION_SYSTEM_PROMPT),
        new HumanMessage(userMessage),
      ]);

      const responseText = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      // Parse the JSON response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[Reflection] Model did not return valid JSON');
        return null;
      }

      const output: ReflectionOutput = JSON.parse(jsonMatch[0]);

      // Apply updates
      await this.applyUpdates(output);

      // Emit notification
      sendNotification('reflectionComplete', {
        summary: output.summary,
        memoriesAdded: output.memories.length,
      });

      console.error(`[Reflection] Complete: ${output.summary}`);
      return output;
    } catch (err) {
      console.error('[Reflection] Model invocation failed:', err);
      return null;
    }
  }

  /** Apply reflection output to workspace files. */
  private async applyUpdates(output: ReflectionOutput): Promise<void> {
    const timestamp = new Date().toISOString().split('T')[0];

    if (output.soulUpdates.trim()) {
      await this.workspace.append(
        'SOUL.md',
        `\n\n## Reflection (${timestamp})\n\n${output.soulUpdates}\n`
      );
    }

    if (output.userUpdates.trim()) {
      await this.workspace.append(
        'USER.md',
        `\n\n## Reflection (${timestamp})\n\n${output.userUpdates}\n`
      );
    }

    if (output.identityUpdates.trim()) {
      await this.workspace.append(
        'IDENTITY.md',
        `\n\n## Reflection (${timestamp})\n\n${output.identityUpdates}\n`
      );
    }

    // Index new memories
    if (output.memories.length > 0 && this.onNewMemories) {
      try {
        await this.onNewMemories(output.memories);
      } catch (err) {
        console.error('[Reflection] Failed to index memories:', err);
      }
    }

    // Log the reflection itself
    await this.dailyLog.log(`Nightly reflection: ${output.summary}`);
  }
}
