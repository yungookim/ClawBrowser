import { Vault } from '../vault/Vault';

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  primary: boolean;
}

export interface WizardResult {
  workspacePath: string | null;
  models: ModelConfig[];
  password: string;
}

type WizardCompleteHandler = (result: WizardResult) => void;

export class Wizard {
  private overlay: HTMLElement;
  private vault: Vault;
  private currentStep = 0;
  private steps: HTMLElement[] = [];
  private models: ModelConfig[] = [];
  private workspacePath: string | null = null;
  private onComplete: WizardCompleteHandler | null = null;

  constructor(vault: Vault) {
    this.vault = vault;
    this.overlay = this.build();
    document.body.appendChild(this.overlay);
  }

  setOnComplete(handler: WizardCompleteHandler): void {
    this.onComplete = handler;
  }

  show(): void {
    this.overlay.classList.add('visible');
    this.currentStep = 0;
    this.showStep(0);
  }

  hide(): void {
    this.overlay.classList.remove('visible');
  }

  private build(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'wizard-overlay';

    const container = document.createElement('div');
    container.className = 'wizard-container';

    // Step indicators
    const indicators = document.createElement('div');
    indicators.className = 'wizard-indicators';
    for (let i = 0; i < 4; i++) {
      const dot = document.createElement('div');
      dot.className = 'wizard-dot';
      dot.dataset.step = String(i);
      indicators.appendChild(dot);
    }
    container.appendChild(indicators);

    // Build all steps
    this.steps = [
      this.buildWelcomeStep(),
      this.buildWorkspaceStep(),
      this.buildModelStep(),
      this.buildPasswordStep(),
    ];

    for (const step of this.steps) {
      step.style.display = 'none';
      container.appendChild(step);
    }

    overlay.appendChild(container);
    return overlay;
  }

