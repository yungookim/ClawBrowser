import { ChatView } from './ChatView';
import { MemoryPanel } from './MemoryPanel';
import { SidecarBridge } from './SidecarBridge';
import { TabManager } from '../tabs/TabManager';

export class AgentPanel {
  private container: HTMLElement;
  private chatView: ChatView;
  private memoryPanel: MemoryPanel;
  private bridge: SidecarBridge;
  private tabManager: TabManager;

  constructor(container: HTMLElement, bridge: SidecarBridge, tabManager: TabManager) {
    this.container = container;
    this.bridge = bridge;
    this.tabManager = tabManager;

    this.chatView = new ChatView(container);
    this.chatView.setOnSend((message) => this.handleUserMessage(message));

    // Header with memory toggle above the chat view
    const panelHeader = document.createElement('div');
    panelHeader.className = 'agent-panel-header';

    const memoryBtn = document.createElement('button');
    memoryBtn.className = 'agent-panel-memory-btn';
    memoryBtn.textContent = '\u2605 Memory';
    memoryBtn.title = 'Toggle memory panel';
    panelHeader.appendChild(memoryBtn);
    this.container.insertBefore(panelHeader, this.container.firstChild);

    const memoryContainer = document.createElement('div');
    this.container.insertBefore(memoryContainer, panelHeader.nextSibling);
    this.memoryPanel = new MemoryPanel(memoryContainer, this.bridge);

    memoryBtn.addEventListener('click', () => this.memoryPanel.toggle());

    // Listen for sidecar notifications
    this.bridge.onNotification((method, params) => {
      if (method === 'heartbeatPulse') {
        // Could display status indicator
      } else if (method === 'agentReady') {
        this.chatView.addMessage('agent', 'Agent ready.');
      } else if (method === 'reflectionComplete') {
        const summary = (params as { summary?: string }).summary || 'Reflection complete.';
        this.chatView.addMessage('agent', summary);
      } else if (method === 'swarmPlanReady') {
        const { steps } = params as { steps: string[]; task: string };
        this.chatView.addPlanMessage(steps);
      } else if (method === 'swarmStepStarted') {
        const { stepIndex } = params as { stepIndex: number };
        this.chatView.updateStepStatus(stepIndex, 'active');
      } else if (method === 'swarmToolExecuted') {
        const { stepIndex, tool, ok } = params as { stepIndex: number; tool: string; ok: boolean };
        this.chatView.addToolActivity(stepIndex, tool, ok ? 'ok' : 'failed');
      } else if (method === 'swarmStepCompleted') {
        const { stepIndex } = params as { stepIndex: number };
        this.chatView.updateStepStatus(stepIndex, 'done');
      } else if (method === 'swarmReplan') {
        const { newPlan, previousPlan } = params as { newPlan: string[]; previousPlan: string[]; newSteps: string[] };
        // The completed steps are preserved; replace from the first changed index onward
        const startIndex = previousPlan.findIndex((step, i) => newPlan[i] !== step);
        const replaceFrom = startIndex >= 0 ? startIndex : previousPlan.length;
        this.chatView.replacePlan(newPlan.slice(replaceFrom), replaceFrom);
      } else if (method === 'swarmComplete') {
        // Final result comes via the agentQuery response, nothing special needed here
      } else if (method === 'memoryStored') {
        const { fact } = params as { fact: string; id: string };
        this.chatView.addMemoryChip(fact);
      } else if (method === 'swarmRecoveryAttempted') {
        const { operation, error, attempt, maxRetries } = params as {
          operation: string;
          error: string;
          attempt: number;
          maxRetries: number;
        };
        this.chatView.addMessage('agent', `Retrying ${operation} (attempt ${attempt}/${maxRetries}): ${error}`);
      }
    });
  }

  focusPrompt(): void {
    this.chatView.focusInput();
  }

  private async handleUserMessage(message: string): Promise<void> {
    this.chatView.addMessage('user', message);
    this.chatView.setLoading(true);

    try {
      const activeTab = this.tabManager.getActiveTab();
      const tabs = this.tabManager.getTabs();

      const reply = await this.bridge.agentQuery(
        message,
        activeTab?.url,
        activeTab?.title,
        tabs.length
      );

      this.chatView.addMessage('agent', reply);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.chatView.addMessage('agent', `Error: ${errorMsg}`);
    } finally {
      this.chatView.setLoading(false);
    }
  }
}
