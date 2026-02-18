const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

interface VaultData {
  salt: string; // base64
  entries: Record<string, string>; // key -> encrypted base64
}

export class Vault {
  private cryptoKey: CryptoKey | null = null;
  private salt: Uint8Array | null = null;
  private entries: Map<string, string> = new Map();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimeoutMs: number;
  private onLockCallback: (() => void) | null = null;
  private lastExported: string | null = null;

  constructor(idleTimeoutMs: number = 5 * 60 * 1000) {
    this.idleTimeoutMs = idleTimeoutMs;
  }

  get isUnlocked(): boolean {
    return this.cryptoKey !== null;
  }

  onLock(callback: () => void): void {
    this.onLockCallback = callback;
  }

  async unlock(password: string, existingData?: string): Promise<void> {
    if (existingData) {
      const data: VaultData = JSON.parse(existingData);
      const salt = this.base64ToBytes(data.salt);
      const key = await this.deriveKey(password, salt);

      // Validate by trying to decrypt all entries before committing state
      const decryptedEntries = new Map<string, string>();
      for (const [entryKey, encryptedValue] of Object.entries(data.entries)) {
        const combined = this.base64ToBytes(encryptedValue);
        const iv = combined.slice(0, IV_LENGTH);
        const ciphertext = combined.slice(IV_LENGTH);
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          key,
          ciphertext
        );
        decryptedEntries.set(entryKey, new TextDecoder().decode(decrypted));
      }

      // Only commit state after all decryptions succeed
      this.salt = salt;
      this.cryptoKey = key;
      this.entries = decryptedEntries;
    } else {
      // Fresh vault
      this.salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      this.cryptoKey = await this.deriveKey(password, this.salt);
      this.entries = new Map();
    }

    this.resetIdleTimer();
  }

  lock(): void {
    this.cryptoKey = null;
    this.entries = new Map();
    this.clearIdleTimer();
    if (this.onLockCallback) {
      this.onLockCallback();
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.requireUnlocked();
    this.entries.set(key, value);
    this.resetIdleTimer();
  }

  async get(key: string): Promise<string | undefined> {
    this.requireUnlocked();
    this.resetIdleTimer();
    return this.entries.get(key);
  }

  async encrypt(plaintext: string): Promise<string> {
    this.requireUnlocked();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey!,
      encoded
    );

    // Prepend IV to ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return this.bytesToBase64(combined);
  }

  async decrypt(base64: string): Promise<string> {
    this.requireUnlocked();
    const combined = this.base64ToBytes(base64);
    const iv = combined.slice(0, IV_LENGTH);
    const ciphertext = combined.slice(IV_LENGTH);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey!,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  async exportEncrypted(): Promise<string> {
    this.requireUnlocked();
    const encryptedEntries: Record<string, string> = {};
    for (const [key, value] of this.entries) {
      encryptedEntries[key] = await this.encrypt(value);
    }

    const data: VaultData = {
      salt: this.bytesToBase64(this.salt!),
      entries: encryptedEntries,
    };

    const serialized = JSON.stringify(data);
    this.lastExported = serialized;
    return serialized;
  }

  async importEncrypted(password: string, data: string): Promise<void> {
    await this.unlock(password, data);
    this.lastExported = data;
  }

  getLastExported(): string | null {
    return this.lastExported;
  }

  private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private requireUnlocked(): void {
    if (!this.cryptoKey) {
      throw new Error('Vault is locked');
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.idleTimeoutMs > 0) {
      this.idleTimer = setTimeout(() => {
        this.lock();
      }, this.idleTimeoutMs);
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
