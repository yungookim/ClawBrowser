import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceInput } from '../../src/voice/VoiceInput';

describe('VoiceInput', () => {
  const originalSpeechRecognition = (globalThis as any).SpeechRecognition;
  const originalWebkitRecognition = (globalThis as any).webkitSpeechRecognition;

  beforeEach(() => {
    document.body.innerHTML = '';
    Reflect.deleteProperty(globalThis as any, 'SpeechRecognition');
    Reflect.deleteProperty(globalThis as any, 'webkitSpeechRecognition');
  });

  afterEach(() => {
    if (originalSpeechRecognition) {
      (globalThis as any).SpeechRecognition = originalSpeechRecognition;
    } else {
      Reflect.deleteProperty(globalThis as any, 'SpeechRecognition');
    }
    if (originalWebkitRecognition) {
      (globalThis as any).webkitSpeechRecognition = originalWebkitRecognition;
    } else {
      Reflect.deleteProperty(globalThis as any, 'webkitSpeechRecognition');
    }
  });

  it('disables button when speech recognition is not supported', () => {
    const container = document.createElement('div');
    const voice = new VoiceInput(container);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(voice.isSupported()).toBe(false);
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('not supported');
  });

  it('starts recognition and emits transcript', () => {
    let lastInstance: any = null;

    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        lastInstance = this;
      }
    }

    (globalThis as any).SpeechRecognition = MockRecognition;

    const container = document.createElement('div');
    const voice = new VoiceInput(container);
    const onResult = vi.fn();
    voice.setOnResult(onResult);

    voice.start();
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.classList.contains('active')).toBe(true);

    lastInstance.onresult?.({
      resultIndex: 0,
      results: [{
        isFinal: true,
        0: { transcript: ' hello ', confidence: 0.9 },
      }],
    });

    expect(onResult).toHaveBeenCalledWith('hello');

    voice.toggle();
    expect(lastInstance.stop).toHaveBeenCalledTimes(1);
    expect(button.classList.contains('active')).toBe(false);
  });

  it('clears listening state on error/end', () => {
    let lastInstance: any = null;

    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        lastInstance = this;
      }
    }

    (globalThis as any).SpeechRecognition = MockRecognition;

    const container = document.createElement('div');
    const voice = new VoiceInput(container);
    const button = container.querySelector('button') as HTMLButtonElement;

    voice.start();
    expect(button.classList.contains('active')).toBe(true);

    lastInstance.onerror?.({ error: 'network' });
    expect(button.classList.contains('active')).toBe(false);

    voice.start();
    lastInstance.onend?.();
    expect(button.classList.contains('active')).toBe(false);
  });
});
