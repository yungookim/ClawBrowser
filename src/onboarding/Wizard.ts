import { applyProviderDefaults, providerRequiresApiKey } from '../shared/providerDefaults';
import { Vault } from '../vault/Vault';

export type ModelRole = 'primary' | 'secondary' | 'subagent';

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  role: ModelRole;
}

export interface WizardResult {
  workspacePath: string | null;
  models: Record<ModelRole, ModelConfig | null>;
  password: string;
}

type WizardCompleteHandler = (result: WizardResult) => void;

type ModelInputs = {
  provider: HTMLSelectElement;
  model: HTMLInputElement;
  apiKey: HTMLInputElement;
  baseUrl: HTMLInputElement;
  temperature: HTMLInputElement;
};

export class Wizard {
  private overlay: HTMLElement;
  private vault: Vault;
  private existingVaultData: string | null;
  private currentStep = 0;
  private steps: HTMLElement[] = [];
  private models: Record<ModelRole, ModelConfig | null> = {
    primary: null,
    secondary: null,
    subagent: null,
  };
  private modelInputs: Record<ModelRole, ModelInputs> = {} as Record<ModelRole, ModelInputs>;
  private workspacePath: string | null = null;
  private onComplete: WizardCompleteHandler | null = null;

  constructor(vault: Vault, existingVaultData: string | null = null) {
    this.vault = vault;
    this.existingVaultData = existingVaultData || null;
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

  private buildModelSection(role: ModelRole, label: string, required: boolean): HTMLElement {
    const section = document.createElement('div');
    section.className = 'wizard-model-section';

    const header = document.createElement('div');
    header.className = 'wizard-model-header';
    const title = document.createElement('strong');
    title.textContent = label;
    header.appendChild(title);
    if (required) {
      const badge = document.createElement('span');
      badge.className = 'wizard-badge';
      badge.textContent = 'required';
      header.appendChild(badge);
    }
    section.appendChild(header);

    const providerSelect = document.createElement('select');
    providerSelect.className = 'wizard-input';
    const providers = ['openai', 'anthropic', 'groq', 'ollama', 'llamacpp'];
    for (const p of providers) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      providerSelect.appendChild(opt);
    }
    section.appendChild(providerSelect);

    const modelInput = document.createElement('input');
    modelInput.className = 'wizard-input';
    modelInput.type = 'text';
    modelInput.placeholder = 'Model name (e.g. gpt-5.2)';
    section.appendChild(modelInput);

    const apiKeyInput = document.createElement('input');
    apiKeyInput.className = 'wizard-input';
    apiKeyInput.type = 'password';
    apiKeyInput.placeholder = 'API key (optional for local models)';
    section.appendChild(apiKeyInput);

    const baseUrlInput = document.createElement('input');
    baseUrlInput.className = 'wizard-input';
    baseUrlInput.type = 'text';
    baseUrlInput.placeholder = 'Base URL (optional for local providers)';
    section.appendChild(baseUrlInput);

    const temperatureInput = document.createElement('input');
    temperatureInput.className = 'wizard-input';
    temperatureInput.type = 'number';
    temperatureInput.min = '0';
    temperatureInput.max = '2';
    temperatureInput.step = '0.1';
    temperatureInput.placeholder = 'Temperature (optional)';
    section.appendChild(temperatureInput);

    this.modelInputs[role] = {
      provider: providerSelect,
      model: modelInput,
      apiKey: apiKeyInput,
      baseUrl: baseUrlInput,
      temperature: temperatureInput,
    };

    providerSelect.addEventListener('change', () => {
      applyProviderDefaults(this.modelInputs[role], providerSelect.value, { force: true });
    });

    applyProviderDefaults(this.modelInputs[role], providerSelect.value, { force: true });

    return section;
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
    desc.textContent = 'Configure the primary, secondary, and subagent models.';
    step.appendChild(desc);

    const form = document.createElement('div');
    form.className = 'wizard-model-form';

    form.appendChild(this.buildModelSection('primary', 'Primary model', true));
    form.appendChild(this.buildModelSection('secondary', 'Secondary model', false));
    form.appendChild(this.buildModelSection('subagent', 'Subagent model', false));

    step.appendChild(form);

    const errorEl = document.createElement('p');
    errorEl.className = 'wizard-error';
    step.appendChild(errorEl);

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
      const collected = this.collectModels(errorEl);
      if (!collected) return;
      this.models = collected;
      this.showStep(3);
    });
    btnRow.appendChild(nextBtn);

    step.appendChild(btnRow);
    return step;
  }

  private collectModels(errorEl: HTMLElement): Record<ModelRole, ModelConfig | null> | null {
    errorEl.textContent = '';
    const roles: ModelRole[] = ['primary', 'secondary', 'subagent'];
    const roleLabels: Record<ModelRole, string> = {
      primary: 'Primary',
      secondary: 'Secondary',
      subagent: 'Subagent',
    };
    const result: Record<ModelRole, ModelConfig | null> = {
      primary: null,
      secondary: null,
      subagent: null,
    };

    for (const role of roles) {
      const inputs = this.modelInputs[role];
      if (!inputs) continue;

      const provider = inputs.provider.value.trim();
      const model = inputs.model.value.trim();
      const apiKey = inputs.apiKey.value.trim();
      const baseUrl = inputs.baseUrl.value.trim();
      const temperatureRaw = inputs.temperature.value.trim();
      const temperature = temperatureRaw ? Number(temperatureRaw) : undefined;

      if (role === 'primary' && !model) {
        errorEl.textContent = 'Primary model is required.';
        return null;
      }

      if (!model) {
        result[role] = null;
        continue;
      }

      if (providerRequiresApiKey(provider) && !apiKey) {
        errorEl.textContent = `${roleLabels[role]} model requires an API key for ${provider}.`;
        return null;
      }

      result[role] = {
        provider,
        model,
        apiKey,
        baseUrl: baseUrl || undefined,
        temperature: Number.isFinite(temperature) ? temperature : undefined,
        role,
      };
    }

    return result;
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
        // Unlock vault with existing data if present, otherwise create a fresh vault.
        if (this.existingVaultData) {
          await this.vault.unlock(password, this.existingVaultData);
        } else {
          await this.vault.unlock(password);
        }

        // Store API keys in vault per role
        for (const role of Object.keys(this.models) as ModelRole[]) {
          const model = this.models[role];
          if (model?.apiKey) {
            await this.vault.set(`apikey:${role}`, model.apiKey);
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
