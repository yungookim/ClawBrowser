import { ChatView } from './ChatView';
import { SidecarBridge } from './SidecarBridge';
import { TabManager } from '../tabs/TabManager';

export class AgentPanel {
  private container: HTMLElement;
  private chatView: ChatView;
  private bridge: SidecarBridge;
  private tabManager: TabManager;

  constructor(container: HTMLElement, bridge: SidecarBridge, tabManager: TabManager) {
    this.container = container;
    this.bridge = bridge;
    this.tabManager = tabManager;

    this.chatView = new ChatView(container);
    this.chatView.setOnSend((message) => this.handleUserMessage(message));

    // Listen for sidecar notifications
    this.bridge.onNotification((method, params) => {
      if (method === 'heartbeatPulse') {
        // Could display status indicator
      } else if (method === 'agentReady') {
        this.chatView.addMessage('agent', 'Agent ready.');
      } else if (method === 'reflectionComplete') {
        const summary = (params as { summary?: string }).summary || 'Reflection complete.';
        this.chatView.addMessage('agent', summary);
      }
    });
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
