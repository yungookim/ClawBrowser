import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Wizard } from '../../src/onboarding/Wizard';
import { DEFAULT_AGENT_CONTROL } from '../../src/agent/types';

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
  if (values.provider) providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
  if (values.model) modelInput.value = values.model;
  if (values.apiKey) apiKeyInput.value = values.apiKey;
}

describe('Wizard', () => {
  let vault: {
    set: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    document.body.textContent = '';
    vault = {
      set: vi.fn().mockResolvedValue(undefined),
    } as any;
  });

  it('walks through steps and completes with valid data', async () => {
    const wizard = new Wizard(vault as any);
    const onComplete = vi.fn();
    wizard.setOnComplete(onComplete);

    wizard.show();
    expect(getVisibleStepIndex()).toBe(0);

    findButton('Get Started', getVisibleStep()).click();
    expect(getVisibleStepIndex()).toBe(1);

    const modelStep = getVisibleStep();
    const errorEl = modelStep.querySelector('.wizard-error') as HTMLElement;

    // No primary model yet: should stay on model step
    findButton('Next', modelStep).click();
    expect(getVisibleStepIndex()).toBe(1);
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
    expect(getVisibleStepIndex()).toBe(2);

    findButton('Launch ClawBrowser', getVisibleStep()).click();

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(vault.set).toHaveBeenCalledWith('apikey:primary', 'sk-primary');
    expect(vault.set).toHaveBeenCalledWith('apikey:secondary', 'sk-secondary');

    const overlay = document.querySelector('.wizard-overlay') as HTMLElement;
    expect(overlay.classList.contains('visible')).toBe(false);

    expect(onComplete).toHaveBeenCalledWith({
      workspacePath: null,
      models: {
        primary: {
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'sk-primary',
          baseUrl: 'https://api.openai.com/v1',
          role: 'primary',
        },
        secondary: {
          provider: 'groq',
          model: 'llama-3.3-70b',
          apiKey: 'sk-secondary',
          baseUrl: 'https://api.groq.com/openai/v1',
          role: 'secondary',
        },
        subagent: null,
      },
      agentControl: DEFAULT_AGENT_CONTROL,
    });
  });

  it('requires API key for hosted providers', async () => {
    const wizard = new Wizard(vault as any);
    const onComplete = vi.fn();
    wizard.setOnComplete(onComplete);

    wizard.show();
    findButton('Get Started', getVisibleStep()).click();
    expect(getVisibleStepIndex()).toBe(1);

    const primarySection = getModelSection('Primary model');
    fillModelSection(primarySection, {
      provider: 'openai',
      model: 'gpt-4o',
    });

    const errorEl = getVisibleStep().querySelector('.wizard-error') as HTMLElement;
    findButton('Next', getVisibleStep()).click();
    expect(getVisibleStepIndex()).toBe(1);
    expect(errorEl.textContent).toContain('API key');
  });
});
