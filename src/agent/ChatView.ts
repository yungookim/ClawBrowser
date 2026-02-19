type SendHandler = (message: string) => void;

export class ChatView {
  private container: HTMLElement;
  private messageList: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private loadingEl: HTMLElement;
  private onSend: SendHandler | null = null;
  private activePlan: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.className += ' chat-panel';

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

    const timestamp = document.createElement('div');
    timestamp.className = 'chat-timestamp';
    timestamp.textContent = this.formatTimestamp(new Date());
    msgEl.appendChild(timestamp);

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

  addPlanMessage(steps: string[]): void {
    const planEl = document.createElement('div');
    planEl.className = 'chat-plan';

    steps.forEach((step, i) => {
      const stepEl = document.createElement('div');
      stepEl.className = 'chat-plan-step pending';
      stepEl.dataset.stepIndex = String(i);

      const indicator = document.createElement('span');
      indicator.className = 'step-indicator';
      indicator.textContent = `${i + 1}.`;
      stepEl.appendChild(indicator);

      const label = document.createElement('span');
      label.className = 'step-label';
      label.textContent = step;
      stepEl.appendChild(label);

      planEl.appendChild(stepEl);
    });

    this.messageList.appendChild(planEl);
    this.messageList.scrollTop = this.messageList.scrollHeight;
    this.activePlan = planEl;
  }

  updateStepStatus(index: number, status: 'pending' | 'active' | 'done' | 'error'): void {
    if (!this.activePlan) return;
    const step = this.activePlan.querySelector(`[data-step-index="${index}"]`) as HTMLElement | null;
    if (!step) return;
    step.classList.remove('pending', 'active', 'done', 'error');
    step.classList.add(status);
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  replacePlan(newSteps: string[], startIndex: number): void {
    if (!this.activePlan) return;

    // Remove steps from startIndex onward
    const toRemove = this.activePlan.querySelectorAll(`[data-step-index]`);
    toRemove.forEach((el) => {
      const idx = parseInt((el as HTMLElement).dataset.stepIndex || '0', 10);
      if (idx >= startIndex) {
        el.remove();
      }
    });

    // Append new steps starting from startIndex
    newSteps.forEach((step, i) => {
      const stepIdx = startIndex + i;
      const stepEl = document.createElement('div');
      stepEl.className = 'chat-plan-step pending';
      stepEl.dataset.stepIndex = String(stepIdx);

      const indicator = document.createElement('span');
      indicator.className = 'step-indicator';
      indicator.textContent = `${stepIdx + 1}.`;
      stepEl.appendChild(indicator);

      const label = document.createElement('span');
      label.className = 'step-label';
      label.textContent = step;
      stepEl.appendChild(label);

      this.activePlan!.appendChild(stepEl);
    });

    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  addToolActivity(stepIndex: number, toolName: string, brief: string): void {
    if (!this.activePlan) return;
    const step = this.activePlan.querySelector(`[data-step-index="${stepIndex}"]`) as HTMLElement | null;
    if (!step) return;

    const activity = document.createElement('div');
    activity.className = 'chat-tool-activity';
    activity.textContent = `> ${toolName}: ${brief}`;
    step.appendChild(activity);
    this.messageList.scrollTop = this.messageList.scrollHeight;
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

  private formatTimestamp(date: Date): string {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
