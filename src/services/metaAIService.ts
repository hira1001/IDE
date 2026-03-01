import { WorkflowConfig, LLMModel, SourceInput, ProjectContext } from '../types/index.js';
import { getGateway, ApiKeys } from '../llm/gateway.js';

const META_AI_SYSTEM_PROMPT_TEMPLATE = `You are an expert AI project manager and orchestrator. \
Analyze the user's request and decompose it into concrete, independently executable tasks \
for a team of AI agents. Each task must be specific enough that an agent can execute it without \
asking follow-up questions.

CONTEXT (active file in editor):
- Filename: {{filename}}
- Language: {{language_id}}
- Lines: {{line_count}}

PROJECT CONTEXT (workspace structure and key files):
{{project_context}}

DECOMPOSITION RULES:
1. Break each task's instructions into 3–5 concrete, verb-first steps (e.g. "Analyze X", "Write Y", "Review Z").
2. Choose task types carefully:
   - "parallel": tasks with NO dependencies on each other (can run simultaneously)
   - "sequential": tasks where each depends on the previous step's output
   - "conditional": review→revise loops where a later step may loop back
3. Every task MUST have a unique output_key (snake_case, e.g. "api_spec", "test_suite").
4. Use input_mapping to wire outputs between steps:
   - from_step: 0, from_agent_id: "__project__" → full project context including file tree and related files (PREFERRED for most tasks)
   - from_step: 0, from_agent_id: "__source__" → only the single active editor file
   - from_step: 0, from_agent_id: "__tree__" → project file tree only (lightweight)
   - from_step: N, from_agent_id: "agent_XXX" → the output_key produced by that agent in step N
   - Tasks in step 2 that depend on step 1 output MUST use "sequential" type.
   - For the FIRST step, ALWAYS use __project__ so the agent can see the full project structure and files.
5. Set pause_after: true only for steps requiring human review before continuing.
6. IMPORTANT: Set the model for ALL agents to exactly "{{default_model}}". Do not use any other model.
7. Every agent must have a clear persona describing their specialty.
8. IMPORTANT: Set "use_tools": true, "auto_apply_edits": true, and "max_tool_iterations": 15 on EVERY task. This enables agents to autonomously read files, edit code, search the codebase, and run terminal commands.
9. IMPORTANT: All output strings (agent name, persona, tasks, instructions) MUST be generated in {{target_language}} language.

AVAILABLE MODELS:
{{available_models}}

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
            { "from_step": 0, "from_agent_id": "__project__", "label": "Project context" }
          ],
          "enable_handover_note": false,
          "use_tools": true,
          "auto_apply_edits": true,
          "max_tool_iterations": 15
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
          "enable_handover_note": true,
          "use_tools": true,
          "auto_apply_edits": true,
          "max_tool_iterations": 15
        }
      ]
    }
  ]
}`;

export class MetaAIService {
  constructor(
    private readonly apiKeys: ApiKeys,
    private readonly model: LLMModel = 'gpt-4o'
  ) { }

  private buildAvailableModelsSection(): string {
    const lines: string[] = [];
    if (this.apiKeys.openai) lines.push('- OpenAI: gpt-4o, gpt-4o-mini');
    if (this.apiKeys.anthropic) lines.push('- Anthropic: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5');
    if (this.apiKeys.google) lines.push('- Google: gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash');
    if (this.apiKeys.ollama) lines.push('- Local (Ollama): use "ollama:<model>" prefix, e.g. "ollama:llama3.2"');
    return lines.length > 0 ? lines.join('\n') : '- OpenAI: gpt-4o, gpt-4o-mini';
  }

