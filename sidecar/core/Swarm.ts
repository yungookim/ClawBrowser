import { StateGraph, Annotation, END } from '@langchain/langgraph';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ModelManager } from './ModelManager.js';
import type { ToolRegistry, ParsedToolCall } from './ToolRegistry.js';
import type { AgentDispatcher } from './AgentDispatcher.js';
import type { CommandExecutor } from './CommandExecutor.js';

type Notify = (method: string, params?: Record<string, unknown>) => void;

export interface SwarmBrowserContext {
  activeTabUrl?: string;
  activeTabTitle?: string;
  tabCount?: number;
}

type EvalVerdict = 'ok' | 'needs_replan' | 'done';

// State annotation for the swarm graph
const SwarmState = Annotation.Root({
  task: Annotation<string>,
  plan: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  currentStep: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  stepResults: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  finalResult: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  context: Annotation<Record<string, string>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  browserContext: Annotation<SwarmBrowserContext>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  evalVerdict: Annotation<EvalVerdict>({
    reducer: (_prev, next) => next,
    default: () => 'ok' as EvalVerdict,
  }),
  totalStepsExecuted: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  nodeVisits: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
});

type SwarmStateType = typeof SwarmState.State;

const PLANNER_SYSTEM_PROMPT = `You are a task planner for ClawBrowser's AI agent.
Break down the user's task into a numbered list of concrete, actionable steps.
Each step should be a single action that can be executed independently.
Respond ONLY with a JSON array of step strings. Example:
["Search for the topic on Google", "Open the first relevant result", "Extract the key information", "Summarize findings for the user"]
Keep it to 2-6 steps. If the task is simple, use fewer steps.`;

const EXECUTOR_SYSTEM_PROMPT = `You are an AI executor for ClawBrowser.
You are given a specific step to execute as part of a larger task.
Execute the step and provide a clear, concise result.
You have context about previous steps that have already been completed.`;

const EVALUATOR_SYSTEM_PROMPT = `You evaluate whether a task step succeeded and whether the overall task is done.
You receive the user's original task, completed steps with results, and remaining steps.

Respond ONLY with JSON (no markdown):
- {"verdict":"ok"} — step succeeded, remaining plan is still valid, continue
- {"verdict":"needs_replan"} — step failed, returned empty/useless results, or remaining steps no longer make sense
- {"verdict":"done"} — the user's task is fully accomplished based on collected results

Be strict: if the step result is an error, empty, or clearly doesn't advance the task, choose "needs_replan".
Only choose "done" when the results genuinely answer the user's original request.`;

const REPLANNER_SYSTEM_PROMPT = `You are a recovery planner. A previous step failed or returned poor results.
Your job is to produce a NEW set of remaining steps that take a different approach to accomplish the user's task.

Respond ONLY with a JSON array of step strings. Example:
["Try searching on Bing instead", "Extract the relevant data", "Summarize findings"]

Guidelines:
- Do NOT repeat the approach that already failed — try something different
- Be specific and actionable — each step is a single concrete action
- Keep it concise (2-5 steps)
- Build on any successful results from earlier steps`;

/** Compress text for LLM context: collapse whitespace, strip HTML tags, truncate. */
function compressForLLM(text: string, maxLength: number): string {
  let compressed = text.replace(/<[^>]+>/g, ' ');
  compressed = compressed.replace(/\s+/g, ' ').trim();
  if (compressed.length <= maxLength) return compressed;
  return compressed.substring(0, maxLength) + `... [truncated, ${text.length} chars total]`;
}

const MAX_RECOVERY_RETRIES = 2;

function isRetryable(err: Error): boolean {
  const msg = err.message.toLowerCase();
  if (msg.includes('process exited') || msg.includes('not started') || msg.includes('not configured')) {
    return false;
  }
  return msg.includes('timeout') || msg.includes('rate') || msg.includes('429')
    || msg.includes('503') || msg.includes('500') || msg.includes('failed')
    || msg.includes('econnreset') || msg.includes('econnrefused');
}

