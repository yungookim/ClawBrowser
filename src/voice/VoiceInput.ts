type VoiceResultHandler = (transcript: string) => void;

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare const webkitSpeechRecognition: {
  new(): SpeechRecognition;
};

export class VoiceInput {
  private recognition: SpeechRecognition | null = null;
  private isListening = false;
  private button: HTMLButtonElement;
  private onResult: VoiceResultHandler | null = null;

  constructor(container: HTMLElement) {
    this.button = document.createElement('button');
    this.button.className = 'nav-btn voice-btn';
    this.button.textContent = '\uD83C\uDF99';
    this.button.title = 'Voice input';

    if (!this.isSupported()) {
      this.button.disabled = true;
      this.button.title = 'Voice input not supported in this browser';
    }

    this.button.addEventListener('click', () => {
      this.toggle();
    });

    container.appendChild(this.button);
  }

  setOnResult(handler: VoiceResultHandler): void {
    this.onResult = handler;
  }

  isSupported(): boolean {
    return 'webkitSpeechRecognition' in globalThis || 'SpeechRecognition' in globalThis;
  }

  toggle(): void {
    if (this.isListening) {
      this.stop();
    } else {
      this.start();
    }
  }

  start(): void {
    if (!this.isSupported() || this.isListening) return;

    const SpeechRecognitionCtor = (globalThis as Record<string, unknown>).SpeechRecognition ||
      (globalThis as Record<string, unknown>).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    this.recognition = new (SpeechRecognitionCtor as { new(): SpeechRecognition })();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.resultIndex];
      if (result && result.isFinal) {
        const transcript = result[0].transcript.trim();
        if (transcript && this.onResult) {
          this.onResult(transcript);
        }
      }
    };

    this.recognition.onerror = () => {
      this.setListening(false);
    };

    this.recognition.onend = () => {
      this.setListening(false);
    };

    this.recognition.start();
    this.setListening(true);
  }

  stop(): void {
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
    this.setListening(false);
  }

  private setListening(listening: boolean): void {
    this.isListening = listening;
    this.button.classList.toggle('active', listening);
  }
}
