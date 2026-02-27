import { WorkflowConfig, SourceInput } from '../types/index.js';
import { ApiKeys, getRequiredProviders } from '../llm/gateway.js';

export interface ValidationError {
  type: 'error' | 'warning';
  message: string;
  task_id?: string;
  step?: number;
}

/**
 * Workflow Validator — Compile-time checks before execution.
 * Returns a list of errors/warnings.
 */
export function validateWorkflow(
  config: WorkflowConfig,
  source: SourceInput | null,
  apiKeys: ApiKeys
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check active editor / source
  if (!source) {
    errors.push({
      type: 'error',
      message: 'No active editor found. Please open a file before running.',
    });
  }

  if (source && source.byte_size > 100 * 1024) {
    errors.push({
      type: 'warning',
      message: `Input file is ${Math.round(source.byte_size / 1024)}KB (limit: 100KB). Content will be truncated.`,
    });
  }

  // Collect all output keys
  const outputKeys = new Set<string>();
  // output_keys per step (for parallel duplicate detection)
  const stepOutputKeys: Map<number, Set<string>> = new Map();

  for (const step of config.workflow) {
    const stepKeys = stepOutputKeys.get(step.step) ?? new Set<string>();

    for (const task of step.tasks) {
      // Check agent existence
      const agentExists = config.agents.some((a) => a.id === task.agent_id);
      if (!agentExists) {
        errors.push({
          type: 'error',
          message: `Task "${task.task_id}" references unknown agent "${task.agent_id}".`,
          task_id: task.task_id,
          step: step.step,
        });
      }

      // Check parallel duplicate output keys (same step, same key = conflict)
      if (step.type === 'parallel' && stepKeys.has(task.output_key)) {
        errors.push({
          type: 'error',
          message: `Duplicate output_key "${task.output_key}" in parallel step ${step.step}.`,
          task_id: task.task_id,
          step: step.step,
        });
      }
      stepKeys.add(task.output_key);
      outputKeys.add(task.output_key);

      // Check input_mapping references
      for (const mapping of task.input_mapping) {
        if (mapping.from_agent_id === '__source__') continue;
        // Find referenced agent's task
        const refTask = config.workflow
          .flatMap((s) => s.tasks)
          .find((t) => t.agent_id === mapping.from_agent_id);
        if (!refTask) {
          errors.push({
            type: 'error',
            message: `Task "${task.task_id}" input_mapping references unknown agent "${mapping.from_agent_id}".`,
            task_id: task.task_id,
            step: step.step,
          });
        }
      }
    }

    stepOutputKeys.set(step.step, stepKeys);

    // Check conditional config
    if (step.type === 'conditional') {
      if (!step.condition) {
        errors.push({
          type: 'error',
          message: `Step ${step.step} is type "conditional" but has no condition config.`,
          step: step.step,
        });
      }

      if (step.on_fail_goto !== undefined) {
        const targetExists = config.workflow.some((s) => s.step === step.on_fail_goto);
        if (!targetExists) {
          errors.push({
            type: 'error',
            message: `Step ${step.step}: on_fail_goto=${step.on_fail_goto} references a non-existent step.`,
            step: step.step,
          });
        }
      }
    }

    // Check then_goto
    if (step.then_goto !== undefined) {
      const targetExists = config.workflow.some((s) => s.step === step.then_goto);
      if (!targetExists) {
        errors.push({
          type: 'error',
          message: `Step ${step.step}: then_goto=${step.then_goto} references a non-existent step.`,
          step: step.step,
        });
      }
    }
  }

  // Check API keys for required providers (Ollama is local — no key needed)
  const models = config.agents.map((a) => a.model);
  try {
    const requiredProviders = getRequiredProviders(models);
    for (const provider of requiredProviders) {
      if (provider === 'ollama') continue; // local — no API key required
      if (!apiKeys[provider as 'openai' | 'anthropic' | 'google']) {
        errors.push({
          type: 'error',
          message: `API key for "${provider}" is not configured. Please set it in extension settings.`,
        });
      }
    }
  } catch (err) {
    errors.push({ type: 'error', message: `Model validation error: ${(err as Error).message}` });
  }

  return errors;
}