/**
 * Swarm implements an adaptive planner-executor pattern using LangGraph.
 *
 * Graph: planner -> executor -> evaluator --(ok)--> executor
 *                                         --(needs_replan)--> replanner -> executor
 *                                         --(done)--> synthesizer -> END
 *
 * The evaluator (fast, cheap) runs after every step. The replanner (smart, creative)
 * only fires when the evaluator detects a problem, saving tokens on the happy path.
 */
export class Swarm {
  private static readonly MAX_TOOL_ITERATIONS_PER_STEP = 10;
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;
  private static readonly STEP_TIMEOUT_MS = 120_000;
  private static readonly MAX_TOOL_RESULT_CHARS = 4_000;
  private static readonly MAX_STEP_RESULT_CHARS = 2_000;
  private static readonly MAX_TOTAL_STEPS = 15;
  private static readonly RECURSION_LIMIT = 30;
  // Leave headroom for synthesizer + END transitions
  private static readonly NODE_VISIT_BAIL_THRESHOLD = 27;

  private modelManager: ModelManager;
  private toolRegistry: ToolRegistry | null;
  private dispatcher: AgentDispatcher | null;
  private commandExecutor: CommandExecutor | null;
  private notify: Notify | null;
  private aborted = false;

  constructor(
    modelManager: ModelManager,
    toolRegistry?: ToolRegistry,
    dispatcher?: AgentDispatcher,
    commandExecutor?: CommandExecutor,
    notify?: Notify,
  ) {
    this.modelManager = modelManager;
    this.toolRegistry = toolRegistry || null;
    this.dispatcher = dispatcher || null;
    this.commandExecutor = commandExecutor || null;
    this.notify = notify || null;
  }

  cancel(): void {
    this.aborted = true;
  }

  /** Execute a complex task using the planner-executor swarm. */
  async execute(
    task: string,
    context: Record<string, string> = {},
    browserContext?: SwarmBrowserContext,
  ): Promise<string> {
    this.aborted = false;
    const graph = this.buildGraph();
    const compiled = graph.compile();

    const result = await compiled.invoke({
      task,
      plan: [],
      currentStep: 0,
      stepResults: [],
      finalResult: '',
      context,
      browserContext: browserContext || {},
      evalVerdict: 'ok' as EvalVerdict,
      totalStepsExecuted: 0,
      nodeVisits: 0,
    }, { recursionLimit: Swarm.RECURSION_LIMIT });

    return result.finalResult;
  }

  private buildGraph() {
    const graph = new StateGraph(SwarmState)
      .addNode('planner', (state: SwarmStateType) => this.plannerNode(state))
      .addNode('executor', (state: SwarmStateType) => this.executorNode(state))
      .addNode('evaluator', (state: SwarmStateType) => this.evaluatorNode(state))
      .addNode('replanner', (state: SwarmStateType) => this.replannerNode(state))
      .addNode('synthesizer', (state: SwarmStateType) => this.synthesizerNode(state))
      .addEdge('__start__', 'planner')
      .addEdge('planner', 'executor')
      .addEdge('executor', 'evaluator')
      .addConditionalEdges('evaluator', (state: SwarmStateType) => {
        if (this.aborted) return 'synthesizer';
        if (state.evalVerdict === 'done') return 'synthesizer';
        if (state.totalStepsExecuted >= Swarm.MAX_TOTAL_STEPS) {
          console.error(`[Swarm] Max total steps (${Swarm.MAX_TOTAL_STEPS}) reached, finishing`);
          return 'synthesizer';
        }
        if (state.nodeVisits >= Swarm.NODE_VISIT_BAIL_THRESHOLD) {
          console.error(`[Swarm] Approaching recursion limit (${state.nodeVisits}/${Swarm.RECURSION_LIMIT}), finishing`);
          return 'synthesizer';
        }
        if (state.evalVerdict === 'needs_replan') return 'replanner';
        // 'ok' — continue to next step
        return 'executor';
      })
      .addEdge('replanner', 'executor')
      .addEdge('synthesizer', END);

    return graph;
  }

