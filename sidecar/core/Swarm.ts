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

/**
 * Swarm implements a multi-agent planner-executor pattern using LangGraph.
 * The planner node (primary model) decomposes tasks into steps.
 * The executor node (sub-agent model) carries out each step sequentially.
 * Graph flow: planner -> executor (loop) -> synthesizer -> END
 */
export class Swarm {
  private static readonly MAX_TOOL_ITERATIONS_PER_STEP = 10;

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
    });

    return result.finalResult;
  }

  private buildGraph() {
    const graph = new StateGraph(SwarmState)
      .addNode('planner', (state: SwarmStateType) => this.plannerNode(state))
      .addNode('executor', (state: SwarmStateType) => this.executorNode(state))
      .addNode('synthesizer', (state: SwarmStateType) => this.synthesizerNode(state))
      .addEdge('__start__', 'planner')
      .addEdge('planner', 'executor')
      .addConditionalEdges('executor', (state: SwarmStateType) => {
        // Continue executing steps or move to synthesis
        if (state.currentStep < state.plan.length) {
          return 'executor';
        }
        return 'synthesizer';
      })
      .addEdge('synthesizer', END);

    return graph;
  }

  /** Planner node: breaks the task into steps using the primary model. */
  private async plannerNode(state: SwarmStateType): Promise<Partial<SwarmStateType>> {
    const model = this.modelManager.createModel('primary');
    if (!model) {
      return {
        plan: [state.task],
        currentStep: 0,
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
      const response = await model.invoke(messages);
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      // Parse the JSON array of steps
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const steps: string[] = JSON.parse(jsonMatch[0]);
        console.error(`[Swarm/Planner] ${steps.length} steps planned`);
        this.sendNotification('swarmPlanReady', { steps, task: state.task });
        return {
          plan: steps,
          currentStep: 0,
        };
      }
    } catch (err) {
      console.error('[Swarm/Planner] Error:', err);
    }

    // Fallback: single-step plan
    return {
      plan: [state.task],
      currentStep: 0,
    };
  }

  /** Executor node: executes the current step using the sub-agent (or primary) model. */
  private async executorNode(state: SwarmStateType): Promise<Partial<SwarmStateType>> {
    // Prefer sub-agent model, fall back to primary
    const model = this.modelManager.createModel('subagent')
      || this.modelManager.createModel('primary');

    if (!model) {
      return {
        stepResults: [`[Step ${state.currentStep + 1}] No model available`],
        currentStep: state.currentStep + 1,
      };
    }

    const step = state.plan[state.currentStep];
    const previousSteps = state.stepResults
      .map((r, i) => `Step ${i + 1}: ${r}`)
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

    // If no toolRegistry, fall back to text-only behavior (just call LLM once)
    if (!this.toolRegistry) {
      try {
        const response = await model.invoke([
          new SystemMessage(EXECUTOR_SYSTEM_PROMPT),
          new HumanMessage(userMessage),
        ]);

        const result = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

        console.error(`[Swarm/Executor] Step ${state.currentStep + 1} complete`);

        return {
          stepResults: [result],
          currentStep: state.currentStep + 1,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Swarm/Executor] Step ${state.currentStep + 1} error:`, errMsg);

        return {
          stepResults: [`Error: ${errMsg}`],
          currentStep: state.currentStep + 1,
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

    try {
      for (let i = 0; i < Swarm.MAX_TOOL_ITERATIONS_PER_STEP; i++) {
        if (this.aborted) break;

        const response = await model.invoke(messages);
        const content = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
        lastContent = content;

        const toolCall = this.toolRegistry.parseToolCall(content);
        if (!toolCall) {
          // No tool call found — step is done
          break;
        }

        // Execute the tool call
        const toolResult = await this.executeToolCall(toolCall);

        // Append AI message and tool result to messages
        messages.push(new AIMessage(content));
        messages.push(new HumanMessage(
          `Tool result for ${toolResult.tool}: ${toolResult.ok ? 'Success' : 'Error'}\n${
            toolResult.ok ? JSON.stringify(toolResult.data) : toolResult.error
          }`
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
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Swarm/Executor] Step ${state.currentStep + 1} error:`, errMsg);

      return {
        stepResults: [`Error: ${errMsg}`],
        currentStep: state.currentStep + 1,
      };
    }
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
    // If only one step, return its result directly
    if (state.stepResults.length === 1) {
      return { finalResult: state.stepResults[0] };
    }

    const model = this.modelManager.createModel('primary');
    if (!model) {
      return {
        finalResult: state.stepResults.join('\n\n'),
      };
    }

    const stepsWithResults = state.plan
      .map((step, i) => `Step: ${step}\nResult: ${state.stepResults[i] || '(no result)'}`)
      .join('\n\n');

    try {
      const response = await model.invoke([
        new SystemMessage('Synthesize the results of the completed steps into a clear, cohesive response for the user. Be concise.'),
        new HumanMessage(`Task: ${state.task}\n\n${stepsWithResults}`),
      ]);

      const result = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      return { finalResult: result };
    } catch {
      // Fallback: join step results
      return {
        finalResult: state.stepResults.join('\n\n'),
      };
    }
  }
}
