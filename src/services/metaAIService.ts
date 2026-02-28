import { WorkflowConfig, LLMModel, SourceInput } from '../types/index.js';
import { getGateway, ApiKeys } from '../llm/gateway.js';

const META_AI_SYSTEM_PROMPT_TEMPLATE = `You are an expert AI project manager and orchestrator. \
Analyze the user's request and decompose it into concrete, independently executable tasks \
for a team of AI agents. Each task must be specific enough that an agent can execute it without \
asking follow-up questions.

CONTEXT (active file in editor):
- Filename: {{filename}}
- Language: {{language_id}}
- Lines: {{line_count}}

DECOMPOSITION RULES:
1. Break each task's instructions into 3–5 concrete, verb-first steps (e.g. "Analyze X", "Write Y", "Review Z").
2. Choose task types carefully:
   - "parallel": tasks with NO dependencies on each other (can run simultaneously)
   - "sequential": tasks where each depends on the previous step's output
   - "conditional": review→revise loops where a later step may loop back
3. Every task MUST have a unique output_key (snake_case, e.g. "api_spec", "test_suite").
4. Use input_mapping to wire outputs between steps:
   - from_step: 0, from_agent_id: "__source__" → the active file content (always available)
   - from_step: N, from_agent_id: "agent_XXX" → the output_key produced by that agent in step N
   - Tasks in step 2 that depend on step 1 output MUST use "sequential" type.
5. Set pause_after: true only for steps requiring human review before continuing.
6. Assign the most appropriate model per agent:
   - Complex reasoning / architecture → gpt-4o or claude-sonnet-4-6
   - Fast iteration / summaries → gpt-4o-mini or claude-haiku-4-5
   - Long-context tasks → gemini-1.5-pro or gemini-2.0-flash
7. Every agent must have a clear persona describing their specialty.

AVAILABLE MODELS:
- OpenAI: gpt-4o, gpt-4o-mini, o3-mini
- Anthropic: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5
- Google: gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash

OUTPUT FORMAT:
Output ONLY the JSON object below. No markdown fences, no explanation.

{
  "agents": [
    {
      "id": "agent_001",
      "name": "Agent display name",
      "persona": "Expert description of this agent's role and specialty",
      "model": "gpt-4o"
    }
  ],
  "workflow": [
    {
      "step": 1,
      "type": "parallel",
      "pause_after": false,
      "tasks": [
        {
          "task_id": "task_001",
          "agent_id": "agent_001",
          "task_name": "Short task name",
          "instructions": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
          "constraints": ["Do not ...", "Keep output under ..."],
          "output_format": "Markdown",
          "output_key": "unique_output_key",
          "input_mapping": [
            { "from_step": 0, "from_agent_id": "__source__", "label": "Source file" }
          ],
          "enable_handover_note": false
        }
      ]
    },
    {
      "step": 2,
      "type": "sequential",
      "pause_after": false,
      "tasks": [
        {
          "task_id": "task_002",
          "agent_id": "agent_001",
          "task_name": "Review and improve",
          "instructions": ["Step 1: Read the output from step 1", "Step 2: ..."],
          "constraints": ["Preserve the original structure"],
          "output_format": "Markdown",
          "output_key": "reviewed_output",
          "input_mapping": [
            { "from_step": 1, "from_agent_id": "agent_001", "label": "Draft from step 1" }
          ],
          "enable_handover_note": true
        }
      ]
    }
  ]
}`;

export class MetaAIService {
  constructor(
    private readonly apiKeys: ApiKeys,
    private readonly model: LLMModel = 'gpt-4o'
  ) {}

  async generateWorkflow(instruction: string, source: SourceInput | null): Promise<WorkflowConfig> {
    const systemPrompt = META_AI_SYSTEM_PROMPT_TEMPLATE
      .replace('{{filename}}', source?.filename ?? '(none)')
      .replace('{{language_id}}', source?.language_id ?? 'unknown')
      .replace('{{line_count}}', String(source?.line_count ?? 0));

    const userPrompt = `Design a workflow for the following request:\n\n${instruction}`;

    const gateway = getGateway(this.model, this.apiKeys);
    const response = await gateway.chat({
      model: this.model,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      max_tokens: 4096,
      temperature: 0.2, // Very low for deterministic, valid JSON output
    });

    return this.parseResponse(response.content);
  }

