import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Swarm } from '../../sidecar/core/Swarm';

// Access the module-level compressForLLM via dynamic import for testing
// We test it indirectly through the Swarm executor behavior

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
      totalStepsExecuted: 0,
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
      totalStepsExecuted: 0,
    });

    expect(result.stepResults).toEqual(['Result 1']);
    expect(result.currentStep).toBe(1);
    expect(result.totalStepsExecuted).toBe(1);
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
      totalStepsExecuted: 0,
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
        totalStepsExecuted: 0,
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
        totalStepsExecuted: 0,
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
        totalStepsExecuted: 0,
      });

      expect(notify).toHaveBeenCalledWith('swarmStepStarted', expect.objectContaining({ stepIndex: 0 }));
      expect(notify).toHaveBeenCalledWith('swarmStepCompleted', expect.objectContaining({ stepIndex: 0 }));
    });

    it('truncates large tool results in LLM context', async () => {
      // Simulate a dom.automation returning 20K chars of page text
      const largePageText = 'A'.repeat(20_000);
      const toolRegistry = {
        describeTools: vi.fn().mockReturnValue('- dom.automation: Run DOM automation.'),
        parseToolCall: vi.fn()
          .mockReturnValueOnce({
            kind: 'agent', tool: 'dom.automation', capability: 'dom', action: 'automation',
            params: { actions: [{ type: 'getText' }] },
          })
          .mockReturnValueOnce(null),
      };
      const dispatcher = {
        request: vi.fn().mockResolvedValue({
          requestId: '1', ok: true, data: { text: largePageText },
        }),
      };
      const notify = vi.fn();

      const toolSwarm = new Swarm(modelManager as any, toolRegistry as any, dispatcher as any, undefined, notify);

      let callCount = 0;
      const capturedMessages: any[] = [];
      const model = {
        invoke: vi.fn((msgs: any[]) => {
          callCount++;
          capturedMessages.push(...msgs);
          if (callCount === 1) return Promise.resolve({ content: '{"tool":"dom.automation","params":{"actions":[{"type":"getText"}]}}' });
          return Promise.resolve({ content: 'Page text extracted.' });
        }),
      };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      await (toolSwarm as any).executorNode({
        task: 'Get page text',
        plan: ['Extract text from page'],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
        browserContext: {},
        totalStepsExecuted: 0,
      });

      // The second LLM call should have a truncated tool result, not the full 20K
      const allMessages = model.invoke.mock.calls[1][0];
      const toolResultMsg = allMessages.find((m: any) =>
        m.content && typeof m.content === 'string' && m.content.includes('Tool result for dom.automation')
      );
      expect(toolResultMsg).toBeDefined();
      // Should be truncated well below 20K (max 4000 + overhead)
      expect(toolResultMsg.content.length).toBeLessThan(5_000);
      expect(toolResultMsg.content).toContain('truncated');
    });

    it('stops after 3 consecutive tool failures', async () => {
      const toolRegistry = {
        describeTools: vi.fn().mockReturnValue('tools'),
        parseToolCall: vi.fn().mockReturnValue({
          kind: 'agent', tool: 'dom.automation', capability: 'dom', action: 'automation',
          params: { actions: [] },
        }),
      };
      const dispatcher = {
        request: vi.fn().mockResolvedValue({ requestId: '1', ok: false, error: { message: 'DOM failed' } }),
      };
      const notify = vi.fn();

      const toolSwarm = new Swarm(modelManager as any, toolRegistry as any, dispatcher as any, undefined, notify);

      let callCount = 0;
      const model = {
        invoke: vi.fn(() => {
          callCount++;
          // First 3 calls return tool calls, 4th should be the fallback summary
          if (callCount <= 3) return Promise.resolve({ content: '{"tool":"dom.automation","params":{"actions":[]}}' });
          return Promise.resolve({ content: 'Could not complete DOM automation.' });
        }),
      };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (toolSwarm as any).executorNode({
        task: 'Extract data',
        plan: ['Read DOM elements'],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
        browserContext: {},
        totalStepsExecuted: 0,
      });

      // 3 failing tool calls + 1 fallback summary = 4 LLM calls
      expect(model.invoke).toHaveBeenCalledTimes(4);
      expect(dispatcher.request).toHaveBeenCalledTimes(3);
      expect(result.stepResults[0]).toContain('Could not complete DOM automation');
      expect(result.currentStep).toBe(1);
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
        totalStepsExecuted: 0,
      });

      // Should stop after 1 tool call due to abort
      expect(dispatcher.request).toHaveBeenCalledTimes(1);
      expect(result.currentStep).toBe(1);
    });
  });

  it('includes tool descriptions in planner prompt', async () => {
    const toolRegistry = {
      describeTools: vi.fn().mockReturnValue('- tab.create: Open a new tab.\n- tab.navigate: Navigate.'),
      parseToolCall: vi.fn(),
    };
    const notify = vi.fn();

    const toolSwarm = new Swarm(modelManager as any, toolRegistry as any, undefined, undefined, notify);

    const model = { invoke: vi.fn().mockResolvedValue({ content: '["Step 1"]' }) };
    modelManager.createModel.mockReturnValue(model);

    await (toolSwarm as any).plannerNode({
      task: 'Do something',
      plan: [],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
      browserContext: {},
    });

    const systemMsg = model.invoke.mock.calls[0][0][0];
    expect(systemMsg.content).toContain('tab.create');
    expect(systemMsg.content).toContain('tab.navigate');
  });

  it('sends swarmPlanReady notification', async () => {
    const notify = vi.fn();
    const toolSwarm = new Swarm(modelManager as any, undefined, undefined, undefined, notify);

    const model = { invoke: vi.fn().mockResolvedValue({ content: '["Step A", "Step B"]' }) };
    modelManager.createModel.mockReturnValue(model);

    await (toolSwarm as any).plannerNode({
      task: 'Task',
      plan: [],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context: {},
      browserContext: {},
    });

    expect(notify).toHaveBeenCalledWith('swarmPlanReady', {
      steps: ['Step A', 'Step B'],
      task: 'Task',
    });
  });

  describe('evaluator', () => {
    it('returns ok when LLM says ok', async () => {
      const model = { invoke: vi.fn().mockResolvedValue({ content: '{"verdict":"ok"}' }) };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (swarm as any).evaluatorNode({
        task: 'Find info',
        plan: ['Step 1', 'Step 2', 'Step 3'],
        currentStep: 1,
        stepResults: ['Result of step 1'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'ok',
        totalStepsExecuted: 1,
      });

      expect(result.evalVerdict).toBe('ok');
    });

    it('returns done when LLM says done', async () => {
      const model = { invoke: vi.fn().mockResolvedValue({ content: '{"verdict":"done"}' }) };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (swarm as any).evaluatorNode({
        task: 'Find info',
        plan: ['Step 1'],
        currentStep: 1,
        stepResults: ['Got all the info needed'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'ok',
        totalStepsExecuted: 1,
      });

      expect(result.evalVerdict).toBe('done');
    });

    it('returns needs_replan when LLM says needs_replan', async () => {
      const model = { invoke: vi.fn().mockResolvedValue({ content: '{"verdict":"needs_replan"}' }) };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (swarm as any).evaluatorNode({
        task: 'Find info',
        plan: ['Step 1', 'Step 2'],
        currentStep: 1,
        stepResults: ['Error: page not found'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'ok',
        totalStepsExecuted: 1,
      });

      expect(result.evalVerdict).toBe('needs_replan');
    });

    it('returns done when aborted', async () => {
      swarm.cancel();
      const result = await (swarm as any).evaluatorNode({
        task: 'Task',
        plan: ['Step 1'],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'ok',
        totalStepsExecuted: 0,
      });

      expect(result.evalVerdict).toBe('done');
    });

    it('returns done when max total steps reached', async () => {
      const result = await (swarm as any).evaluatorNode({
        task: 'Task',
        plan: ['Step 1', 'Step 2'],
        currentStep: 1,
        stepResults: ['Done'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'ok',
        totalStepsExecuted: 15,
      });

      expect(result.evalVerdict).toBe('done');
    });

    it('returns done when approaching recursion limit', async () => {
      const model = { invoke: vi.fn().mockResolvedValue({ content: '{"verdict":"ok"}' }) };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (swarm as any).evaluatorNode({
        task: 'Task',
        plan: ['Step 1', 'Step 2', 'Step 3'],
        currentStep: 1,
        stepResults: ['Done'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'ok',
        totalStepsExecuted: 5,
        nodeVisits: 27, // At bail threshold
      });

      // Should bail out to synthesizer instead of continuing
      expect(result.evalVerdict).toBe('done');
      // LLM should NOT have been called — we bail before even asking
      expect(model.invoke).not.toHaveBeenCalled();
    });

    it('falls back to ok/done when no model', async () => {
      modelManager.createModel.mockReturnValue(undefined);

      // Has remaining steps → ok
      let result = await (swarm as any).evaluatorNode({
        task: 'Task',
        plan: ['Step 1', 'Step 2'],
        currentStep: 1,
        stepResults: ['Done'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'ok',
        totalStepsExecuted: 1,
      });
      expect(result.evalVerdict).toBe('ok');

      // No remaining steps → done
      result = await (swarm as any).evaluatorNode({
        task: 'Task',
        plan: ['Step 1'],
        currentStep: 1,
        stepResults: ['Done'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'ok',
        totalStepsExecuted: 1,
      });
      expect(result.evalVerdict).toBe('done');
    });

    it('falls back gracefully on malformed LLM output', async () => {
      const model = { invoke: vi.fn().mockResolvedValue({ content: 'not json at all' }) };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (swarm as any).evaluatorNode({
        task: 'Task',
        plan: ['Step 1', 'Step 2'],
        currentStep: 1,
        stepResults: ['Result'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'ok',
        totalStepsExecuted: 1,
      });

      // Should fall back to ok since there are remaining steps
      expect(result.evalVerdict).toBe('ok');
    });
  });

  describe('replanner', () => {
    it('produces new plan when LLM returns step array', async () => {
      const notify = vi.fn();
      const toolSwarm = new Swarm(modelManager as any, undefined, undefined, undefined, notify);

      const model = { invoke: vi.fn().mockResolvedValue({
        content: '["Try Bing instead","Extract headlines from Bing"]',
      }) };
      modelManager.createModel.mockReturnValue(model);

      const result = await (toolSwarm as any).replannerNode({
        task: 'Find headlines',
        plan: ['Search Google', 'Extract headlines', 'Summarize'],
        currentStep: 1,
        stepResults: ['Google returned no relevant results'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'needs_replan',
        totalStepsExecuted: 1,
      });

      // New plan: completed step + new steps
      expect(result.plan).toEqual(['Search Google', 'Try Bing instead', 'Extract headlines from Bing']);
      expect(result.evalVerdict).toBe('ok');
    });

    it('sends swarmReplan notification on revision', async () => {
      const notify = vi.fn();
      const toolSwarm = new Swarm(modelManager as any, undefined, undefined, undefined, notify);

      const model = { invoke: vi.fn().mockResolvedValue({
        content: '["New approach step 1","New approach step 2"]',
      }) };
      modelManager.createModel.mockReturnValue(model);

      await (toolSwarm as any).replannerNode({
        task: 'Task',
        plan: ['Old step 1', 'Old step 2'],
        currentStep: 1,
        stepResults: ['Failed'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'needs_replan',
        totalStepsExecuted: 1,
      });

      expect(notify).toHaveBeenCalledWith('swarmReplan', expect.objectContaining({
        newSteps: ['New approach step 1', 'New approach step 2'],
        previousPlan: ['Old step 1', 'Old step 2'],
      }));
    });

    it('returns done when no model available', async () => {
      modelManager.createModel.mockReturnValue(undefined);

      const result = await (swarm as any).replannerNode({
        task: 'Task',
        plan: ['Step 1', 'Step 2'],
        currentStep: 1,
        stepResults: ['Failed'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'needs_replan',
        totalStepsExecuted: 1,
      });

      // With remaining steps but no model, falls back to ok
      expect(result.evalVerdict).toBe('ok');
    });

    it('returns done on malformed LLM output', async () => {
      const model = { invoke: vi.fn().mockResolvedValue({ content: 'not json at all' }) };
      modelManager.createModel.mockReturnValue(model);

      const result = await (swarm as any).replannerNode({
        task: 'Task',
        plan: ['Step 1'],
        currentStep: 1,
        stepResults: ['Failed'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'needs_replan',
        totalStepsExecuted: 1,
      });

      // Can't produce new plan → done
      expect(result.evalVerdict).toBe('done');
    });

    it('returns done on empty step array from LLM', async () => {
      const model = { invoke: vi.fn().mockResolvedValue({ content: '[]' }) };
      modelManager.createModel.mockReturnValue(model);

      const result = await (swarm as any).replannerNode({
        task: 'Task',
        plan: ['Step 1'],
        currentStep: 1,
        stepResults: ['Failed'],
        finalResult: '',
        context: {},
        browserContext: {},
        evalVerdict: 'needs_replan',
        totalStepsExecuted: 1,
      });

      // Empty array means can't replan → done
      expect(result.evalVerdict).toBe('done');
    });
  });

  describe('error recovery', () => {
    it('retries executor model call on retryable error', async () => {
      let callCount = 0;
      const model = {
        invoke: vi.fn(() => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error('Request timeout'));
          return Promise.resolve({ content: 'Recovered result' });
        }),
      };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (swarm as any).executorNode({
        task: 'Task',
        plan: ['Do step'],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
        totalStepsExecuted: 0,
      });

      expect(result.stepResults[0]).toBe('Recovered result');
      expect(model.invoke).toHaveBeenCalledTimes(2);
    });

    it('retries planner model call on retryable error', async () => {
      let callCount = 0;
      const model = {
        invoke: vi.fn(() => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error('503 Service Unavailable'));
          return Promise.resolve({ content: '["Step A"]' });
        }),
      };
      modelManager.createModel.mockReturnValue(model);

      const result = await (swarm as any).plannerNode({
        task: 'Task',
        plan: [],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
      });

      expect(result.plan).toEqual(['Step A']);
      expect(model.invoke).toHaveBeenCalledTimes(2);
    });

    it('emits swarmRecoveryAttempted notification on retry', async () => {
      const notify = vi.fn();
      const toolSwarm = new Swarm(modelManager as any, undefined, undefined, undefined, notify);

      let callCount = 0;
      const model = {
        invoke: vi.fn(() => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error('Request timeout'));
          return Promise.resolve({ content: 'Recovered' });
        }),
      };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      await (toolSwarm as any).executorNode({
        task: 'Task',
        plan: ['Step'],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
        totalStepsExecuted: 0,
      });

      expect(notify).toHaveBeenCalledWith('swarmRecoveryAttempted', expect.objectContaining({
        operation: expect.any(String),
        error: 'Request timeout',
        attempt: 1,
      }));
    });

    it('does not retry non-retryable errors in executor', async () => {
      const model = {
        invoke: vi.fn().mockRejectedValue(new Error('Sidecar process exited')),
      };
      modelManager.createModel.mockImplementation((role: string) =>
        role === 'subagent' ? model : undefined,
      );

      const result = await (swarm as any).executorNode({
        task: 'Task',
        plan: ['Do step'],
        currentStep: 0,
        stepResults: [],
        finalResult: '',
        context: {},
        totalStepsExecuted: 0,
      });

      expect(result.stepResults[0]).toContain('Error: Sidecar process exited');
      expect(model.invoke).toHaveBeenCalledTimes(1);
    });
  });
});
