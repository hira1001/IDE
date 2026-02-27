import { WorkflowConfig, LLMModel, SourceInput } from '../types/index.js';
import { getGateway, ApiKeys } from '../llm/gateway.js';

const META_AI_SYSTEM_PROMPT_TEMPLATE = `あなたは優秀なプロジェクトマネージャーであり、AIエージェントのオーケストレーターです。ユーザーからの曖昧な依頼を分析し、各AIエージェントが迷いなく実行できるレベルの具体的な作業手順に分解・構造化してください。

【コンテキスト】
- 処理対象ファイル: {{filename}}
- ファイルの種類: {{language_id}}
- ファイルの行数: {{line_count}}

【ルール】
1. instructions（具体的な作業ステップ）を3〜5項目にブレイクダウン
2. constraints（制約事項や禁止事項）を必ず設定
3. output_format（出力形式）を明確に指定
4. 依存関係のないタスクは parallel に、依存があるものは sequential に
5. レビュー→修正のパターンには conditional ステップを使用
6. 各タスクの input_mapping と output_key を明示的に指定すること
7. 重要な中間確認が必要なステップには pause_after: true を設定

【利用可能なモデル】
- OpenAI: gpt-4o, gpt-4o-mini, gpt-4-turbo
- Anthropic: claude-sonnet-4-5, claude-haiku-4-5, claude-opus-4-5
- Google: gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash

【出力形式】
以下のJSONスキーマに厳密に従って出力してください。JSONのみを出力し、説明文は一切不要です。

{
  "agents": [
    {
      "id": "agent_001",
      "name": "エージェント名",
      "persona": "このエージェントのキャラクターや専門性の説明",
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
          "task_name": "タスク名",
          "instructions": ["手順1", "手順2", "手順3"],
          "constraints": ["制約1", "制約2"],
          "output_format": "Markdown",
          "output_key": "output_key_name",
          "input_mapping": [
            { "from_step": 0, "from_agent_id": "__source__", "label": "元ファイル" }
          ],
          "enable_handover_note": false
        }
      ]
    }
  ]
}

重要: input_mapping の from_step: 0 は入力ソース（アクティブファイル）を指します。from_agent_id: "__source__" は常にアクティブファイルを参照します。`;

export class MetaAIService {
  constructor(
    private readonly apiKeys: ApiKeys,
    private readonly model: LLMModel = 'gpt-4o'
  ) {}

  async generateWorkflow(instruction: string, source: SourceInput | null): Promise<WorkflowConfig> {
    const systemPrompt = META_AI_SYSTEM_PROMPT_TEMPLATE
      .replace('{{filename}}', source?.filename ?? '(ファイル未指定)')
      .replace('{{language_id}}', source?.language_id ?? 'unknown')
      .replace('{{line_count}}', String(source?.line_count ?? 0));

    const userPrompt = `以下の指示に基づいてワークフローを設計してください:\n\n${instruction}`;

    const gateway = getGateway(this.model, this.apiKeys);
    const response = await gateway.chat({
      model: this.model,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      max_tokens: 4096,
      temperature: 0.3, // Lower temperature for more consistent JSON output
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
  }
}
