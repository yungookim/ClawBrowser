import { applyProviderDefaults, providerRequiresApiKey } from '../shared/providerDefaults';
import modelCatalog from '../shared/modelCatalog.json';
import { Combobox } from '../ui/Combobox';
import { Dropdown } from '../ui/Dropdown';
import { MatrixBackground } from '../ui/MatrixBackground';
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
  combobox: Combobox;
};

const MODEL_CATALOG = modelCatalog as Record<string, string[]>;

export class Wizard {
  private overlay: HTMLElement;
  private vault: Vault;
  private existingVaultData: string | null;
  private background: MatrixBackground;
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
    this.background = new MatrixBackground(this.overlay);
    document.body.appendChild(this.overlay);
  }

  setOnComplete(handler: WizardCompleteHandler): void {
    this.onComplete = handler;
  }

  show(): void {
    this.overlay.classList.add('visible');
    this.background.start();
    this.currentStep = 0;
    this.showStep(0);
  }

  hide(): void {
    this.overlay.classList.remove('visible');
    this.background.stop();
  }

  private build(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'wizard-overlay';

    const container = document.createElement('div');
    container.className = 'wizard-container';

    // Step indicators
    const indicators = document.createElement('div');
    indicators.className = 'wizard-indicators';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'wizard-dot';
      dot.dataset.step = String(i);
      indicators.appendChild(dot);
    }
    container.appendChild(indicators);

    // Build all steps
    this.steps = [
      this.buildWelcomeStep(),
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
    desc.className = 'wizard-desc wizard-tagline';
    desc.textContent = 'The smartest child of openclaw.';
    step.appendChild(desc);

    const btn = document.createElement('button');
    btn.className = 'wizard-btn primary';
    btn.textContent = 'Get Started';
    btn.addEventListener('click', () => this.showStep(1));
    step.appendChild(btn);

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

    const providers = ['openai', 'anthropic', 'groq', 'ollama', 'llamacpp'];
    const providerDropdown = new Dropdown({
      options: providers.map((provider) => ({ value: provider, label: provider })),
      className: 'wizard-control',
      ariaLabel: `${label} provider`,
    });
    section.appendChild(providerDropdown.element);

    const modelCombobox = new Combobox({
      options: [],
      placeholder: 'Model name (select or type)',
      className: 'wizard-control',
      ariaLabel: `${label} model`,
    });
    section.appendChild(modelCombobox.element);

    const providerSelect = providerDropdown.field;
    const modelInput = modelCombobox.field;

    const apiKeyInput = document.createElement('input');
    apiKeyInput.className = 'wizard-input control-input';
    apiKeyInput.type = 'password';
    apiKeyInput.placeholder = 'API key (optional for local models)';
    section.appendChild(apiKeyInput);

    const baseUrlInput = document.createElement('input');
    baseUrlInput.className = 'wizard-input control-input';
    baseUrlInput.type = 'text';
    baseUrlInput.placeholder = 'Base URL (optional for local providers)';
    section.appendChild(baseUrlInput);

    this.modelInputs[role] = {
      provider: providerSelect,
      model: modelInput,
      apiKey: apiKeyInput,
      baseUrl: baseUrlInput,
      combobox: modelCombobox,
    };

    providerSelect.addEventListener('change', () => {
      applyProviderDefaults(this.modelInputs[role], providerSelect.value, { force: true });
      this.updateModelOptions(role);
    });

    applyProviderDefaults(this.modelInputs[role], providerSelect.value, { force: true });
    this.updateModelOptions(role);

    return section;
  }

  private updateModelOptions(role: ModelRole): void {
    const inputs = this.modelInputs[role];
    if (!inputs) return;
    const provider = inputs.provider.value;
    const models = MODEL_CATALOG[provider] || [];
    inputs.combobox.setOptions(models);
  }

  private buildRoleNote(titleText: string, bodyText: string): HTMLElement {
    const note = document.createElement('div');
    note.className = 'wizard-role-note';

    const title = document.createElement('strong');
    title.textContent = titleText;
    note.appendChild(title);

    const body = document.createElement('span');
    body.textContent = bodyText;
    note.appendChild(body);

    return note;
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

    const roleNotes = document.createElement('div');
    roleNotes.className = 'wizard-role-notes';
    roleNotes.appendChild(
      this.buildRoleNote('Primary', 'Main model for most tasks and reasoning.'),
    );
    roleNotes.appendChild(
      this.buildRoleNote('Secondary', 'Backup or specialized model for follow-up work.'),
    );
    roleNotes.appendChild(
      this.buildRoleNote('Subagent', 'Delegate for parallel tasks and subtasks.'),
    );
    step.appendChild(roleNotes);

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
    backBtn.addEventListener('click', () => this.showStep(0));
    btnRow.appendChild(backBtn);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'wizard-btn primary';
    nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', () => {
      const collected = this.collectModels(errorEl);
      if (!collected) return;
      this.models = collected;
      this.showStep(2);
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
    title.textContent = 'Passphrase';
    step.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'wizard-desc';
    desc.textContent = 'Create a passphrase to encrypt your API keys and sensitive data.';
    step.appendChild(desc);

    const pwInput = document.createElement('input');
    pwInput.className = 'wizard-input control-input';
    pwInput.type = 'password';
    pwInput.placeholder = 'Passphrase (min 8 characters)';
    step.appendChild(pwInput);

    const confirmInput = document.createElement('input');
    confirmInput.className = 'wizard-input control-input';
    confirmInput.type = 'password';
    confirmInput.placeholder = 'Confirm passphrase';
    step.appendChild(confirmInput);

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
