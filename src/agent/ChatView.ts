type SendHandler = (message: string) => void;

export class ChatView {
  private container: HTMLElement;
  private messageList: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private loadingEl: HTMLElement;
  private onSend: SendHandler | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.className += ' chat-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'chat-header';
    const headerTitle = document.createElement('span');
    headerTitle.textContent = 'AI Agent';
    header.appendChild(headerTitle);
    this.container.appendChild(header);

    // Message list (scrollable)
    this.messageList = document.createElement('div');
    this.messageList.className = 'chat-messages';
    this.container.appendChild(this.messageList);

    // Loading indicator
    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'chat-loading';
    this.loadingEl.textContent = 'Thinking...';
    this.loadingEl.style.display = 'none';
    this.container.appendChild(this.loadingEl);

    // Input area
    const inputArea = document.createElement('div');
    inputArea.className = 'chat-input-area';

    this.input = document.createElement('textarea');
    this.input.className = 'chat-input';
    this.input.placeholder = 'Ask the AI agent...';
    this.input.rows = 1;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
    this.input.addEventListener('input', () => {
      // Auto-resize
      this.input.style.height = 'auto';
      this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
    });
    inputArea.appendChild(this.input);

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'chat-send-btn';
    this.sendBtn.textContent = '\u2191';
    this.sendBtn.title = 'Send';
    this.sendBtn.addEventListener('click', () => this.handleSend());
    inputArea.appendChild(this.sendBtn);

    this.container.appendChild(inputArea);
  }

  setOnSend(handler: SendHandler): void {
    this.onSend = handler;
  }

  addMessage(role: 'user' | 'agent', content: string): void {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = content;
    msgEl.appendChild(bubble);

    this.messageList.appendChild(msgEl);
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  setLoading(loading: boolean): void {
    this.loadingEl.style.display = loading ? 'block' : 'none';
    this.input.disabled = loading;
    this.sendBtn.disabled = loading;
  }

  private handleSend(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.input.style.height = 'auto';
    if (this.onSend) {
      this.onSend(text);
    }
  }
}