  private parseResponse(content: string): WorkflowConfig {
    // Strip markdown code fences if present
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    // Try to extract JSON object from response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr) as WorkflowConfig;
      this.validateConfig(parsed);
      return parsed;
    } catch (err) {
      throw new Error(`MetaAI returned invalid JSON: ${(err as Error).message}\nContent: ${content.slice(0, 500)}`);
    }
  }

  /**
   * Expand a short user brief into a full, structured markdown instruction
   * document for a single agent. Used by the "Draft with AI" feature in AgentCard.
   */
  async draftAgentInstruction(
    brief: string,
    ctx: { agentName: string; persona: string; taskName: string; fileName?: string }
  ): Promise<string> {
    const systemPrompt = `You are an expert AI prompt engineer. \
Your job is to expand a user's rough task description into a precise, \
comprehensive markdown instruction document for an AI agent. \
The document must be detailed enough that the agent can execute the task \
correctly without asking follow-up questions.

Structure your output with these sections (use ## headings):
## Objective
One paragraph stating exactly what success looks like.

## Step-by-step Process
Numbered steps. Each step should be specific and actionable. \
Include substeps where needed. Aim for 4-8 steps.

## Input Handling
How to read and interpret the provided input content.

## Output Requirements
Exact format, structure, length, and quality bar expected.

## Key Considerations
Bullet list of important nuances, edge cases, and things to watch for.

## Constraints
Things the agent must NOT do (omissions, scope limits, style rules, etc.).

Output only the markdown document. No preamble. No explanation. No code fences.`;

    const userPrompt =
      `Agent name: ${ctx.agentName}\n` +
      `Agent persona: ${ctx.persona || '(not specified)'}\n` +
      `Task name: ${ctx.taskName}\n` +
      (ctx.fileName ? `Working on file: ${ctx.fileName}\n` : '') +
      `\nUser's brief:\n${brief}\n\n` +
      `Write comprehensive instructions for this agent.`;

    const gateway = getGateway(this.model, this.apiKeys);
    const response = await gateway.chat({
      model: this.model,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      max_tokens: 2048,
      temperature: 0.4,
    });

    return response.content.trim();
  }

  private validateConfig(config: unknown): asserts config is WorkflowConfig {
    const c = config as WorkflowConfig;
    if (!Array.isArray(c.agents) || !Array.isArray(c.workflow)) {
      throw new Error('Invalid WorkflowConfig: missing agents or workflow array.');
    }

    // Build lookup sets for richer validation
    const agentIds = new Set(c.agents.map((a) => a.id));
    const outputKeysSeen = new Set<string>();
    const stepNumbers = new Set(c.workflow.map((s) => s.step));

    for (const step of c.workflow) {
      for (const task of step.tasks ?? []) {
        // agent_id must reference a declared agent
        if (!agentIds.has(task.agent_id)) {
          throw new Error(
            `Task "${task.task_id}" references unknown agent_id "${task.agent_id}". ` +
            `Declared agents: ${[...agentIds].join(', ')}`
          );
        }
        // output_key must be unique across all tasks
        if (task.output_key) {
          if (outputKeysSeen.has(task.output_key)) {
            throw new Error(`Duplicate output_key "${task.output_key}" found in task "${task.task_id}".`);
          }
          outputKeysSeen.add(task.output_key);
        }
        // input_mapping from_step must point to an existing step (or 0 for source)
        for (const mapping of task.input_mapping ?? []) {
          if (mapping.from_step !== 0 && !stepNumbers.has(mapping.from_step)) {
            throw new Error(
              `Task "${task.task_id}" input_mapping references non-existent step ${mapping.from_step}.`
            );
          }
        }
        // instructions must not be empty
        if (!Array.isArray(task.instructions) || task.instructions.length === 0) {
          throw new Error(`Task "${task.task_id}" has no instructions.`);
        }
      }
    }
  }
}
