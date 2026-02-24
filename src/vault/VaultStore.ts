type PlaintextVaultData = {
  entries: Record<string, string>;
};

export class VaultStore {
  private entries: Map<string, string> = new Map();

  async importPlaintext(data: string | null): Promise<void> {
    const entries = this.parsePlaintext(data);
    this.entries = new Map(Object.entries(entries));
  }

  async exportPlaintext(): Promise<string> {
    const entries: Record<string, string> = {};
    for (const [key, value] of this.entries) {
      entries[key] = value;
    }
    return JSON.stringify({ entries });
  }

  async set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  async get(key: string): Promise<string | undefined> {
    return this.entries.get(key);
  }

  private parsePlaintext(data: string | null): Record<string, string> {
    if (!data) return {};
    try {
      const parsed = JSON.parse(data) as PlaintextVaultData;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const entries = parsed.entries;
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {};
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === 'string') {
          normalized[key] = value;
        }
      }
      return normalized;
    } catch {
      return {};
    }
  }
}
