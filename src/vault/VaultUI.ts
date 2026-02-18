import { Vault } from './Vault';

export class VaultUI {
  private overlay: HTMLElement;
  private vault: Vault;
  private errorEl!: HTMLElement;
  private passwordInput!: HTMLInputElement;
  private encryptedData: string | null = null;
  private onUnlock: (() => void) | null = null;

  constructor(vault: Vault) {
    this.vault = vault;
    this.overlay = this.build();
    document.body.appendChild(this.overlay);

    // Re-show lock screen when vault locks
    this.vault.onLock(() => {
      this.show();
    });
  }

  setOnUnlock(callback: () => void): void {
    this.onUnlock = callback;
  }

  show(): void {
    this.overlay.classList.add('visible');
    this.passwordInput.value = '';
    this.errorEl.textContent = '';
    this.passwordInput.focus();
  }

  hide(): void {
    this.overlay.classList.remove('visible');
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
    subtitle.textContent = 'Enter your master password to unlock';
    card.appendChild(subtitle);

    this.passwordInput = document.createElement('input');
    this.passwordInput.type = 'password';
    this.passwordInput.className = 'vault-password';
    this.passwordInput.placeholder = 'Master password';
    this.passwordInput.autocomplete = 'current-password';
    this.passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleUnlock();
      }
    });
    card.appendChild(this.passwordInput);

    const unlockBtn = document.createElement('button');
    unlockBtn.className = 'vault-unlock-btn';
    unlockBtn.textContent = 'Unlock';
    unlockBtn.addEventListener('click', () => {
      this.handleUnlock();
    });
    card.appendChild(unlockBtn);

    this.errorEl = document.createElement('p');
    this.errorEl.className = 'vault-error';
    card.appendChild(this.errorEl);

    overlay.appendChild(card);
    return overlay;
  }

  setEncryptedData(data: string | null): void {
    this.encryptedData = data;
  }

  private async handleUnlock(): Promise<void> {
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
