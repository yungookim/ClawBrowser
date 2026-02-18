import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatView } from '../../src/agent/ChatView';

describe('ChatView', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('sends message on Enter and clears input', () => {
    const chat = new ChatView(container);
    const onSend = vi.fn();
    chat.setOnSend(onSend);

    const input = container.querySelector('.chat-input') as HTMLTextAreaElement;
    input.value = 'Hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onSend).toHaveBeenCalledWith('Hello');
    expect(input.value).toBe('');
  });

  it('adds messages and manages loading state', () => {
    const chat = new ChatView(container);
    chat.addMessage('user', 'Hi');
    chat.addMessage('agent', 'Hello');

    const userMsg = container.querySelector('.chat-message.user .chat-bubble') as HTMLElement;
    const agentMsg = container.querySelector('.chat-message.agent .chat-bubble') as HTMLElement;
    expect(userMsg.textContent).toBe('Hi');
    expect(agentMsg.textContent).toBe('Hello');

    const loading = container.querySelector('.chat-loading') as HTMLElement;
    const input = container.querySelector('.chat-input') as HTMLTextAreaElement;
    const sendBtn = container.querySelector('.chat-send-btn') as HTMLButtonElement;

    chat.setLoading(true);
    expect(loading.style.display).toBe('block');
    expect(input.disabled).toBe(true);
    expect(sendBtn.disabled).toBe(true);

    chat.setLoading(false);
    expect(loading.style.display).toBe('none');
    expect(input.disabled).toBe(false);
    expect(sendBtn.disabled).toBe(false);
  });
});
