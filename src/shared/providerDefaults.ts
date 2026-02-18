export type ProviderId = 'openai' | 'anthropic' | 'groq' | 'ollama' | 'llamacpp';

export type ProviderDefaults = {
  baseUrl: string;
  apiKeyRequired: boolean;
  apiKeyPlaceholder: string;
};

export type ModelInputs = {
  provider: HTMLSelectElement;
  model: HTMLInputElement;
  apiKey: HTMLInputElement;
  baseUrl: HTMLInputElement;
};

const PROVIDER_DEFAULTS: Record<ProviderId, ProviderDefaults> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKeyRequired: true,
    apiKeyPlaceholder: 'API Key (required)',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    apiKeyRequired: true,
    apiKeyPlaceholder: 'API Key (required)',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyRequired: true,
    apiKeyPlaceholder: 'API Key (required)',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1/',
    apiKeyRequired: false,
    apiKeyPlaceholder: 'optional for local providers',
  },
  llamacpp: {
    baseUrl: 'http://localhost:8080/v1',
    apiKeyRequired: false,
    apiKeyPlaceholder: 'optional for local providers',
  },
};

export function getProviderDefaults(provider: string): ProviderDefaults | null {
  if (!provider) return null;
  return (PROVIDER_DEFAULTS as Record<string, ProviderDefaults>)[provider] || null;
}

export function providerRequiresApiKey(provider: string): boolean {
  return getProviderDefaults(provider)?.apiKeyRequired ?? false;
}

export function applyProviderDefaults(
  inputs: ModelInputs,
  provider: string,
  options?: { force?: boolean },
): ProviderDefaults | null {
  const defaults = getProviderDefaults(provider);
  if (!defaults) return null;

  const force = options?.force ?? false;
  if (force || !inputs.baseUrl.value.trim()) {
    inputs.baseUrl.value = defaults.baseUrl;
  }

  inputs.baseUrl.placeholder = defaults.baseUrl;
  inputs.apiKey.required = defaults.apiKeyRequired;
  inputs.apiKey.placeholder = defaults.apiKeyPlaceholder;

  return defaults;
}