  async generateWorkflow(
    instruction: string,
    source: SourceInput | null,
    targetLanguage: string = 'en',
    projectContext?: ProjectContext | null
  ): Promise<WorkflowConfig> {
    const filename = source?.filename ?? '(none)';
    const languageId = source?.language_id ?? 'unknown';
    const lineCount = String(source?.line_count ?? 0);
    const modelsSection = this.buildAvailableModelsSection();
    const projectCtxBlock = projectContext
      ? MetaAIService.buildProjectContextForPrompt(projectContext)
      : '(no project context available)';
    // Use replacer functions so `$` characters in values aren't misinterpreted
    // by String.replace (e.g. `$&`, `$'`, `$n` have special meaning in replacement strings)
    const systemPrompt = META_AI_SYSTEM_PROMPT_TEMPLATE
      .replace('{{filename}}', () => filename)
      .replace('{{language_id}}', () => languageId)
      .replace('{{line_count}}', () => lineCount)
      .replace('{{available_models}}', () => modelsSection)
      .replace('{{default_model}}', () => this.model)
      .replace('{{target_language}}', () => targetLanguage)
      .replace('{{project_context}}', () => projectCtxBlock);

    const userPrompt = `Design a workflow for the following request:\n\n${instruction}`;

    const gateway = getGateway(this.model, this.apiKeys);

    // Retry up to 2 times if LLM returns empty content
    const MAX_RETRIES = 2;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await gateway.chat({
        model: this.model,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        max_tokens: 4096,
        temperature: 0.2,
      });

      if (!response.content || response.content.trim().length === 0) {
        lastError = new Error(
          `LLM (${this.model}) returned an empty response. ` +
          `This may mean the model is temporarily unavailable or the API key quota is exhausted. ` +
          `Try a different model in Settings (e.g. gemini-2.0-flash) or check your API key.`
        );
        continue; // retry
      }

      try {
        const config = this.parseResponse(response.content);
        // Force all generated agents to use the configured default model
        for (const agent of config.agents) {
          agent.model = this.model;
        }
        // Force Agent Mode (ReAct loop with tools) on all tasks
        for (const step of config.workflow) {
          for (const task of step.tasks) {
            task.use_tools = true;
            task.auto_apply_edits = task.auto_apply_edits ?? true;
            task.max_tool_iterations = task.max_tool_iterations ?? 15;
          }
        }
        return config;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // If JSON parse failed, retry
        continue;
      }
    }

    throw lastError ?? new Error('Workflow generation failed after retries.');
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
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`MetaAI returned invalid JSON: ${msg}\nContent: ${content.slice(0, 500)}`);
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

  /**
   * Build a rich project context string for inclusion in the Meta-AI system prompt.
   * Includes: file tree, project metadata, active file content, and full related file contents.
   * The ProjectContextProvider already applies a token budget to limit the number of related
   * files included, so files that ARE included are passed in full for complete understanding.
   */
  static buildProjectContextForPrompt(ctx: ProjectContext): string {
    const parts: string[] = [];

    // Project metadata
    if (ctx.meta) {
      parts.push(`Project: ${ctx.meta.name}`);
      parts.push(`Primary Language: ${ctx.meta.primaryLanguage}`);
      if (ctx.meta.framework) parts.push(`Framework: ${ctx.meta.framework}`);
      parts.push(`Total Files: ${ctx.meta.totalFiles}`);
      parts.push('');
    }

    // File tree (compact overview)
    if (ctx.fileTree) {
      parts.push('File Structure:');
      parts.push(ctx.fileTree);
      parts.push('');
    }

    // Active file — full content
    if (ctx.activeFile) {
      parts.push(`Active File: ${ctx.activeFile.filename} [${ctx.activeFile.language_id}] (${ctx.activeFile.line_count} lines)`);
      parts.push(ctx.activeFile.content);
      parts.push('');
    }

    // Related files — full content (budget-controlled by ProjectContextProvider)
    if (ctx.relatedFiles && ctx.relatedFiles.length > 0) {
      parts.push(`Related Files (${ctx.relatedFiles.length}):`);
      for (const f of ctx.relatedFiles) {
        parts.push(`--- ${f.relativePath} [${f.language_id}] (${f.line_count} lines, reason: ${f.reason}) ---`);
        parts.push(f.content);
        parts.push('');
      }
    }

    return parts.join('\n');
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

  /**
   * Generate a Markdown workflow plan from a user prompt.
   * Produces human-readable Markdown that an external AI agent
   * (Antigravity, Cursor, etc.) can follow step-by-step.
   */
  async generatePlan(prompt: string, language: string = 'ja', config?: WorkflowConfig): Promise<string> {
    const systemPrompt = PLAN_PROMPT_TEMPLATE[language] ?? PLAN_PROMPT_TEMPLATE['en'];

    // Build a rich user prompt that includes full workflow context
    let userPrompt = prompt ? `## ユーザーの指示\n${prompt}\n\n` : '';

    if (config) {
      userPrompt += '## 生成済みワークフロー構成\n\n';
      for (const step of config.workflow) {
        userPrompt += `### Step ${step.step} (${step.type})\n`;
        for (const task of step.tasks) {
          const agent = config.agents.find(a => a.id === task.agent_id);
          if (agent) {
            userPrompt += `\n#### Agent: ${agent.name}\n`;
            userPrompt += `- **Model:** ${agent.model}\n`;
            userPrompt += `- **Persona:** ${agent.persona}\n`;
            userPrompt += `- **Task:** ${task.task_name}\n`;
            userPrompt += `- **Instructions:**\n${task.instructions}\n`;
            if (task.output_key) {
              userPrompt += `- **Output Key:** ${task.output_key}\n`;
            }
          }
        }
        userPrompt += '\n';
      }
      userPrompt += '\n上記のワークフロー構成の全情報を漏れなく反映した計画書を生成してください。各Agentのinstructionsに記載された作業内容をすべて含め、さらに構造化・改善してください。\n';
    }

    const gateway = getGateway(this.model, this.apiKeys);
    const response = await gateway.chat({
      model: this.model,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      max_tokens: 8192,
      temperature: 0.3,
    });

    if (!response.content || response.content.trim().length === 0) {
      throw new Error(
        `LLM (${this.model}) returned an empty response. ` +
        `Check your API key or try a different model.`
      );
    }

    return response.content.trim();
  }
}

