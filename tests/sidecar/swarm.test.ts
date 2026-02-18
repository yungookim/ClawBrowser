import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Swarm } from '../../sidecar/core/Swarm';

describe('Swarm', () => {
  let modelManager: { createModel: ReturnType<typeof vi.fn> };
  let swarm: Swarm;

  beforeEach(() => {
    modelManager = {
      createModel: vi.fn(),
    };
    swarm = new Swarm(modelManager as any);
  });

  it('falls back to single-step plan when no planner model', async () => {
    modelManager.createModel.mockReturnValue(undefined);

    const state: any = {
      task: 'Do the thing',
      plan: [],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
    };

    const result = await (swarm as any).plannerNode(state);
    expect(result.plan).toEqual(['Do the thing']);
  });

  it('parses planner model output into steps', async () => {
    const model = { invoke: vi.fn().mockResolvedValue({ content: '["Step A","Step B"]' }) };
    modelManager.createModel.mockReturnValue(model);

    const result = await (swarm as any).plannerNode({
      task: 'Task',
      plan: [],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
    });

    expect(result.plan).toEqual(['Step A', 'Step B']);
    expect(result.currentStep).toBe(0);
  });

  it('executes a step and records results', async () => {
    const model = { invoke: vi.fn().mockResolvedValue({ content: 'Result 1' }) };
    modelManager.createModel.mockImplementation((role: string) => role === 'subagent' ? model : undefined);

    const result = await (swarm as any).executorNode({
      task: 'Task',
      plan: ['Do step'],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: { page: 'Example' },
    });

    expect(result.stepResults).toEqual(['Result 1']);
    expect(result.currentStep).toBe(1);
    expect(model.invoke).toHaveBeenCalled();
  });

  it('handles executor errors gracefully', async () => {
    const model = { invoke: vi.fn().mockRejectedValue(new Error('boom')) };
    modelManager.createModel.mockImplementation((role: string) => role === 'subagent' ? model : undefined);

    const result = await (swarm as any).executorNode({
      task: 'Task',
      plan: ['Do step'],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
    });

    expect(result.stepResults?.[0]).toContain('Error: boom');
    expect(result.currentStep).toBe(1);
  });

  it('returns step result directly when only one', async () => {
    const result = await (swarm as any).synthesizerNode({
      task: 'Task',
      plan: ['Only step'],
      currentStep: 1,
      stepResults: ['Only result'],
      finalResult: '',
      context: {},
    });

    expect(result.finalResult).toBe('Only result');
  });

  it('synthesizes multiple steps with model', async () => {
    const model = { invoke: vi.fn().mockResolvedValue({ content: 'Synthesized' }) };
    modelManager.createModel.mockReturnValue(model);

    const result = await (swarm as any).synthesizerNode({
      task: 'Task',
      plan: ['Step 1', 'Step 2'],
      currentStep: 2,
      stepResults: ['Result 1', 'Result 2'],
      finalResult: '',
      context: {},
    });

    expect(result.finalResult).toBe('Synthesized');
    expect(model.invoke).toHaveBeenCalled();
  });

  it('joins step results when no synthesizer model', async () => {
    modelManager.createModel.mockReturnValue(undefined);

    const result = await (swarm as any).synthesizerNode({
      task: 'Task',
      plan: ['Step 1', 'Step 2'],
      currentStep: 2,
      stepResults: ['Result 1', 'Result 2'],
      finalResult: '',
      context: {},
    });

    expect(result.finalResult).toBe('Result 1\n\nResult 2');
  });

  it('accepts tool dependencies in constructor', () => {
    const toolRegistry = { describeTools: vi.fn().mockReturnValue('tools'), parseToolCall: vi.fn() };
    const dispatcher = { request: vi.fn() };
    const executor = { execute: vi.fn() };
    const notify = vi.fn();

    const toolSwarm = new Swarm(modelManager as any, toolRegistry as any, dispatcher as any, executor as any, notify);
    expect(toolSwarm).toBeDefined();
  });

  it('has a cancel method that sets aborted', () => {
    const notify = vi.fn();
    const toolSwarm = new Swarm(modelManager as any, undefined, undefined, undefined, notify);
    toolSwarm.cancel();
    // Aborted flag is private, but we can test it indirectly through executor behavior
    // For now just verify cancel doesn't throw
    expect(() => toolSwarm.cancel()).not.toThrow();
  });

  describe('tool-enabled executor', () => {
    it('executes tool calls within a step', async () => {
      const toolRegistry = {
        describeTools: vi.fn().mockReturnValue('- tab.navigate: Navigate.'),
        parseToolCall: vi.fn()
          .mockReturnValueOnce({
            kind: 'agent', tool: 'tab.navigate', capability: 'tab', action: 'navigate',
            params: { url: 'https://google.com' },
          })
          .mockReturnValueOnce(null),
      };
      const dispatcher = {
        request: vi.fn().mockResolvedValue({ requestId: '1', ok: true, data: { tabId: 't1' } }),
      };
      const notify = vi.fn();

      const toolSwarm = new Swarm(modelManager as any, toolRegistry as any, dispatcher as any, undefined, notify);

      let callCount = 0;
      const model = {
        invoke: vi.fn(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve({ content: '{"tool":"tab.navigate","params":{"url":"https://google.com"}}' });
          return Promise.resolve({ content: 'Navigated to Google successfully.' });
        }),
      };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (toolSwarm as any).executorNode({
        task: 'Search Google',
        plan: ['Navigate to Google'],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
        browserContext: {},
      });

      expect(dispatcher.request).toHaveBeenCalledTimes(1);
      expect(result.stepResults[0]).toContain('Navigated to Google');
      expect(result.currentStep).toBe(1);
    });

    it('respects max tool iterations per step (10)', async () => {
      const toolRegistry = {
        describeTools: vi.fn().mockReturnValue('tools'),
        parseToolCall: vi.fn().mockReturnValue({
          kind: 'agent', tool: 'tab.create', capability: 'tab', action: 'create', params: {},
        }),
      };
      const dispatcher = {
        request: vi.fn().mockResolvedValue({ requestId: '1', ok: true, data: {} }),
      };
      const notify = vi.fn();

      const toolSwarm = new Swarm(modelManager as any, toolRegistry as any, dispatcher as any, undefined, notify);

      const model = {
        invoke: vi.fn().mockResolvedValue({ content: '{"tool":"tab.create","params":{}}' }),
      };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (toolSwarm as any).executorNode({
        task: 'Loop task',
        plan: ['Looping step'],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
        browserContext: {},
      });

      expect(dispatcher.request).toHaveBeenCalledTimes(10);
      expect(result.currentStep).toBe(1);
    });

    it('sends progress notifications during execution', async () => {
      const toolRegistry = {
        describeTools: vi.fn().mockReturnValue('tools'),
        parseToolCall: vi.fn().mockReturnValueOnce(null),
      };
      const notify = vi.fn();

      const toolSwarm = new Swarm(modelManager as any, toolRegistry as any, undefined, undefined, notify);

      const model = {
        invoke: vi.fn().mockResolvedValue({ content: 'Done with step' }),
      };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      await (toolSwarm as any).executorNode({
        task: 'Task',
        plan: ['Do thing'],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
        browserContext: {},
      });

      expect(notify).toHaveBeenCalledWith('swarmStepStarted', expect.objectContaining({ stepIndex: 0 }));
      expect(notify).toHaveBeenCalledWith('swarmStepCompleted', expect.objectContaining({ stepIndex: 0 }));
    });

    it('stops execution when aborted', async () => {
      const toolRegistry = {
        describeTools: vi.fn().mockReturnValue('tools'),
        parseToolCall: vi.fn().mockReturnValue({
          kind: 'agent', tool: 'tab.create', capability: 'tab', action: 'create', params: {},
        }),
      };
      const dispatcher = {
        request: vi.fn().mockResolvedValue({ requestId: '1', ok: true, data: {} }),
      };
      const notify = vi.fn();

      const toolSwarm = new Swarm(modelManager as any, toolRegistry as any, dispatcher as any, undefined, notify);

      const model = {
        invoke: vi.fn().mockImplementation(() => {
          toolSwarm.cancel();
          return Promise.resolve({ content: '{"tool":"tab.create","params":{}}' });
        }),
      };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (toolSwarm as any).executorNode({
        task: 'Task',
        plan: ['Step'],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
        browserContext: {},
      });

      // Should stop after 1 tool call due to abort
      expect(dispatcher.request).toHaveBeenCalledTimes(1);
      expect(result.currentStep).toBe(1);
    });
  });
});