  /** Planner node: breaks the task into steps using the primary model. */
  private async plannerNode(state: SwarmStateType): Promise<Partial<SwarmStateType>> {
    const visits = (state.nodeVisits || 0) + 1;
    const model = this.modelManager.createModel('primary');
    if (!model) {
      return {
        plan: [state.task],
        currentStep: 0,
        nodeVisits: visits,
      };
    }

    const toolDescriptions = this.toolRegistry?.describeTools() || '';

    const systemPrompt = [
      PLANNER_SYSTEM_PROMPT,
      toolDescriptions ? `\nAvailable browser tools:\n${toolDescriptions}` : '',
      'Plan steps that leverage these tools to accomplish the task.',
    ].filter(Boolean).join('\n');

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      new HumanMessage(state.task),
    ];

    try {
      const content = await this.invokeWithRecovery(model, messages, 'planner', 1);

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const steps: string[] = JSON.parse(jsonMatch[0]);
        console.error(`[Swarm/Planner] ${steps.length} steps planned`);
        this.sendNotification('swarmPlanReady', { steps, task: state.task });
        return {
          plan: steps,
          currentStep: 0,
          nodeVisits: visits,
        };
      }
    } catch (err) {
      console.error('[Swarm/Planner] Error:', err);
    }

    return {
      plan: [state.task],
      currentStep: 0,
      nodeVisits: visits,
    };
  }

  /** Executor node: executes the current step using the sub-agent (or primary) model. */
  private async executorNode(state: SwarmStateType): Promise<Partial<SwarmStateType>> {
    const visits = (state.nodeVisits || 0) + 1;
    const model = this.modelManager.createModel('subagent')
      || this.modelManager.createModel('primary');

    if (!model) {
      return {
        stepResults: [`[Step ${state.currentStep + 1}] No model available`],
        currentStep: state.currentStep + 1,
        totalStepsExecuted: state.totalStepsExecuted + 1,
        nodeVisits: visits,
      };
    }

    const step = state.plan[state.currentStep];
    const previousSteps = state.stepResults
      .map((r, i) => `Step ${i + 1}: ${compressForLLM(r, Swarm.MAX_STEP_RESULT_CHARS)}`)
      .join('\n');

    const contextStr = Object.entries(state.context)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const userMessage = [
      `Overall task: ${state.task}`,
      contextStr ? `\nContext:\n${contextStr}` : '',
      previousSteps ? `\nCompleted steps:\n${previousSteps}` : '',
      `\nCurrent step (${state.currentStep + 1}/${state.plan.length}): ${step}`,
    ].filter(Boolean).join('\n');

    // Text-only fallback when no toolRegistry
    if (!this.toolRegistry) {
      try {
        const result = await this.invokeWithRecovery(
          model,
          [new SystemMessage(EXECUTOR_SYSTEM_PROMPT), new HumanMessage(userMessage)],
          'executor',
        );

        console.error(`[Swarm/Executor] Step ${state.currentStep + 1} complete`);

        return {
          stepResults: [result],
          currentStep: state.currentStep + 1,
          totalStepsExecuted: state.totalStepsExecuted + 1,
          nodeVisits: visits,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Swarm/Executor] Step ${state.currentStep + 1} error:`, errMsg);

        return {
          stepResults: [`Error: ${errMsg}`],
          currentStep: state.currentStep + 1,
          totalStepsExecuted: state.totalStepsExecuted + 1,
          nodeVisits: visits,
        };
      }
    }

    // Tool-enabled executor path
    this.sendNotification('swarmStepStarted', {
      stepIndex: state.currentStep,
      description: step,
      totalSteps: state.plan.length,
    });

    const toolDescriptions = this.toolRegistry.describeTools();
    const systemPrompt = `${EXECUTOR_SYSTEM_PROMPT}\n\nAvailable tools:\n${toolDescriptions}\n\nIf you need to perform an action, respond ONLY with a single JSON tool call. Format: {"tool":"<tool-name>","params":{...}}. When the step is complete, respond with a text summary (no JSON).`;

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ];

    let lastContent = '';
    let consecutiveFailures = 0;
    const stepDeadline = Date.now() + Swarm.STEP_TIMEOUT_MS;

    try {
      for (let i = 0; i < Swarm.MAX_TOOL_ITERATIONS_PER_STEP; i++) {
        if (this.aborted) break;
        if (Date.now() > stepDeadline) {
          console.error(`[Swarm/Executor] Step ${state.currentStep + 1} timed out`);
          lastContent = lastContent || `Step timed out after ${Swarm.STEP_TIMEOUT_MS / 1000}s`;
          break;
        }

        const content = await this.invokeWithRecovery(model, messages, 'executor');
        lastContent = content;

        const toolCall = this.toolRegistry.parseToolCall(content);
        if (!toolCall) {
          break;
        }

        const toolResult = await this.executeToolCall(toolCall);

        if (!toolResult.ok) {
          consecutiveFailures++;
          if (consecutiveFailures >= Swarm.MAX_CONSECUTIVE_FAILURES) {
            console.error(`[Swarm/Executor] Step ${state.currentStep + 1}: ${consecutiveFailures} consecutive tool failures, moving on`);
            messages.push(new AIMessage(content));
            messages.push(new HumanMessage(
              `Tool ${toolResult.tool} has failed ${consecutiveFailures} times in a row. Stop retrying this tool. Summarize what you were able to accomplish for this step and move on.`
            ));

            this.sendNotification('swarmToolExecuted', {
              stepIndex: state.currentStep,
              tool: toolResult.tool,
              ok: false,
            });

            const fallback = await model.invoke(messages);
            lastContent = typeof fallback.content === 'string'
              ? fallback.content
              : JSON.stringify(fallback.content);
            break;
          }
        } else {
          consecutiveFailures = 0;
        }

        const resultText = toolResult.ok
          ? compressForLLM(JSON.stringify(toolResult.data), Swarm.MAX_TOOL_RESULT_CHARS)
          : (toolResult.error || 'Action failed');
        messages.push(new AIMessage(content));
        messages.push(new HumanMessage(
          `Tool result for ${toolResult.tool}: ${toolResult.ok ? 'Success' : 'Error'}\n${resultText}`
        ));

        this.sendNotification('swarmToolExecuted', {
          stepIndex: state.currentStep,
          tool: toolResult.tool,
          ok: toolResult.ok,
        });

        if (this.aborted) break;
      }

      console.error(`[Swarm/Executor] Step ${state.currentStep + 1} complete`);

      this.sendNotification('swarmStepCompleted', {
        stepIndex: state.currentStep,
        result: lastContent.substring(0, 200),
      });

      return {
        stepResults: [lastContent],
        currentStep: state.currentStep + 1,
        totalStepsExecuted: state.totalStepsExecuted + 1,
        nodeVisits: visits,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Swarm/Executor] Step ${state.currentStep + 1} error:`, errMsg);

      return {
        stepResults: [`Error: ${errMsg}`],
        currentStep: state.currentStep + 1,
        totalStepsExecuted: state.totalStepsExecuted + 1,
        nodeVisits: visits,
      };
    }
  }

  /**
   * Evaluator node: lightweight check after each step.
   * Uses the subagent model (cheaper/faster) to decide if the step succeeded,
   * the task is done, or replanning is needed.
   */
  private async evaluatorNode(state: SwarmStateType): Promise<Partial<SwarmStateType>> {
    const visits = (state.nodeVisits || 0) + 1;

    if (this.aborted) {
      return { evalVerdict: 'done' as EvalVerdict, nodeVisits: visits };
    }

    if (state.totalStepsExecuted >= Swarm.MAX_TOTAL_STEPS) {
      return { evalVerdict: 'done' as EvalVerdict, nodeVisits: visits };
    }

    // Bail out before hitting LangGraph recursion limit — leave room for synthesizer + END
    if (visits >= Swarm.NODE_VISIT_BAIL_THRESHOLD) {
      console.error(`[Swarm/Evaluator] Approaching recursion limit (${visits}/${Swarm.RECURSION_LIMIT}), finishing early`);
      return { evalVerdict: 'done' as EvalVerdict, nodeVisits: visits };
    }

    // Use subagent (cheaper) for evaluation, fall back to primary
    const model = this.modelManager.createModel('subagent')
      || this.modelManager.createModel('primary');

    if (!model) {
      return {
        evalVerdict: (state.currentStep < state.plan.length ? 'ok' : 'done') as EvalVerdict,
        nodeVisits: visits,
      };
    }

    const lastResult = state.stepResults[state.stepResults.length - 1] || '';
    const completedSteps = state.plan.slice(0, state.currentStep)
      .map((step, i) => `${i + 1}. ${step} → ${compressForLLM(state.stepResults[i] || '(no result)', 500)}`)
      .join('\n');

    const remainingSteps = state.plan.slice(state.currentStep)
      .map((step, i) => `${state.currentStep + i + 1}. ${step}`)
      .join('\n');

    const userMessage = [
      `Task: ${state.task}`,
      `\nCompleted:\n${completedSteps || '(none)'}`,
      `\nLatest result:\n${compressForLLM(lastResult, 1000)}`,
      remainingSteps ? `\nRemaining:\n${remainingSteps}` : '\nNo remaining steps.',
    ].join('\n');

    try {
      const content = await this.invokeWithRecovery(
        model,
        [new SystemMessage(EVALUATOR_SYSTEM_PROMPT), new HumanMessage(userMessage)],
        'evaluator',
        1,
      );

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { verdict: string };

        if (parsed.verdict === 'done') {
          console.error('[Swarm/Evaluator] Verdict: done');
          return { evalVerdict: 'done' as EvalVerdict, nodeVisits: visits };
        }
        if (parsed.verdict === 'needs_replan') {
          console.error('[Swarm/Evaluator] Verdict: needs_replan');
          return { evalVerdict: 'needs_replan' as EvalVerdict, nodeVisits: visits };
        }

        console.error('[Swarm/Evaluator] Verdict: ok');
        return { evalVerdict: 'ok' as EvalVerdict, nodeVisits: visits };
      }
    } catch (err) {
      console.error('[Swarm/Evaluator] Error:', err);
    }

    // Fallback: ok if more steps, done otherwise
    return {
      evalVerdict: (state.currentStep < state.plan.length ? 'ok' : 'done') as EvalVerdict,
      nodeVisits: visits,
    };
  }

  /**
   * Replanner node: creative recovery when the evaluator says needs_replan.
   * Uses the primary model (smarter) to devise a new approach.
   */
  private async replannerNode(state: SwarmStateType): Promise<Partial<SwarmStateType>> {
    const visits = (state.nodeVisits || 0) + 1;
    const model = this.modelManager.createModel('primary');
    if (!model) {
      // No model — just continue with what we have or finish
      return {
        evalVerdict: (state.currentStep < state.plan.length ? 'ok' : 'done') as EvalVerdict,
        nodeVisits: visits,
      };
    }

    const completedSteps = state.plan.slice(0, state.currentStep)
      .map((step, i) => `${i + 1}. ${step}\n   Result: ${compressForLLM(state.stepResults[i] || '(no result)', Swarm.MAX_STEP_RESULT_CHARS)}`)
      .join('\n');

    const failedSteps = state.plan.slice(state.currentStep)
      .map((step, i) => `${state.currentStep + i + 1}. ${step}`)
      .join('\n');

    const userMessage = [
      `Original task: ${state.task}`,
      `\nCompleted steps:\n${completedSteps || '(none)'}`,
      failedSteps ? `\nSteps that are no longer viable:\n${failedSteps}` : '',
      `\nBudget: ${Swarm.MAX_TOTAL_STEPS - state.totalStepsExecuted} steps remaining`,
      '\nProvide new steps to accomplish the task using a different approach.',
    ].filter(Boolean).join('\n');

    try {
      const content = await this.invokeWithRecovery(
        model,
        [new SystemMessage(REPLANNER_SYSTEM_PROMPT), new HumanMessage(userMessage)],
        'replanner',
        1,
      );

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const newSteps: string[] = JSON.parse(jsonMatch[0]);
        if (newSteps.length > 0) {
          const completedPlan = state.plan.slice(0, state.currentStep);
          const newPlan = [...completedPlan, ...newSteps];

          console.error(`[Swarm/Replanner] Revised plan: ${newSteps.length} new steps`);

          this.sendNotification('swarmReplan', {
            previousPlan: state.plan,
            newPlan,
            newSteps,
          });

          return {
            plan: newPlan,
            evalVerdict: 'ok' as EvalVerdict,
            nodeVisits: visits,
            // currentStep stays the same — points to first new step
          };
        }
      }
    } catch (err) {
      console.error('[Swarm/Replanner] Error:', err);
    }

    // Fallback: couldn't replan, finish with what we have
    console.error('[Swarm/Replanner] Failed to produce new plan, finishing');
    return { evalVerdict: 'done' as EvalVerdict, nodeVisits: visits };
  }

  private async invokeWithRecovery(
    model: { invoke: (messages: BaseMessage[]) => Promise<{ content: string | unknown }> },
    messages: BaseMessage[],
    operation: string,
    maxRetries: number = MAX_RECOVERY_RETRIES,
  ): Promise<string> {
    let lastError: Error | null = null;
    let currentMessages = [...messages];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await model.invoke(currentMessages);
        return typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;

        if (!isRetryable(error) || attempt >= maxRetries) {
          throw error;
        }

        console.error(`[Swarm] Retryable error on ${operation} (attempt ${attempt + 1}/${maxRetries}): ${error.message}`);

        this.sendNotification('swarmRecoveryAttempted', {
          operation,
          error: error.message,
          attempt: attempt + 1,
          maxRetries,
        });

        currentMessages = [
          ...currentMessages,
          new HumanMessage(
            `The previous call failed: ${error.message}. Adjust your approach.`
          ),
        ];
      }
    }

    throw lastError || new Error('Recovery exhausted');
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (this.notify) {
      this.notify(method, params);
    }
  }

  private async executeToolCall(toolCall: ParsedToolCall): Promise<{
    tool: string;
    ok: boolean;
    data?: unknown;
    error?: string;
  }> {
    if (toolCall.kind === 'invalid') {
      return { tool: toolCall.tool || 'unknown', ok: false, error: toolCall.error };
    }
    if (toolCall.kind === 'terminal') {
      if (!this.commandExecutor) {
        return { tool: toolCall.tool, ok: false, error: 'Command execution unavailable.' };
      }
      try {
        const result = await this.commandExecutor.execute(toolCall.command, toolCall.args, toolCall.cwd);
        return { tool: toolCall.tool, ok: result.exitCode === 0, ...result };
      } catch (err) {
        return { tool: toolCall.tool, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    if (!this.dispatcher) {
      return { tool: toolCall.tool, ok: false, error: 'Agent dispatcher unavailable.' };
    }
    try {
      const result = await this.dispatcher.request({
        capability: toolCall.capability,
        action: toolCall.action,
        params: toolCall.params,
        destructive: toolCall.destructive,
      });
      return result.ok
        ? { tool: toolCall.tool, ok: true, data: result.data }
        : { tool: toolCall.tool, ok: false, error: result.error?.message || 'Action failed' };
    } catch (err) {
      return { tool: toolCall.tool, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Synthesizer node: combines all step results into a final response. */
  private async synthesizerNode(state: SwarmStateType): Promise<Partial<SwarmStateType>> {
    const visits = (state.nodeVisits || 0) + 1;
    if (state.stepResults.length === 1) {
      return { finalResult: state.stepResults[0], nodeVisits: visits };
    }

    const model = this.modelManager.createModel('primary');
    if (!model) {
      return {
        finalResult: state.stepResults.join('\n\n'),
        nodeVisits: visits,
      };
    }

    const stepsWithResults = state.plan
      .map((step, i) => `Step: ${step}\nResult: ${state.stepResults[i] || '(no result)'}`)
      .join('\n\n');

    try {
      const content = await this.invokeWithRecovery(
        model,
        [
          new SystemMessage('Synthesize the results of the completed steps into a clear, cohesive response for the user. Be concise.'),
          new HumanMessage(`Task: ${state.task}\n\n${stepsWithResults}`),
        ],
        'synthesizer',
        1,
      );

      return { finalResult: content, nodeVisits: visits };
    } catch {
      return {
        finalResult: state.stepResults.join('\n\n'),
        nodeVisits: visits,
      };
    }
  }
}
