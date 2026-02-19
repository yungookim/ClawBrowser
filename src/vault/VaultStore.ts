import { Vault } from './Vault';

type PlaintextVaultData = {
  entries: Record<string, string>;
};

export class VaultStore {
  private vault: Vault;
  private plaintextEntries: Map<string, string> = new Map();
  private encryptionEnabled: boolean;
  private encryptedData: string | null = null;

  constructor(vault: Vault, encryptionEnabled: boolean) {
    this.vault = vault;
    this.encryptionEnabled = encryptionEnabled;
  }

  get isUnlocked(): boolean {
    return this.encryptionEnabled ? this.vault.isUnlocked : true;
  }

  get isEncryptionEnabled(): boolean {
    return this.encryptionEnabled;
  }

  setEncryptionEnabled(enabled: boolean): void {
    this.encryptionEnabled = enabled;
  }

  setEncryptedData(data: string | null): void {
    this.encryptedData = data;
  }

  getEncryptedData(): string | null {
    return this.encryptedData;
  }

  async unlockEncrypted(password: string, existingData?: string | null): Promise<void> {
    this.encryptionEnabled = true;
    const data = existingData || undefined;
    if (data) {
      this.encryptedData = data;
    }
    await this.vault.unlock(password, data);
  }

  async importEncrypted(password: string, data: string): Promise<void> {
    this.encryptionEnabled = true;
    this.encryptedData = data;
    await this.vault.importEncrypted(password, data);
  }

  async importPlaintext(data: string | null): Promise<void> {
    const entries = this.parsePlaintext(data);
    this.plaintextEntries = new Map(Object.entries(entries));
  }

  async exportEncrypted(): Promise<string> {
    if (!this.encryptionEnabled) {
      throw new Error('Vault encryption is disabled');
    }
    const encrypted = await this.vault.exportEncrypted();
    this.encryptedData = encrypted;
    return encrypted;
  }

  async exportPlaintext(): Promise<string> {
    if (this.encryptionEnabled) {
      return this.vault.exportPlaintext();
    }
    const entries: Record<string, string> = {};
    for (const [key, value] of this.plaintextEntries) {
      entries[key] = value;
    }
    return JSON.stringify({ entries });
  }

  getPlaintextEntries(): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const [key, value] of this.plaintextEntries) {
      entries[key] = value;
    }
    return entries;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.encryptionEnabled) {
      await this.vault.set(key, value);
      return;
    }
    this.plaintextEntries.set(key, value);
  }

  async get(key: string): Promise<string | undefined> {
    if (this.encryptionEnabled) {
      return this.vault.get(key);
    }
    return this.plaintextEntries.get(key);
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
