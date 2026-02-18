import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Vault } from '../../src/vault/Vault';

describe('Vault', () => {
  let vault: Vault;

  beforeEach(() => {
    // Disable idle timeout for tests
    vault = new Vault(0);
  });

  it('should start locked', () => {
    expect(vault.isUnlocked).toBe(false);
  });

  it('should unlock with a password', async () => {
    await vault.unlock('test-password');
    expect(vault.isUnlocked).toBe(true);
  });

  it('should lock after calling lock()', async () => {
    await vault.unlock('test-password');
    vault.lock();
    expect(vault.isUnlocked).toBe(false);
  });

  it('should throw when accessing locked vault', async () => {
    await expect(vault.get('key')).rejects.toThrow('Vault is locked');
    await expect(vault.set('key', 'value')).rejects.toThrow('Vault is locked');
  });

  it('should encrypt and decrypt roundtrip', async () => {
    await vault.unlock('my-secret');
    const encrypted = await vault.encrypt('hello world');
    expect(encrypted).not.toBe('hello world');
    const decrypted = await vault.decrypt(encrypted);
    expect(decrypted).toBe('hello world');
  });

  it('should store and retrieve values', async () => {
    await vault.unlock('password123');
    await vault.set('api-key', 'sk-abc123');
    const value = await vault.get('api-key');
    expect(value).toBe('sk-abc123');
  });

  it('should export and reimport encrypted data', async () => {
    await vault.unlock('export-password');
    await vault.set('key1', 'value1');
    await vault.set('key2', 'value2');

    const exported = await vault.exportEncrypted();
    expect(exported).toBeTruthy();

    // Create a new vault and import
    const vault2 = new Vault(0);
    await vault2.importEncrypted('export-password', exported);
    expect(vault2.isUnlocked).toBe(true);
    expect(await vault2.get('key1')).toBe('value1');
    expect(await vault2.get('key2')).toBe('value2');
  });

  it('should reject wrong password on import', async () => {
    await vault.unlock('correct-password');
    await vault.set('secret', 'data');
    const exported = await vault.exportEncrypted();

    const vault2 = new Vault(0);
    await expect(vault2.importEncrypted('wrong-password', exported)).rejects.toThrow();
    expect(vault2.isUnlocked).toBe(false);
  });

  it('should auto-lock after idle timeout', async () => {
    vi.useFakeTimers();
    const timedVault = new Vault(1000); // 1 second timeout
    const lockCallback = vi.fn();
    timedVault.onLock(lockCallback);

    await timedVault.unlock('password');
    expect(timedVault.isUnlocked).toBe(true);

    vi.advanceTimersByTime(1001);
    expect(timedVault.isUnlocked).toBe(false);
    expect(lockCallback).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('should reset idle timer on activity', async () => {
    vi.useFakeTimers();
    const timedVault = new Vault(1000);

    await timedVault.unlock('password');

    // Activity at 500ms should reset the timer
    vi.advanceTimersByTime(500);
    await timedVault.set('key', 'value');

    // At 1200ms from start (700ms after reset), should still be unlocked
    vi.advanceTimersByTime(700);
    expect(timedVault.isUnlocked).toBe(true);

    // At 1600ms from start (1100ms after reset), should be locked
    vi.advanceTimersByTime(400);
    expect(timedVault.isUnlocked).toBe(false);

    vi.useRealTimers();
  });

  it('should invoke lock callback on lock', async () => {
    const callback = vi.fn();
    vault.onLock(callback);

    await vault.unlock('password');
    vault.lock();

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
