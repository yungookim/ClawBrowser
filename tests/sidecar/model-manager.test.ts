import { describe, it, expect, beforeEach } from 'vitest';
import { ModelManager, type ModelConfig } from '../../sidecar/core/ModelManager';

describe('ModelManager', () => {
  let manager: ModelManager;

  beforeEach(() => {
    manager = new ModelManager();
  });

  it('should start with no configurations', () => {
    expect(manager.isConfigured('primary')).toBe(false);
    expect(manager.isConfigured('secondary')).toBe(false);
    expect(manager.isConfigured('subagent')).toBe(false);
    expect(manager.listConfigs()).toEqual([]);
  });

  it('should configure a model for a role', () => {
    const config: ModelConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      role: 'primary',
    };

    manager.configure(config);

    expect(manager.isConfigured('primary')).toBe(true);
    expect(manager.getConfig('primary')).toEqual(config);
  });

  it('should overwrite config when same role is configured twice', () => {
    manager.configure({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'key-1',
      role: 'primary',
    });

    manager.configure({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'key-2',
      role: 'primary',
    });

    expect(manager.getConfig('primary')?.provider).toBe('anthropic');
    expect(manager.listConfigs()).toHaveLength(1);
  });

  it('should support multiple roles simultaneously', () => {
    manager.configure({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'key-1',
      role: 'primary',
    });

    manager.configure({
      provider: 'groq',
      model: 'llama-3.3-70b',
      apiKey: 'key-2',
      role: 'subagent',
    });

    manager.configure({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'key-3',
      role: 'secondary',
    });

    expect(manager.isConfigured('primary')).toBe(true);
    expect(manager.isConfigured('secondary')).toBe(true);
    expect(manager.isConfigured('subagent')).toBe(true);
    expect(manager.listConfigs()).toHaveLength(3);
  });

  it('should return undefined for unconfigured role model creation', () => {
    expect(manager.createModel('primary')).toBeUndefined();
  });

  it('should return undefined for unconfigured role getConfig', () => {
    expect(manager.getConfig('primary')).toBeUndefined();
  });

  it('should create an OpenAI model instance', () => {
    manager.configure({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test',
      role: 'primary',
      temperature: 0.5,
    });

    const model = manager.createModel('primary');
    expect(model).toBeDefined();
  });

  it('should create an Anthropic model instance', () => {
    manager.configure({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-ant-test',
      role: 'primary',
    });

    const model = manager.createModel('primary');
    expect(model).toBeDefined();
  });

  it('should create a Groq model instance', () => {
    manager.configure({
      provider: 'groq',
      model: 'llama-3.3-70b',
      apiKey: 'gsk-test',
      role: 'subagent',
    });

    const model = manager.createModel('subagent');
    expect(model).toBeDefined();
  });

  it('should create an Ollama model instance', () => {
    manager.configure({
      provider: 'ollama',
      model: 'llama3',
      role: 'primary',
    });

    const model = manager.createModel('primary');
    expect(model).toBeDefined();
  });

  it('should create a llama.cpp model instance', () => {
    manager.configure({
      provider: 'llamacpp',
      model: 'local-model',
      role: 'primary',
    });

    const model = manager.createModel('primary');
    expect(model).toBeDefined();
  });

  it('should use default temperature of 0.7', () => {
    manager.configure({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'key',
      role: 'primary',
    });

    const config = manager.getConfig('primary');
    expect(config?.temperature).toBeUndefined();
    // The default 0.7 is applied inside createModel, not stored in config
  });

  it('should throw for unknown provider', () => {
    manager.configure({
      provider: 'unknown-provider' as any,
      model: 'some-model',
      role: 'primary',
    });

    expect(() => manager.createModel('primary')).toThrow('Unknown provider: unknown-provider');
  });

  it('should preserve custom baseUrl in config', () => {
    manager.configure({
      provider: 'openai',
      model: 'custom-model',
      apiKey: 'key',
      baseUrl: 'https://custom-api.example.com/v1',
      role: 'primary',
    });

    const config = manager.getConfig('primary');
    expect(config?.baseUrl).toBe('https://custom-api.example.com/v1');
  });

  it('should list all configured models', () => {
    manager.configure({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'key-1',
      role: 'primary',
    });

    manager.configure({
      provider: 'groq',
      model: 'llama-3.3-70b',
      apiKey: 'key-2',
      role: 'subagent',
    });

    const configs = manager.listConfigs();
    expect(configs).toHaveLength(2);
    expect(configs.map(c => c.provider)).toContain('openai');
    expect(configs.map(c => c.provider)).toContain('groq');
  });
});