// ─── Plan generation prompt templates ───────────────────────────────────────

const PLAN_PROMPT_TEMPLATE: Record<string, string> = {
  ja: `あなたはAIプロジェクトマネージャーです。ユーザーの指示を分析し、AIエージェントが実行するための「ワークフロー計画書」をMarkdown形式で生成してください。

## ルール

1. ユーザーの指示を複数のMilestoneに分解する。各Milestoneに固有のペルソナ（役割）を割り当てる。
2. 各Milestoneには以下を含める:
   - ペルソナ（そのステップの担当者の役割と専門性）
   - 具体的なタスクリスト
   - 完了条件（受け入れ基準）
   - ファイルのヒント（拘束力なし — AIの判断で最適なファイルを選んでよい）
3. 並列実行可能なMilestoneは明示する（依存関係がないもの）
4. レビューや検証のMilestoneには回帰条件を設ける（重大な問題→前のMilestoneに戻る、最大3回）
5. 回帰上限に達した場合は作業停止し、人間に相談するよう指示する
6. ユーザーの指示の意図と方向性を正しく汲み取り、さらに良い構造に改善してよい

## 出力フォーマット

以下のMarkdown形式を厳密に守ってください:

# ワークフロー計画書: [タイトル]

## 概要
[プロジェクトの目的と概要を2-3文で]

## フロー
[ASCII図でMilestone間の依存関係、並列、回帰を表現]

## M1: [Milestone名]
**ペルソナ:** [役割名] — [一文の説明]

[タスクの説明（番号付きリスト）]

**ヒント:** [関連しそうなディレクトリやファイル（拘束力なし）]
**完了条件:** [具体的な受け入れ基準]

## M2: [Milestone名]
...

## 進捗
- [ ] M1: [名前]
- [ ] M2: [名前]
...

## 判断ログ
（各Milestoneで下した重要な判断と理由を記録）

## 発見メモ
（作業中の予期せぬ発見を記録）

## 成果と振り返り
（全Milestone完了後にAIが自動記入）`,

  en: `You are an AI project manager. Analyze the user's request and generate a "Workflow Plan" in Markdown format for an AI agent to execute.

## Rules

1. Decompose the user's request into multiple Milestones. Assign a unique persona (role) to each Milestone.
2. Each Milestone must include:
   - Persona (the role and expertise of the person responsible for this step)
   - Specific task list
   - Completion criteria (acceptance criteria)
   - File hints (non-binding — the AI may choose optimal files at its discretion)
3. Explicitly mark Milestones that can run in parallel (no dependencies)
4. Review/verification Milestones should have regression conditions (critical issues → go back to previous Milestone, max 3 times)
5. If regression limit is reached, stop work and consult the human
6. Correctly capture the intent and direction of the user's instructions, and improve the structure

## Output Format

Strictly follow this Markdown format:

# Workflow Plan: [Title]

## Overview
[Purpose and overview in 2-3 sentences]

## Flow
[ASCII diagram showing dependencies, parallelism, and regression between Milestones]

## M1: [Milestone Name]
**Persona:** [Role] — [One-line description]

[Task description (numbered list)]

**Hints:** [Relevant directories or files (non-binding)]
**Completion Criteria:** [Specific acceptance criteria]

## M2: [Milestone Name]
...

## Progress
- [ ] M1: [Name]
- [ ] M2: [Name]
...

## Decision Log
(Record important decisions and rationale at each Milestone)

## Discovery Notes
(Record unexpected findings during work)

## Outcomes & Retrospective
(AI fills in after all Milestones are completed)`,
};
