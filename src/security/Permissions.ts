type PermissionState = 'allow' | 'deny';

type PermissionRecord = {
  domAutomation?: PermissionState;
  updatedAt?: string;
};

type PermissionStore = Record<string, PermissionRecord>;

type DomPromptResult = 'allow-once' | 'allow-always' | 'deny';

export class Permissions {
  private static storageKey = 'claw:permissions';
  private static cache: PermissionStore | null = null;
  private static queue: Promise<void> = Promise.resolve();

  static getOrigin(url?: string): string | null {
    if (!url) return null;
    if (url === 'about:blank') return null;
    try {
      const parsed = new URL(url);
      const origin = parsed.origin;
      if (!origin || origin === 'null') return null;
      return origin;
    } catch {
      return null;
    }
  }

  static requiresPermission(origin: string | null): boolean {
    if (!origin) return false;
    return origin.startsWith('http://') || origin.startsWith('https://');
  }

  static getDomAutomationState(origin: string): PermissionState | 'prompt' {
    const store = this.load();
    const record = store[origin];
    if (!record || !record.domAutomation) return 'prompt';
    return record.domAutomation;
  }

  static async ensureDomAutomation(origin: string): Promise<boolean> {
    const state = this.getDomAutomationState(origin);
    if (state === 'allow') return true;
    if (state === 'deny') return false;

    const result = await this.runExclusive(async () => {
      const current = this.getDomAutomationState(origin);
      if (current === 'allow') return 'allow-always';
      if (current === 'deny') return 'deny';
      return this.promptDomAutomation(origin);
    });
    if (result === 'allow-always') {
      this.setDomAutomationState(origin, 'allow');
      return true;
    }
    if (result === 'deny') {
      this.setDomAutomationState(origin, 'deny');
      return false;
    }
    return result === 'allow-once';
  }

  private static load(): PermissionStore {
    if (this.cache) return this.cache;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        this.cache = JSON.parse(raw) as PermissionStore;
        return this.cache;
      }
    } catch {
      // Ignore parse errors.
    }
    this.cache = {};
    return this.cache;
  }

  private static persist(store: PermissionStore): void {
    this.cache = store;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(store));
    } catch {
      // Ignore storage errors.
    }
  }

  private static setDomAutomationState(origin: string, state: PermissionState): void {
    const store = this.load();
    store[origin] = {
      ...(store[origin] || {}),
      domAutomation: state,
      updatedAt: new Date().toISOString(),
    };
    this.persist(store);
  }

  private static async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release: () => void = () => {};
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private static promptDomAutomation(origin: string): Promise<DomPromptResult> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'permissions-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const card = document.createElement('div');
      card.className = 'permissions-card';

      const title = document.createElement('h3');
      title.className = 'permissions-title';
      title.textContent = 'Allow DOM automation?';

      const message = document.createElement('p');
      message.className = 'permissions-text';
      message.textContent = `ClawBrowser wants to read and interact with ${origin}. This allows clicking, typing, and extracting content on that site.`;

      const actions = document.createElement('div');
      actions.className = 'permissions-actions';

      const allowOnce = document.createElement('button');
      allowOnce.className = 'permissions-btn primary';
      allowOnce.textContent = 'Allow once';

      const allowAlways = document.createElement('button');
      allowAlways.className = 'permissions-btn';
      allowAlways.textContent = 'Always allow';

      const deny = document.createElement('button');
      deny.className = 'permissions-btn danger';
      deny.textContent = 'Block';

      actions.appendChild(allowOnce);
      actions.appendChild(allowAlways);
      actions.appendChild(deny);

      card.appendChild(title);
      card.appendChild(message);
      card.appendChild(actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const cleanup = (result: DomPromptResult) => {
        overlay.remove();
        window.removeEventListener('keydown', onKeyDown, true);
        resolve(result);
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup('deny');
        }
      };

      window.addEventListener('keydown', onKeyDown, true);

      allowOnce.addEventListener('click', () => cleanup('allow-once'));
      allowAlways.addEventListener('click', () => cleanup('allow-always'));
      deny.addEventListener('click', () => cleanup('deny'));

      allowOnce.focus();
    });
  }
}
