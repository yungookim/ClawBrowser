import { applyProviderDefaults, providerRequiresApiKey } from '../shared/providerDefaults';
import modelCatalog from '../shared/modelCatalog.json';
import { Combobox } from '../ui/Combobox';
import { Dropdown } from '../ui/Dropdown';
import { MatrixBackground } from '../ui/MatrixBackground';
import { Vault } from '../vault/Vault';
import { DEFAULT_AGENT_CONTROL, type AgentControlSettings } from '../agent/types';

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
  agentControl: AgentControlSettings;
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

type AgentControlInputs = {
  enabled: HTMLInputElement;
  mode: HTMLSelectElement;
  autoGrantOrigins: HTMLInputElement;
  autoGrantPagePermissions: HTMLInputElement;
  allowTerminal: HTMLInputElement;
  allowFilesystem: HTMLInputElement;
  filesystemScope: HTMLSelectElement;
  allowCookies: HTMLInputElement;
  allowLocalStorage: HTMLInputElement;
  allowCredentials: HTMLInputElement;
  allowDownloads: HTMLInputElement;
  allowFileDialogs: HTMLInputElement;
  clipboardAccess: HTMLSelectElement;
  allowWindowControl: HTMLInputElement;
  allowDevtools: HTMLInputElement;
  destructiveConfirm: HTMLSelectElement;
  actionLogDetail: HTMLSelectElement;
  actionLogRetention: HTMLInputElement;
  actionLogEnabled: HTMLInputElement;
  statusIndicator: HTMLInputElement;
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
  private agentControl: AgentControlSettings = DEFAULT_AGENT_CONTROL;
  private agentControlInputs: AgentControlInputs | null = null;
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
      this.buildModelStep(),
      this.buildAgentControlStep(),
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

  private buildToggleRow(titleText: string, bodyText: string, checked: boolean): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('div');
    row.className = 'wizard-toggle-row';

    const copy = document.createElement('div');
    copy.className = 'wizard-toggle-copy';

    const title = document.createElement('strong');
    title.textContent = titleText;
    copy.appendChild(title);

    const body = document.createElement('span');
    body.textContent = bodyText;
    copy.appendChild(body);

    const toggle = document.createElement('label');
    toggle.className = 'switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;

    const track = document.createElement('span');
    track.className = 'switch-track';

    toggle.appendChild(input);
    toggle.appendChild(track);

    row.appendChild(copy);
    row.appendChild(toggle);

    return { row, input };
  }

  private buildSelectRow(titleText: string, bodyText: string, dropdown: Dropdown): HTMLElement {
    const row = document.createElement('div');
    row.className = 'wizard-toggle-row';

    const copy = document.createElement('div');
    copy.className = 'wizard-toggle-copy';

    const title = document.createElement('strong');
    title.textContent = titleText;
    copy.appendChild(title);

    const body = document.createElement('span');
    body.textContent = bodyText;
    copy.appendChild(body);

    row.appendChild(copy);
    row.appendChild(dropdown.element);

    return row;
  }

  private buildNumberRow(titleText: string, bodyText: string, value: number): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('div');
    row.className = 'wizard-toggle-row';

    const copy = document.createElement('div');
    copy.className = 'wizard-toggle-copy';

    const title = document.createElement('strong');
    title.textContent = titleText;
    copy.appendChild(title);

    const body = document.createElement('span');
    body.textContent = bodyText;
    copy.appendChild(body);

    const input = document.createElement('input');
    input.className = 'wizard-input';
    input.type = 'number';
    input.min = '1';
    input.value = String(value);

    row.appendChild(copy);
    row.appendChild(input);

    return { row, input };
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

  private buildAgentControlStep(): HTMLElement {
    const step = document.createElement('div');
    step.className = 'wizard-step';

    const title = document.createElement('h2');
    title.className = 'wizard-title';
    title.textContent = 'Agent Control';
    step.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'wizard-desc';
    desc.textContent = 'Choose how much control the agent has inside ClawBrowser.';
    step.appendChild(desc);

    const form = document.createElement('div');
    form.className = 'wizard-model-form';

    const coreSection = document.createElement('div');
    coreSection.className = 'wizard-model-section';

    const enabledRow = this.buildToggleRow(
      'Enable agent control',
      'Allow the agent to act inside the app.',
      this.agentControl.enabled,
    );
    coreSection.appendChild(enabledRow.row);

    const statusRow = this.buildToggleRow(
      'Persistent status indicator',
      'Show when the agent is active and expose the kill switch.',
      this.agentControl.statusIndicator,
    );
    coreSection.appendChild(statusRow.row);

    const modeDropdown = new Dropdown({
      options: [
        { value: 'max', label: 'Max autonomy' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'strict', label: 'Strict' },
      ],
      className: 'wizard-control',
      ariaLabel: 'Agent autonomy mode',
    });
    modeDropdown.field.value = this.agentControl.mode;
    coreSection.appendChild(
      this.buildSelectRow(
        'Autonomy mode',
        'Controls how permissive the agent is by default.',
        modeDropdown,
      ),
    );

    form.appendChild(coreSection);

    const accessSection = document.createElement('div');
    accessSection.className = 'wizard-model-section';

    const terminalRow = this.buildToggleRow(
      'Terminal access',
      'Allow agent-run terminal commands.',
      this.agentControl.allowTerminal,
    );
    accessSection.appendChild(terminalRow.row);

    const filesystemRow = this.buildToggleRow(
      'Filesystem access',
      'Allow agent file read/write within the configured scope.',
      this.agentControl.allowFilesystem,
    );
    accessSection.appendChild(filesystemRow.row);

    const filesystemDropdown = new Dropdown({
      options: [
        { value: 'sandbox', label: 'App sandbox + workspace' },
        { value: 'workspace_home', label: 'Workspace + home' },
        { value: 'unrestricted', label: 'Unrestricted' },
      ],
      className: 'wizard-control',
      ariaLabel: 'Filesystem scope',
    });
    filesystemDropdown.field.value = this.agentControl.filesystemScope;
    accessSection.appendChild(
      this.buildSelectRow(
        'Filesystem scope',
        'Default boundary for agent file operations.',
        filesystemDropdown,
      ),
    );

    const cookiesRow = this.buildToggleRow(
      'Cookies access',
      'Allow reading and writing cookies.',
      this.agentControl.allowCookies,
    );
    accessSection.appendChild(cookiesRow.row);

    const localStorageRow = this.buildToggleRow(
      'Local storage access',
      'Allow reading and writing localStorage/sessionStorage.',
      this.agentControl.allowLocalStorage,
    );
    accessSection.appendChild(localStorageRow.row);

    const credentialsRow = this.buildToggleRow(
      'Saved credentials',
      'Allow access to stored credentials.',
      this.agentControl.allowCredentials,
    );
    accessSection.appendChild(credentialsRow.row);

    const downloadsRow = this.buildToggleRow(
      'Downloads',
      'Allow the agent to manage downloads.',
      this.agentControl.allowDownloads,
    );
    accessSection.appendChild(downloadsRow.row);

    const fileDialogsRow = this.buildToggleRow(
      'File dialogs',
      'Auto-accept open/save dialogs.',
      this.agentControl.allowFileDialogs,
    );
    accessSection.appendChild(fileDialogsRow.row);

    const clipboardDropdown = new Dropdown({
      options: [
        { value: 'readwrite', label: 'Read + write' },
        { value: 'write', label: 'Write only' },
        { value: 'none', label: 'Disabled' },
      ],
      className: 'wizard-control',
      ariaLabel: 'Clipboard access',
    });
    clipboardDropdown.field.value = this.agentControl.clipboardAccess;
    accessSection.appendChild(
      this.buildSelectRow(
        'Clipboard access',
        'Allow reading/writing clipboard contents.',
        clipboardDropdown,
      ),
    );

    form.appendChild(accessSection);

    const automationSection = document.createElement('div');
    automationSection.className = 'wizard-model-section';

    const windowRow = this.buildToggleRow(
      'Window control',
      'Resize, focus, and manage windows.',
      this.agentControl.allowWindowControl,
    );
    automationSection.appendChild(windowRow.row);

    const devtoolsRow = this.buildToggleRow(
      'Devtools control',
      'Open/close devtools on demand.',
      this.agentControl.allowDevtools,
    );
    automationSection.appendChild(devtoolsRow.row);

    const originsRow = this.buildToggleRow(
      'Auto-grant origins',
      'Skip per-origin permission prompts.',
      this.agentControl.autoGrantOrigins,
    );
    automationSection.appendChild(originsRow.row);

    const permissionsRow = this.buildToggleRow(
      'Auto-grant camera/mic/geo/screen',
      'Allow page permission prompts without asking.',
      this.agentControl.autoGrantPagePermissions,
    );
    automationSection.appendChild(permissionsRow.row);

    form.appendChild(automationSection);

    const safetySection = document.createElement('div');
    safetySection.className = 'wizard-model-section';

    const destructiveDropdown = new Dropdown({
      options: [
        { value: 'chat', label: 'Chat confirmation' },
        { value: 'modal', label: 'Modal confirmation' },
        { value: 'none', label: 'No confirmation' },
      ],
      className: 'wizard-control',
      ariaLabel: 'Destructive confirmation',
    });
    destructiveDropdown.field.value = this.agentControl.destructiveConfirm;
    safetySection.appendChild(
      this.buildSelectRow(
        'Destructive confirmations',
        'How to confirm deletes, clears, and bulk actions.',
        destructiveDropdown,
      ),
    );

    const logEnabledRow = this.buildToggleRow(
      'Action log enabled',
      'Record every agent action for auditing.',
      this.agentControl.actionLog.enabled,
    );
    safetySection.appendChild(logEnabledRow.row);

    const logDetailDropdown = new Dropdown({
      options: [
        { value: 'full', label: 'Full detail' },
        { value: 'redacted', label: 'Redacted' },
        { value: 'minimal', label: 'Minimal' },
      ],
      className: 'wizard-control',
      ariaLabel: 'Action log detail',
    });
    logDetailDropdown.field.value = this.agentControl.actionLog.detail;
    safetySection.appendChild(
      this.buildSelectRow(
        'Action log detail',
        'Choose how much detail is stored.',
        logDetailDropdown,
      ),
    );

    const retentionRow = this.buildNumberRow(
      'Log retention (days)',
      'How long to keep audit logs.',
      this.agentControl.actionLog.retentionDays,
    );
    safetySection.appendChild(retentionRow.row);

    form.appendChild(safetySection);

    step.appendChild(form);

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

    const nextBtn = document.createElement('button');
    nextBtn.className = 'wizard-btn primary';
    nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', () => {
      const collected = this.collectAgentControl(errorEl);
      if (!collected) return;
      this.agentControl = collected;
      this.showStep(3);
    });
    btnRow.appendChild(nextBtn);

    step.appendChild(btnRow);

    this.agentControlInputs = {
      enabled: enabledRow.input,
      mode: modeDropdown.field,
      autoGrantOrigins: originsRow.input,
      autoGrantPagePermissions: permissionsRow.input,
      allowTerminal: terminalRow.input,
      allowFilesystem: filesystemRow.input,
      filesystemScope: filesystemDropdown.field,
      allowCookies: cookiesRow.input,
      allowLocalStorage: localStorageRow.input,
      allowCredentials: credentialsRow.input,
      allowDownloads: downloadsRow.input,
      allowFileDialogs: fileDialogsRow.input,
      clipboardAccess: clipboardDropdown.field,
      allowWindowControl: windowRow.input,
      allowDevtools: devtoolsRow.input,
      destructiveConfirm: destructiveDropdown.field,
      actionLogDetail: logDetailDropdown.field,
      actionLogRetention: retentionRow.input,
      actionLogEnabled: logEnabledRow.input,
      statusIndicator: statusRow.input,
    };

    return step;
  }

  private collectAgentControl(errorEl: HTMLElement): AgentControlSettings | null {
    errorEl.textContent = '';
    const inputs = this.agentControlInputs;
    if (!inputs) return DEFAULT_AGENT_CONTROL;

    const retentionRaw = Number(inputs.actionLogRetention.value);
    if (!Number.isFinite(retentionRaw) || retentionRaw <= 0) {
      errorEl.textContent = 'Log retention must be a positive number.';
      return null;
    }

    return {
      enabled: inputs.enabled.checked,
      mode: inputs.mode.value as AgentControlSettings['mode'],
      killSwitch: DEFAULT_AGENT_CONTROL.killSwitch,
      autoGrantOrigins: inputs.autoGrantOrigins.checked,
      autoGrantPagePermissions: inputs.autoGrantPagePermissions.checked,
      allowTerminal: inputs.allowTerminal.checked,
      allowFilesystem: inputs.allowFilesystem.checked,
      filesystemScope: inputs.filesystemScope.value as AgentControlSettings['filesystemScope'],
      allowCookies: inputs.allowCookies.checked,
      allowLocalStorage: inputs.allowLocalStorage.checked,
      allowCredentials: inputs.allowCredentials.checked,
      allowDownloads: inputs.allowDownloads.checked,
      allowFileDialogs: inputs.allowFileDialogs.checked,
      clipboardAccess: inputs.clipboardAccess.value as AgentControlSettings['clipboardAccess'],
      allowWindowControl: inputs.allowWindowControl.checked,
      allowDevtools: inputs.allowDevtools.checked,
      destructiveConfirm: inputs.destructiveConfirm.value as AgentControlSettings['destructiveConfirm'],
      actionLog: {
        enabled: inputs.actionLogEnabled.checked,
        detail: inputs.actionLogDetail.value as AgentControlSettings['actionLog']['detail'],
        retentionDays: Math.floor(retentionRaw),
      },
      statusIndicator: inputs.statusIndicator.checked,
    };
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
            agentControl: this.agentControl,
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
