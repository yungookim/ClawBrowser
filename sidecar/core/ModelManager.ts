import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGroq } from '@langchain/groq';

export type Provider = 'openai' | 'anthropic' | 'groq' | 'ollama' | 'llamacpp';
export type ModelRole = 'primary' | 'secondary' | 'subagent';

export interface ModelConfig {
  provider: Provider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  role: ModelRole;
  temperature?: number;
}

/**
 * ModelManager manages LLM provider configurations and creates
 * LangChain chat model instances dynamically.
 */
export class ModelManager {
  private configs: Map<ModelRole, ModelConfig> = new Map();

  /** Configure a model for a given role. */
  configure(config: ModelConfig): void {
    this.configs.set(config.role, config);
    console.error(`[ModelManager] Configured ${config.role}: ${config.provider}/${config.model}`);
  }

  /** Get the config for a role. */
  getConfig(role: ModelRole): ModelConfig | undefined {
    return this.configs.get(role);
  }

  /** Check if a model is configured for the given role. */
  isConfigured(role: ModelRole): boolean {
    return this.configs.has(role);
  }

  /**
   * Create a LangChain chat model instance for the given role.
   * Returns undefined if no config exists for that role.
   */
  createModel(role: ModelRole): BaseChatModel | undefined {
    const config = this.configs.get(role);
    if (!config) return undefined;

    return this.createModelFromConfig(config);
  }

  /** Create a LangChain chat model instance from a config. */
  private createModelFromConfig(config: ModelConfig): BaseChatModel {
    const temperature = config.temperature ?? 0.7;

    switch (config.provider) {
      case 'openai':
        return new ChatOpenAI({
          modelName: config.model,
          apiKey: config.apiKey,
          temperature,
          configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
        });

      case 'anthropic':
        return new ChatAnthropic({
          modelName: config.model,
          anthropicApiKey: config.apiKey,
          temperature,
          ...(config.baseUrl ? { anthropicApiUrl: config.baseUrl } : {}),
        });

      case 'groq':
        return new ChatGroq({
          model: config.model,
          apiKey: config.apiKey,
          temperature,
        });

      case 'ollama':
        // Ollama uses OpenAI-compatible API
        return new ChatOpenAI({
          modelName: config.model,
          temperature,
          configuration: {
            baseURL: config.baseUrl || 'http://localhost:11434/v1',
          },
          apiKey: 'ollama', // Ollama doesn't need a real key
        });

      case 'llamacpp':
        // llama.cpp server also uses OpenAI-compatible API
        return new ChatOpenAI({
          modelName: config.model,
          temperature,
          configuration: {
            baseURL: config.baseUrl || 'http://localhost:8080/v1',
          },
          apiKey: 'llamacpp', // local, no key needed
        });

      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  /** List all configured models. */
  listConfigs(): ModelConfig[] {
    return Array.from(this.configs.values());
  }
}
