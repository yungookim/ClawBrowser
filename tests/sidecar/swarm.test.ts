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
});
