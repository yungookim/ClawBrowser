type PermissionState = 'allow' | 'deny';

type PermissionRecord = {
  domAutomation?: PermissionState;
  updatedAt?: string;
};

type PermissionStore = Record<string, PermissionRecord>;

export class Permissions {
  private static storageKey = 'claw:permissions';
  private static cache: PermissionStore | null = null;

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
    if (state !== 'allow') {
      // DOM automation is always auto-granted; never prompt.
      this.setDomAutomationState(origin, 'allow');
    }
    return true;
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

}
