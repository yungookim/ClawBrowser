import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Wizard } from '../../src/onboarding/Wizard';
import type { Vault } from '../../src/vault/Vault';

function findButton(label: string, scope: ParentNode = document): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll('button'))
    .find(el => el.textContent === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button as HTMLButtonElement;
}

function getVisibleStep(): HTMLElement {
  const steps = Array.from(document.querySelectorAll('.wizard-step')) as HTMLElement[];
  const step = steps.find(el => el.style.display === 'flex');
  if (!step) throw new Error('No visible wizard step found');
  return step;
}

function getVisibleStepIndex(): number {
  const steps = Array.from(document.querySelectorAll('.wizard-step')) as HTMLElement[];
  return steps.findIndex(step => step.style.display === 'flex');
}

function getModelSection(label: string): HTMLElement {
  const sections = Array.from(document.querySelectorAll('.wizard-model-section')) as HTMLElement[];
  const section = sections.find(el => el.textContent?.includes(label));
  if (!section) throw new Error(`Model section not found: ${label}`);
  return section;
}

function fillModelSection(section: HTMLElement, values: { provider?: string; model?: string; apiKey?: string }) {
  const providerSelect = section.querySelector('select') as HTMLSelectElement;
  const modelInput = section.querySelector('input[placeholder^="Model name"]') as HTMLInputElement;
  const apiKeyInput = section.querySelector('input[type="password"]') as HTMLInputElement;

  if (values.provider) providerSelect.value = values.provider;
  if (values.model) modelInput.value = values.model;
  if (values.apiKey) apiKeyInput.value = values.apiKey;
}

describe('Wizard', () => {
  let vault: Vault & {
    unlock: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    vault = {
      unlock: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    } as any;
  });

  it('walks through steps and completes with valid data', async () => {
    const wizard = new Wizard(vault);
    const onComplete = vi.fn();
    wizard.setOnComplete(onComplete);

    wizard.show();
    expect(getVisibleStepIndex()).toBe(0);

    findButton('Get Started', getVisibleStep()).click();
    expect(getVisibleStepIndex()).toBe(1);

    const dropZone = document.querySelector('.wizard-dropzone') as HTMLElement;
    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = {
      files: [{ name: 'workspace', path: '/tmp/workspace' }],
    };
    dropZone.dispatchEvent(dropEvent);
    expect(dropZone.textContent).toContain('/tmp/workspace');

    findButton('Next', getVisibleStep()).click();
    expect(getVisibleStepIndex()).toBe(2);

    const modelStep = getVisibleStep();
    const errorEl = modelStep.querySelector('.wizard-error') as HTMLElement;

    // No primary model yet: should stay on model step
    findButton('Next', modelStep).click();
    expect(getVisibleStepIndex()).toBe(2);
    expect(errorEl.textContent).toContain('Primary model is required');

    const primarySection = getModelSection('Primary model');
    fillModelSection(primarySection, {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-primary',
    });

    const secondarySection = getModelSection('Secondary model');
    fillModelSection(secondarySection, {
      provider: 'groq',
      model: 'llama-3.3-70b',
      apiKey: 'sk-secondary',
    });

    findButton('Next', getVisibleStep()).click();
    expect(getVisibleStepIndex()).toBe(3);

    const pwInput = document.querySelector('input[placeholder^="Master password"]') as HTMLInputElement;
    const confirmInput = document.querySelector('input[placeholder^="Confirm password"]') as HTMLInputElement;
    const pwError = document.querySelector('.wizard-error') as HTMLElement;

    pwInput.value = 'short';
    confirmInput.value = 'short';
    findButton('Launch ClawBrowser', getVisibleStep()).click();
    expect(pwError.textContent).toContain('at least 8 characters');

    pwInput.value = 'password123';
    confirmInput.value = 'password124';
    findButton('Launch ClawBrowser', getVisibleStep()).click();
    expect(pwError.textContent).toContain('Passwords do not match');

    pwInput.value = 'password123';
    confirmInput.value = 'password123';
    findButton('Launch ClawBrowser', getVisibleStep()).click();

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(vault.unlock).toHaveBeenCalledWith('password123');
    expect(vault.set).toHaveBeenCalledWith('apikey:primary', 'sk-primary');
    expect(vault.set).toHaveBeenCalledWith('apikey:secondary', 'sk-secondary');

    const overlay = document.querySelector('.wizard-overlay') as HTMLElement;
    expect(overlay.classList.contains('visible')).toBe(false);

    expect(onComplete).toHaveBeenCalledWith({
      workspacePath: '/tmp/workspace',
      models: {
        primary: {
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'sk-primary',
          baseUrl: undefined,
          temperature: undefined,
          role: 'primary',
        },
        secondary: {
          provider: 'groq',
          model: 'llama-3.3-70b',
          apiKey: 'sk-secondary',
          baseUrl: undefined,
          temperature: undefined,
          role: 'secondary',
        },
        subagent: null,
      },
      password: 'password123',
    });
  });

  it('uses existing vault data when provided', async () => {
    const existingVaultData = '{"salt":"abc","entries":{}}';
    const wizard = new Wizard(vault, existingVaultData);
    const onComplete = vi.fn();
    wizard.setOnComplete(onComplete);

    wizard.show();
    findButton('Get Started', getVisibleStep()).click();

    findButton('Start Fresh', getVisibleStep()).click();
    expect(getVisibleStepIndex()).toBe(2);

    const primarySection = getModelSection('Primary model');
    fillModelSection(primarySection, {
      provider: 'openai',
      model: 'gpt-4o',
    });

    findButton('Next', getVisibleStep()).click();
    expect(getVisibleStepIndex()).toBe(3);

    const pwInput = document.querySelector('input[placeholder^="Master password"]') as HTMLInputElement;
    const confirmInput = document.querySelector('input[placeholder^="Confirm password"]') as HTMLInputElement;

    pwInput.value = 'password123';
    confirmInput.value = 'password123';
    findButton('Launch ClawBrowser', getVisibleStep()).click();

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(vault.unlock).toHaveBeenCalledWith('password123', existingVaultData);
  });
});
