import {
  WorkflowConfig,
  SourceInput,
  DryRunResult,
  DryRunStepResult,
  DryRunTaskResult,
} from '../types/index.js';
import { PromptBuilder } from './promptBuilder.js';
import { StateManager } from './stateManager.js';
import { estimateTokens } from '../llm/tokenCounter.js';
import { getCostForTokens } from '../llm/pricing.js';
import { getProviderFromModel } from '../llm/gateway.js';

/**
 * Dry Runner — Builds prompts and estimates costs WITHOUT calling any LLM API.
 */
export class DryRunner {
  run(config: WorkflowConfig, source: SourceInput): DryRunResult {
    const stateManager = new StateManager();
    stateManager.setSource(source);

    const promptBuilder = new PromptBuilder(stateManager, source);
    const steps: DryRunStepResult[] = [];
    const providers = new Set<string>();

    let totalMinTokens = 0;
    let totalMaxTokens = 0;
    const maxLoopFactor = 3; // worst case: 3 loops

    for (const step of config.workflow) {
      const taskResults: DryRunTaskResult[] = [];

      for (const task of step.tasks) {
        const agent = config.agents.find((a) => a.id === task.agent_id);
        if (!agent) continue;

        const systemPrompt = promptBuilder.buildSystemPrompt(agent, task);
        const userPrompt = promptBuilder.buildUserPrompt(task, config);
        const estimatedInputTokens = estimateTokens(systemPrompt + userPrompt);

        taskResults.push({
          task_id: task.task_id,
          task_name: task.task_name,
          agent_name: agent.name,
          model: agent.model,
          system_prompt: systemPrompt,
          user_prompt: userPrompt,
          estimated_input_tokens: estimatedInputTokens,
        });

        providers.add(getProviderFromModel(agent.model));
        totalMinTokens += estimatedInputTokens;

        // Max = min * maxLoopFactor for conditional steps
        if (step.type === 'conditional') {
          totalMaxTokens += estimatedInputTokens * maxLoopFactor;
        } else {
          totalMaxTokens += estimatedInputTokens;
        }
      }

      steps.push({ step: step.step, type: step.type, tasks: taskResults });
    }

    // Estimate output tokens as ~50% of input tokens on average
    const estimatedOutputMin = Math.floor(totalMinTokens * 0.5);
    const estimatedOutputMax = Math.floor(totalMaxTokens * 0.5);

    // Calculate costs using a rough average across models
    const allModels = config.agents.map((a) => a.model);
    let minCost = 0;
    let maxCost = 0;
    for (const model of allModels) {
      minCost += getCostForTokens(model, totalMinTokens / allModels.length, estimatedOutputMin / allModels.length);
      maxCost += getCostForTokens(model, totalMaxTokens / allModels.length, estimatedOutputMax / allModels.length);
    }

    return {
      steps,
      total_min_tokens: totalMinTokens + estimatedOutputMin,
      total_max_tokens: totalMaxTokens + estimatedOutputMax,
      estimated_min_cost_usd: minCost,
      estimated_max_cost_usd: maxCost,
      providers: Array.from(providers),
    };
  }
}
