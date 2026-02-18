import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultUI } from '../../src/vault/VaultUI';
import type { Vault } from '../../src/vault/Vault';

describe('VaultUI', () => {
  let lockCallback: (() => void) | null = null;
  let vault: Vault & {
    unlock: ReturnType<typeof vi.fn>;
    onLock: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    lockCallback = null;
    vault = {
      unlock: vi.fn().mockResolvedValue(undefined),
      onLock: vi.fn((cb: () => void) => {
        lockCallback = cb;
      }),
    } as any;
  });

  it('shows and hides the overlay', () => {
    new VaultUI(vault);

    const overlay = document.querySelector('.vault-overlay') as HTMLElement;
    expect(overlay.classList.contains('visible')).toBe(true);

    overlay.classList.remove('visible');
    expect(overlay.classList.contains('visible')).toBe(false);

    lockCallback?.();
    expect(overlay.classList.contains('visible')).toBe(true);
  });

  it('validates empty password and shows errors', async () => {
    new VaultUI(vault);
    const overlay = document.querySelector('.vault-overlay') as HTMLElement;
    const input = overlay.querySelector('.vault-password') as HTMLInputElement;
    const button = overlay.querySelector('.vault-unlock-btn') as HTMLButtonElement;
    const errorEl = overlay.querySelector('.vault-error') as HTMLElement;

    input.value = '';
    button.click();
    expect(errorEl.textContent).toContain('Please enter a password');
    expect(vault.unlock).not.toHaveBeenCalled();
  });

  it('unlocks successfully and calls onUnlock handler', async () => {
    const ui = new VaultUI(vault);
    const onUnlock = vi.fn();
    ui.setOnUnlock(onUnlock);

    const overlay = document.querySelector('.vault-overlay') as HTMLElement;
    const input = overlay.querySelector('.vault-password') as HTMLInputElement;
    const button = overlay.querySelector('.vault-unlock-btn') as HTMLButtonElement;

    input.value = 'password123';
    button.click();

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(vault.unlock).toHaveBeenCalledWith('password123');
    expect(overlay.classList.contains('visible')).toBe(false);
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('shows error on unlock failure', async () => {
    vault.unlock.mockRejectedValueOnce(new Error('bad password'));
    new VaultUI(vault);

    const overlay = document.querySelector('.vault-overlay') as HTMLElement;
    const input = overlay.querySelector('.vault-password') as HTMLInputElement;
    const button = overlay.querySelector('.vault-unlock-btn') as HTMLButtonElement;
    const errorEl = overlay.querySelector('.vault-error') as HTMLElement;

    input.value = 'wrong';
    button.click();

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(errorEl.textContent).toContain('Incorrect password');
    expect(input.value).toBe('');
  });
});
