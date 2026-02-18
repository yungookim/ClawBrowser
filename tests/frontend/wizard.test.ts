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

    // No models yet: should stay on model step
    findButton('Next', getVisibleStep()).click();
    expect(getVisibleStepIndex()).toBe(2);

    const modelInput = document.querySelector('input[placeholder^="Model name"]') as HTMLInputElement;
    const apiKeyInput = document.querySelector('input[placeholder^="API key"]') as HTMLInputElement;
    modelInput.value = 'gpt-4o';
    apiKeyInput.value = 'sk-test';
    findButton('Add Model', getVisibleStep()).click();

    const modelList = document.querySelector('.wizard-model-list') as HTMLElement;
    expect(modelList.textContent).toContain('openai/gpt-4o');
    expect(modelList.textContent).toContain('(primary)');

    findButton('Next', getVisibleStep()).click();
    expect(getVisibleStepIndex()).toBe(3);

    const pwInput = document.querySelector('input[placeholder^="Master password"]') as HTMLInputElement;
    const confirmInput = document.querySelector('input[placeholder^="Confirm password"]') as HTMLInputElement;
    const errorEl = document.querySelector('.wizard-error') as HTMLElement;

    pwInput.value = 'short';
    confirmInput.value = 'short';
    findButton('Launch ClawBrowser', getVisibleStep()).click();
    expect(errorEl.textContent).toContain('at least 8 characters');

    pwInput.value = 'password123';
    confirmInput.value = 'password124';
    findButton('Launch ClawBrowser', getVisibleStep()).click();
    expect(errorEl.textContent).toContain('Passwords do not match');

    pwInput.value = 'password123';
    confirmInput.value = 'password123';
    findButton('Launch ClawBrowser', getVisibleStep()).click();

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(vault.unlock).toHaveBeenCalledWith('password123');
    expect(vault.set).toHaveBeenCalledWith('apikey:openai', 'sk-test');

    const overlay = document.querySelector('.wizard-overlay') as HTMLElement;
    expect(overlay.classList.contains('visible')).toBe(false);

    expect(onComplete).toHaveBeenCalledWith({
      workspacePath: '/tmp/workspace',
      models: [
        {
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'sk-test',
          primary: true,
        },
      ],
      password: 'password123',
    });
  });
});