  private showStep(index: number): void {
    this.currentStep = index;
    for (let i = 0; i < this.steps.length; i++) {
      this.steps[i].style.display = i === index ? 'flex' : 'none';
    }
    // Update indicators
    const dots = this.overlay.querySelectorAll('.wizard-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
      dot.classList.toggle('completed', i < index);
    });
  }

  private buildWelcomeStep(): HTMLElement {
    const step = document.createElement('div');
    step.className = 'wizard-step';

    const title = document.createElement('h1');
    title.className = 'wizard-title';
    title.textContent = 'Welcome to ClawBrowser';
    step.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'wizard-desc';
    desc.textContent = 'A lightweight AI-powered browser with persistent memory, multi-model support, and encrypted local storage.';
    step.appendChild(desc);

    const btn = document.createElement('button');
    btn.className = 'wizard-btn primary';
    btn.textContent = 'Get Started';
    btn.addEventListener('click', () => this.showStep(1));
    step.appendChild(btn);

    return step;
  }

  private buildWorkspaceStep(): HTMLElement {
    const step = document.createElement('div');
    step.className = 'wizard-step';

    const title = document.createElement('h2');
    title.className = 'wizard-title';
    title.textContent = 'Workspace Setup';
    step.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'wizard-desc';
    desc.textContent = 'Import an existing workspace folder or start fresh.';
    step.appendChild(desc);

    // Drop zone
    const dropZone = document.createElement('div');
    dropZone.className = 'wizard-dropzone';
    const dropLabel = document.createElement('span');
    dropLabel.textContent = 'Drag and drop a workspace folder here';
    dropZone.appendChild(dropLabel);

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer?.files.length) {
        // In Tauri, dropped files have a path property
        const file = e.dataTransfer.files[0];
        this.workspacePath = (file as File & { path?: string }).path || file.name;
        dropLabel.textContent = `Selected: ${this.workspacePath}`;
      }
    });
    step.appendChild(dropZone);

    const btnRow = document.createElement('div');
    btnRow.className = 'wizard-btn-row';

    const freshBtn = document.createElement('button');
    freshBtn.className = 'wizard-btn secondary';
    freshBtn.textContent = 'Start Fresh';
    freshBtn.addEventListener('click', () => {
      this.workspacePath = null;
      this.showStep(2);
    });
    btnRow.appendChild(freshBtn);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'wizard-btn primary';
    nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', () => this.showStep(2));
    btnRow.appendChild(nextBtn);

    step.appendChild(btnRow);
    return step;
  }

  private buildModelStep(): HTMLElement {
    const step = document.createElement('div');
    step.className = 'wizard-step';

    const title = document.createElement('h2');
    title.className = 'wizard-title';
    title.textContent = 'Model Configuration';
    step.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'wizard-desc';
    desc.textContent = 'Configure at least one AI model provider.';
    step.appendChild(desc);

    // Form
    const form = document.createElement('div');
    form.className = 'wizard-model-form';

    const providerSelect = document.createElement('select');
    providerSelect.className = 'wizard-input';
    const providers = ['openai', 'anthropic', 'groq', 'ollama', 'llamacpp'];
    for (const p of providers) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      providerSelect.appendChild(opt);
    }
    form.appendChild(providerSelect);

    const modelInput = document.createElement('input');
    modelInput.className = 'wizard-input';
    modelInput.type = 'text';
    modelInput.placeholder = 'Model name (e.g. gpt-4o)';
    form.appendChild(modelInput);

    const apiKeyInput = document.createElement('input');
    apiKeyInput.className = 'wizard-input';
    apiKeyInput.type = 'password';
    apiKeyInput.placeholder = 'API key (optional for local models)';
    form.appendChild(apiKeyInput);

    // Model list display
    const modelList = document.createElement('div');
    modelList.className = 'wizard-model-list';

    const addBtn = document.createElement('button');
    addBtn.className = 'wizard-btn secondary';
    addBtn.textContent = 'Add Model';
    addBtn.addEventListener('click', () => {
      const model = modelInput.value.trim();
      const provider = providerSelect.value;
      const apiKey = apiKeyInput.value;

      if (!model) return;

      const config: ModelConfig = {
        provider,
        model,
        apiKey,
        primary: this.models.length === 0,
      };
      this.models.push(config);

      // Update list display
      const entry = document.createElement('div');
      entry.className = 'wizard-model-entry';
      const entryText = document.createElement('span');
      entryText.textContent = `${provider}/${model}${config.primary ? ' (primary)' : ''}`;
      entry.appendChild(entryText);
      modelList.appendChild(entry);

      // Clear inputs
      modelInput.value = '';
      apiKeyInput.value = '';
    });
    form.appendChild(addBtn);
    form.appendChild(modelList);

    step.appendChild(form);

    const btnRow = document.createElement('div');
    btnRow.className = 'wizard-btn-row';

    const backBtn = document.createElement('button');
    backBtn.className = 'wizard-btn secondary';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => this.showStep(1));
    btnRow.appendChild(backBtn);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'wizard-btn primary';
    nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', () => {
      if (this.models.length === 0) {
        // Require at least one model
        return;
      }
      this.showStep(3);
    });
    btnRow.appendChild(nextBtn);

    step.appendChild(btnRow);
    return step;
  }

  private buildPasswordStep(): HTMLElement {
    const step = document.createElement('div');
    step.className = 'wizard-step';

    const title = document.createElement('h2');
    title.className = 'wizard-title';
    title.textContent = 'Master Password';
    step.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'wizard-desc';
    desc.textContent = 'Create a master password to encrypt your API keys and sensitive data.';
    step.appendChild(desc);

    const pwInput = document.createElement('input');
    pwInput.className = 'wizard-input';
    pwInput.type = 'password';
    pwInput.placeholder = 'Master password (min 8 characters)';
    step.appendChild(pwInput);

    const confirmInput = document.createElement('input');
    confirmInput.className = 'wizard-input';
    confirmInput.type = 'password';
    confirmInput.placeholder = 'Confirm password';
    step.appendChild(confirmInput);

    const errorEl = document.createElement('p');
    errorEl.className = 'wizard-error';
    step.appendChild(errorEl);

    const btnRow = document.createElement('div');
    btnRow.className = 'wizard-btn-row';

    const backBtn = document.createElement('button');
    backBtn.className = 'wizard-btn secondary';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => this.showStep(2));
    btnRow.appendChild(backBtn);

    const finishBtn = document.createElement('button');
    finishBtn.className = 'wizard-btn primary';
    finishBtn.textContent = 'Launch ClawBrowser';
    finishBtn.addEventListener('click', async () => {
      const password = pwInput.value;
      const confirm = confirmInput.value;

      if (password.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters';
        return;
      }
      if (password !== confirm) {
        errorEl.textContent = 'Passwords do not match';
        return;
      }

      try {
        // Unlock vault with new password
        await this.vault.unlock(password);

        // Store API keys in vault
        for (const model of this.models) {
          if (model.apiKey) {
            await this.vault.set(`apikey:${model.provider}`, model.apiKey);
          }
        }

        this.hide();

        if (this.onComplete) {
          this.onComplete({
            workspacePath: this.workspacePath,
            models: this.models,
            password,
          });
        }
      } catch (err) {
        errorEl.textContent = 'Failed to initialize vault';
      }
    });
    btnRow.appendChild(finishBtn);

    step.appendChild(btnRow);
    return step;
  }
}
