import { MatrixBackground } from '../ui/MatrixBackground';
import { Vault } from './Vault';

export class VaultUI {
  private overlay: HTMLElement;
  private vault: Vault;
  private background: MatrixBackground;
  private errorEl!: HTMLElement;
  private passwordInput!: HTMLInputElement;
  private unlockButton!: HTMLButtonElement;
  private missingEl!: HTMLElement;
  private recoverButton!: HTMLButtonElement;
  private encryptedData: string | null = null;
  private onUnlock: (() => void) | null = null;
  private onRecover: (() => void) | null = null;
  private missingVaultData = false;

  constructor(vault: Vault) {
    this.vault = vault;
    this.overlay = this.build();
    this.background = new MatrixBackground(this.overlay);
    document.body.appendChild(this.overlay);

    // Re-show lock screen when vault locks
    if (typeof this.vault.onLock === 'function') {
      this.vault.onLock(() => {
        this.show();
      });
    }
  }

  setOnUnlock(callback: () => void): void {
    this.onUnlock = callback;
  }

  setOnRecover(callback: () => void): void {
    this.onRecover = callback;
  }

  setMissingVaultData(missing: boolean): void {
    this.missingVaultData = missing;
    this.updateMissingState();
  }

  show(): void {
    this.overlay.classList.add('visible');
    this.background.start();
    this.passwordInput.value = '';
    this.errorEl.textContent = '';
    this.updateMissingState();
    if (!this.missingVaultData) {
      this.passwordInput.focus();
    } else if (this.recoverButton) {
      this.recoverButton.focus();
    }
  }

  hide(): void {
    this.overlay.classList.remove('visible');
    this.background.stop();
  }

  private build(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'vault-overlay';

    const card = document.createElement('div');
    card.className = 'vault-card';

    const title = document.createElement('h1');
    title.className = 'vault-title';
    title.textContent = 'ClawBrowser';
    card.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'vault-subtitle';
    subtitle.textContent = 'The smartest child of openclaw. Enter your passphrase to unlock.';
    card.appendChild(subtitle);

    this.missingEl = document.createElement('p');
    this.missingEl.className = 'vault-missing';
    this.missingEl.textContent = 'Vault data not found. Restart setup wizard to create a new vault.';
    card.appendChild(this.missingEl);

    this.passwordInput = document.createElement('input');
    this.passwordInput.type = 'password';
    this.passwordInput.className = 'vault-password';
    this.passwordInput.placeholder = 'Passphrase';
    this.passwordInput.autocomplete = 'current-password';
    this.passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleUnlock();
      }
    });
    card.appendChild(this.passwordInput);

    this.unlockButton = document.createElement('button');
    this.unlockButton.className = 'vault-unlock-btn';
    this.unlockButton.textContent = 'Unlock';
    this.unlockButton.addEventListener('click', () => {
      this.handleUnlock();
    });
    card.appendChild(this.unlockButton);

    this.recoverButton = document.createElement('button');
    this.recoverButton.className = 'vault-recover-btn';
    this.recoverButton.textContent = 'Restart Setup Wizard';
    this.recoverButton.addEventListener('click', () => {
      if (this.onRecover) {
        this.onRecover();
      } else {
        this.errorEl.textContent = 'Recovery unavailable.';
      }
    });
    card.appendChild(this.recoverButton);

    this.errorEl = document.createElement('p');
    this.errorEl.className = 'vault-error';
    card.appendChild(this.errorEl);

    overlay.appendChild(card);
    this.updateMissingState();
    return overlay;
  }

  setEncryptedData(data: string | null): void {
    this.encryptedData = data;
  }

  private updateMissingState(): void {
    if (!this.missingEl || !this.passwordInput || !this.unlockButton || !this.recoverButton || !this.errorEl) {
      return;
    }

    if (this.missingVaultData) {
      this.missingEl.style.display = 'block';
      this.passwordInput.style.display = 'none';
      this.unlockButton.style.display = 'none';
      this.recoverButton.style.display = 'block';
      this.errorEl.textContent = '';
      return;
    }

    this.missingEl.style.display = 'none';
    this.passwordInput.style.display = '';
    this.unlockButton.style.display = '';
    this.recoverButton.style.display = 'none';
  }

  private async handleUnlock(): Promise<void> {
    if (this.missingVaultData) {
      this.errorEl.textContent = 'Vault data missing. Restart setup wizard.';
      return;
    }

    const password = this.passwordInput.value;
    if (!password) {
      this.errorEl.textContent = 'Please enter a password';
      return;
    }

    try {
      const data = this.encryptedData || this.vault.getLastExported();
      if (data) {
        await this.vault.importEncrypted(password, data);
      } else {
        await this.vault.unlock(password);
      }
      this.hide();
      if (this.onUnlock) {
        this.onUnlock();
      }
    } catch (err) {
      this.errorEl.textContent = 'Incorrect password';
      this.passwordInput.value = '';
      this.passwordInput.focus();
    }
  }
}
