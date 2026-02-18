import cron from 'node-cron';
import { WorkspaceFiles } from '../memory/WorkspaceFiles.js';
import { sendNotification } from '../main.js';

export interface HeartbeatState {
  lastPulse: string;
  uptime: number;
  activeTabs: number;
  activeTabTitle: string;
  currentContext: string;
  pendingActions: string[];
}

/**
 * Heartbeat pulses every 60 seconds, writes current state to HEARTBEAT.md,
 * and emits a heartbeatPulse notification via JSON-RPC stdout.
 */
export class Heartbeat {
  private workspace: WorkspaceFiles;
  private task: cron.ScheduledTask | null = null;
  private startTime: number;
  private state: HeartbeatState;

  constructor(workspace: WorkspaceFiles) {
    this.workspace = workspace;
    this.startTime = Date.now();
    this.state = {
      lastPulse: new Date().toISOString(),
      uptime: 0,
      activeTabs: 0,
      activeTabTitle: 'none',
      currentContext: 'idle',
      pendingActions: [],
    };
  }

  /** Start the heartbeat cron job (every 60 seconds). */
  start(): void {
    if (this.task) return;

    // Run immediately on start
    this.pulse();

    // Then every 60 seconds
    this.task = cron.schedule('* * * * *', () => {
      this.pulse();
    });

    console.error('[Heartbeat] Started (60s interval)');
  }

  /** Stop the heartbeat cron job. */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  /** Update the heartbeat state with new tab information. */
  updateTabState(activeTabs: number, activeTabTitle: string): void {
    this.state.activeTabs = activeTabs;
    this.state.activeTabTitle = activeTabTitle;
  }

  /** Update the current context description. */
  updateContext(context: string): void {
    this.state.currentContext = context;
  }

  /** Add a pending action. */
  addPendingAction(action: string): void {
    this.state.pendingActions.push(action);
  }

  /** Remove a pending action. */
  removePendingAction(action: string): void {
    this.state.pendingActions = this.state.pendingActions.filter(a => a !== action);
  }

  /** Execute a single heartbeat pulse. */
  private async pulse(): Promise<void> {
    const now = new Date();
    this.state.lastPulse = now.toISOString();
    this.state.uptime = Math.floor((Date.now() - this.startTime) / 1000);

    // Write HEARTBEAT.md
    await this.writeHeartbeatFile();

    // Emit notification via stdout
    sendNotification('heartbeatPulse', {
      lastPulse: this.state.lastPulse,
      activeTabs: this.state.activeTabs,
      currentContext: this.state.currentContext,
      pendingActions: this.state.pendingActions,
    });
  }

  /** Write the current state to HEARTBEAT.md. */
  private async writeHeartbeatFile(): Promise<void> {
    const uptimeStr = this.formatUptime(this.state.uptime);
    const pendingList = this.state.pendingActions.length > 0
      ? this.state.pendingActions.map(a => `- ${a}`).join('\n')
      : '<!-- No pending actions -->';

    const content = `# Heartbeat

## Last Pulse

- **Timestamp:** ${this.state.lastPulse}
- **Uptime:** ${uptimeStr}

## Active State

- **Tab Count:** ${this.state.activeTabs}
- **Active Tab:** ${this.state.activeTabTitle}
- **Current Context:** ${this.state.currentContext}

## Pending Actions

${pendingList}
`;

    try {
      await this.workspace.write('HEARTBEAT.md', content);
    } catch (err) {
      console.error('[Heartbeat] Failed to write HEARTBEAT.md:', err);
    }
  }

  /** Get current heartbeat state. */
  getState(): HeartbeatState {
    return { ...this.state };
  }

  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }
}
