type SendHandler = (message: string) => void;

export class ChatView {
  private container: HTMLElement;
  private messageList: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private loadingEl: HTMLElement;
  private modelSelect: HTMLDivElement;
  private modelButton: HTMLButtonElement;
  private modelLabel: HTMLSpanElement;
  private modelMenu: HTMLDivElement;
  private onSend: SendHandler | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.className += ' chat-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'chat-header';
    this.modelSelect = document.createElement('div');
    this.modelSelect.className = 'agent-model-select';

    this.modelButton = document.createElement('button');
    this.modelButton.className = 'agent-model-button';
    this.modelButton.type = 'button';
    this.modelButton.setAttribute('aria-haspopup', 'listbox');
    this.modelButton.setAttribute('aria-expanded', 'false');
    this.modelButton.setAttribute('aria-label', 'Select AI model');

    this.modelLabel = document.createElement('span');
    this.modelLabel.className = 'agent-model-label';
    this.modelLabel.textContent = 'AI Agent';

    const modelCaret = document.createElement('span');
    modelCaret.className = 'agent-model-caret';
    modelCaret.textContent = '\u25BE';

    this.modelButton.appendChild(this.modelLabel);
    this.modelButton.appendChild(modelCaret);
    this.modelSelect.appendChild(this.modelButton);

    this.modelMenu = document.createElement('div');
    this.modelMenu.className = 'agent-model-menu';
    this.modelMenu.setAttribute('role', 'listbox');
    this.modelMenu.setAttribute('aria-label', 'AI model selection');

    const hostedLabel = document.createElement('div');
    hostedLabel.className = 'agent-model-group';
    hostedLabel.textContent = 'Hosted Models';
    this.modelMenu.appendChild(hostedLabel);

    const hostedModels = [
      { id: 'openai-gpt-5-2', label: 'OpenAI GPT-5.2' },
      { id: 'openai-gpt-5-2-pro', label: 'OpenAI GPT-5.2 Pro' },
      { id: 'openai-gpt-5-mini', label: 'OpenAI GPT-5 mini' },
      { id: 'anthropic-claude-opus-4-6', label: 'Anthropic Claude Opus 4.6' },
      { id: 'anthropic-claude-sonnet-4-5', label: 'Anthropic Claude Sonnet 4.5' },
      { id: 'anthropic-claude-haiku-4-5', label: 'Anthropic Claude Haiku 4.5' },
      { id: 'google-gemini-2-5-pro', label: 'Google Gemini 2.5 Pro' },
      { id: 'google-gemini-2-5-flash', label: 'Google Gemini 2.5 Flash' },
      { id: 'google-gemini-2-5-flash-lite', label: 'Google Gemini 2.5 Flash-Lite' },
      { id: 'mistral-large-3', label: 'Mistral Large 3' },
      { id: 'mistral-medium-3-1', label: 'Mistral Medium 3.1' },
    ];

    hostedModels.forEach((model) => {
      const item = document.createElement('button');
      item.className = 'agent-model-item';
      item.type = 'button';
      item.textContent = model.label;
      item.dataset.modelId = model.id;
      item.addEventListener('click', () => {
        this.setModelLabel(model.label);
        this.closeModelMenu();
      });
      this.modelMenu.appendChild(item);
    });

    const localLabel = document.createElement('div');
    localLabel.className = 'agent-model-group';
    localLabel.textContent = 'Locally Hosted';
    this.modelMenu.appendChild(localLabel);

    const localModels = [
      { id: 'local-gpt-oss-120b', label: 'Local: OpenAI gpt-oss-120b' },
      { id: 'local-gpt-oss-20b', label: 'Local: OpenAI gpt-oss-20b' },
      { id: 'local-mistral-small-3-2', label: 'Local: Mistral Small 3.2' },
      { id: 'local-ministral-3-8b', label: 'Local: Ministral 3 8B' },
    ];

    localModels.forEach((model) => {
      const item = document.createElement('button');
      item.className = 'agent-model-item';
      item.type = 'button';
      item.textContent = model.label;
      item.dataset.modelId = model.id;
      item.addEventListener('click', () => {
        this.setModelLabel(model.label);
        this.closeModelMenu();
      });
      this.modelMenu.appendChild(item);
    });

    const customBtn = document.createElement('button');
    customBtn.className = 'agent-model-add';
    customBtn.type = 'button';
    customBtn.textContent = 'Add Custom Model';
    customBtn.addEventListener('click', () => {
      this.closeModelMenu();
    });
    this.modelMenu.appendChild(customBtn);

    this.modelSelect.appendChild(this.modelMenu);
    header.appendChild(this.modelSelect);
    this.container.appendChild(header);

    this.modelButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleModelMenu();
    });

    this.modelMenu.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    document.addEventListener('click', (event) => {
      if (!this.modelSelect.contains(event.target as Node)) {
        this.closeModelMenu();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.closeModelMenu();
      }
    });

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
    this.input.placeholder = 'Get shits done';
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

  focusInput(): void {
    this.input.focus();
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
  }

  private toggleModelMenu(): void {
    const willOpen = !this.modelSelect.classList.contains('open');
    this.modelSelect.classList.toggle('open', willOpen);
    this.modelButton.setAttribute('aria-expanded', String(willOpen));
  }

  private closeModelMenu(): void {
    if (!this.modelSelect.classList.contains('open')) return;
    this.modelSelect.classList.remove('open');
    this.modelButton.setAttribute('aria-expanded', 'false');
  }

  private setModelLabel(label: string): void {
    this.modelLabel.textContent = label;
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
