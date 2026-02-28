# AI Agent Orchestrator — System Architecture

## 目次

1. [システム概要](#システム概要)
2. [アーキテクチャ・フロー図](#アーキテクチャフロー図)
3. [モデル対応表・設定方法](#モデル対応表設定方法)
4. [エージェント動作詳細（ReActループ）](#エージェント動作詳細reactループ)
5. [ユーザー操作ガイド](#ユーザー操作ガイド)
6. [開発者向け情報](#開発者向け情報)

---

## システム概要

**AI Agent Orchestrator** は VS Code 拡張機能として動作し、複数の AI エージェントが連携してコード解析・修正・テスト実行などを自動化するワークフローを構築・実行できます。

### 主要コンポーネント

| コンポーネント | ファイル | 役割 |
|---|---|---|
| Extension Host | `src/extension.ts` | VS Code API との統合・コマンド登録・Webview 管理 |
| Orchestrator | `src/orchestrator/orchestrator.ts` | ワークフロー実行・タスク調整・状態管理 |
| WorkflowStateManager | `src/orchestrator/stateManager.ts` | 実行状態・ログ・出力のライフサイクル管理 |
| PromptBuilder | `src/orchestrator/promptBuilder.ts` | 入力マッピング・プロンプト生成 |
| OutputValidator | `src/orchestrator/outputValidator.ts` | 出力検証・ハンドオーバーノート抽出 |
| LLM Gateway | `src/llm/gateway.ts` | モデルプレフィックスに基づくアダプター選択 |
| AgentLoopEngine | `src/orchestrator/reactLoop.ts` | ReAct ループ制御 (エージェントモード) |
| ToolExecutor | `src/tools/toolExecutor.ts` | ツール呼び出しのディスパッチ |
| Webview (React) | `src/webview/` | ワークフロー設定・実行状況の UI |

---

## アーキテクチャ・フロー図

### 全体構成

```
┌─ VS Code Extension Host ─────────────────────────────────────────────────────┐
│                                                                                │
│  extension.ts (コマンド登録・メッセージハンドラー)                              │
│      │                                                                         │
│      ├──► Webview Panel (React アプリ)                                         │
│      │        ├── App.tsx          ワークフロー管理・ステップ制御               │
│      │        ├── AgentCard.tsx    エージェント設定・結果表示・ツールログ        │
│      │        └── ToolCallLog.tsx  ツール呼び出しリアルタイム表示               │
│      │                                                                         │
│      ├──► Orchestrator                                                          │
│      │        ├── WorkflowStateManager  状態・ログ・出力管理                    │
│      │        ├── PromptBuilder         プロンプト生成                          │
│      │        ├── OutputValidator       出力検証                                │
│      │        └── ConditionEvaluator    ループ条件評価                          │
│      │                                                                         │
│      └──► LLM Gateway (モデルプレフィックスでルーティング)                      │
│               ├── OpenAIAdapter      gpt-*                                      │
│               ├── AnthropicAdapter   claude-*                                   │
│               ├── GoogleAIAdapter    gemini-*                                   │
│               ├── OllamaAdapter      ollama:*                                   │
│               └── VscodeLMAdapter    vscode:*  (Cursor / Copilot / IDX)        │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
         │ use_tools: true のタスク
         ▼
┌─ Agentic Layer ──────────────────────────────────────────────────────────────┐
│  AgentLoopEngine (reactLoop.ts)                                                │
│      ├── LLM Gateway  ─────────► ネイティブ function calling (OpenAI 等)      │
│      │                           または プロンプト埋め込み (vscode: モデル)    │
│      └── ToolExecutor                                                          │
│               ├── FileTools    read_file / write_file / edit_file / list_files │
│               ├── SearchTools  search_code                                     │
│               ├── IDETools     get_diagnostics / get_definition / find_refs    │
│               └── Terminal     run_terminal                                    │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 標準タスクの実行フロー

```
Webview: ワークフロー実行 → extension.ts: 'workflow:execute'
    → Orchestrator.execute()
        → ステップをループ
            → タスクごとに runTask()
                → PromptBuilder でプロンプト生成
                → LLM Gateway で chat()
                → OutputValidator で検証
                → StateManager で出力保存
    → Webview: status:update で状態反映
```

### エージェントタスクの実行フロー (use_tools: true)

```
Orchestrator.runAgenticTask()
    → AgentLoopEngine.run(systemPrompt, userPrompt, tools)
        ┌────────────────────────────────────────────┐
        │ ReAct ループ (最大 max_tool_iterations 回)  │
        │                                            │
        │  1. LLM 呼び出し (会話履歴 + ツール定義)    │
        │       ↓                                    │
        │  2. tool_calls がある場合:                   │
        │       → ToolExecutor.execute()             │
        │       → 結果を会話に追加 (role: 'tool')     │
        │       → goto 1                             │
        │       ↓                                    │
        │  3. tool_calls がない → 最終回答を返す       │
        └────────────────────────────────────────────┘
    → ファイル変更を VS Code WorkspaceEdit で適用 (Undo 対応)
    → StateManager: status = 'completed', output 保存
```

---

## モデル対応表・設定方法

### プレフィックスとプロバイダー

| プレフィックス | プロバイダー | モデル例 | ツール呼び出し |
|---|---|---|---|
| `gpt-` | OpenAI | `gpt-4o`, `gpt-4o-mini` | ✅ ネイティブ (function calling) |
| `claude-` | Anthropic | `claude-opus-4-6`, `claude-sonnet-4-6` | ✅ ネイティブ (tool_use) |
| `gemini-` | Google AI | `gemini-1.5-pro`, `gemini-2.0-flash` | ✅ ネイティブ (functionDeclarations) |
| `ollama:` | Ollama (ローカル) | `ollama:llama3.3`, `ollama:phi3` | ✅ ネイティブ |
| `vscode:` | VS Code LM API | `vscode:copilot`, `vscode:claude-3.5-sonnet` | ⚠️ プロンプト埋め込み方式 |

### API キーの設定

`Ctrl+Shift+P` → **AI Agent: Configure API Keys** を実行するか、VS Code 設定で以下を設定：

```json
{
  "aiAgentOrchestrator.openaiApiKey": "sk-...",
  "aiAgentOrchestrator.anthropicApiKey": "sk-ant-...",
  "aiAgentOrchestrator.googleApiKey": "AIza...",
  "aiAgentOrchestrator.ollamaBaseUrl": "http://localhost:11434"
}
```

### `vscode:` モデルについて（Cursor / GitHub Copilot / Google IDX）

- Cursor・GitHub Copilot・Google IDX などの IDE に内蔵された LLM を **API キーなし** で使用できます
- `lm:models_list` により、現在の IDE で利用可能なモデルがモデル選択肢に自動追加されます
- **制限**: VS Code LM API はネイティブのツール呼び出し (function calling) をサポートしていません
  - エージェントモード (`use_tools: true`) で `vscode:` モデルを使用する場合、ツール定義はシステムプロンプトに XML として埋め込まれます（プロンプト埋め込み方式）
  - モデルの指示追従能力によってツール呼び出しの精度が異なります

---

## エージェント動作詳細（ReActループ）

### 標準モード vs エージェントモード

| 項目 | 標準モード | エージェントモード |
|---|---|---|
| タスク設定 | `use_tools: false` (デフォルト) | `use_tools: true` |
| LLM 呼び出し | 1回 | 最大 `max_tool_iterations` 回 |
| ツール実行 | なし | read_file, write_file など9種類 |
| ファイル変更 | なし | VS Code WorkspaceEdit (Undo 対応) |
| 適用タスク | 要約・翻訳・コードレビューなど | バグ修正・リファクタリング・テスト実行など |

### 利用可能なツール (9種類)

| ツール名 | カテゴリ | 説明 |
|---|---|---|
| `read_file` | ファイル | ファイルの内容を全文読み込む |
| `write_file` | ファイル | ファイルを作成・上書きする (WorkspaceEdit 経由) |
| `edit_file` | ファイル | ファイル内の特定文字列を置換する (WorkspaceEdit 経由) |
| `list_files` | ファイル | glob パターンでファイル一覧を取得する |
| `search_code` | 検索 | 正規表現でコードを横断検索する |
| `get_diagnostics` | IDE | TypeScript/Linter の診断情報（エラー・警告）を取得する |
| `get_definition` | IDE | シンボルの定義箇所へジャンプする |
| `find_references` | IDE | シンボルのすべての参照箇所を取得する |
| `run_terminal` | ターミナル | シェルコマンドを実行して stdout/stderr を返す |

### ファイル変更の安全機構

```
write_file / edit_file
    → FileChangeTracker に変更をステージ
    → AgentLoopEngine.run() 完了後に一括適用
         ├── auto_apply_edits: true  → vscode.workspace.applyEdit() で即時適用
         └── auto_apply_edits: false → Diff ビューを表示してユーザー確認後に適用
                                        キャンセル → 変更を破棄
```

- WorkspaceEdit 経由の変更は `Ctrl+Z` (Undo) で元に戻せます
- `run_terminal` は常に確認ダイアログを表示します（`auto_apply_edits` に関わらず）

### ループの制御

```
max_tool_iterations (デフォルト: 10)
    ↑ ループカウントがこの値に達すると、ツール呼び出しを停止して最終回答を生成

allowed_tools (デフォルト: 全ツール)
    ↑ 指定した場合、そのツールのみ使用可能にする
    例: ["read_file", "search_code"] → ファイル読み取りと検索のみ
```

---

## ユーザー操作ガイド

### パネルを開く

- **コマンドパレット**: `Ctrl+Shift+P` → `AI Agent: Open Panel`
- **ステータスバー**: 右下の `$(robot) AI Agent` アイコンをクリック
- **ショートカット**: 設定でキーバインドを追加可能

### ワークフローの構成

```
ワークフロー
├── Step 1 (sequential / parallel)
│     ├── Task A  →  Agent 1 が実行
│     └── Task B  →  Agent 2 が実行  ← parallel のとき同時実行
└── Step 2
      └── Task C  →  Step 1 の出力を参照可能
```

### エージェント設定

| 設定項目 | 説明 |
|---|---|
| Name | エージェントの名前（識別用） |
| Persona | システムプロンプトのロール定義 |
| Model | 使用するモデル（プレフィックスでプロバイダー選択） |

### タスク設定

| 設定項目 | 説明 |
|---|---|
| Task Name | タスクの名前（識別用） |
| Output Key | 出力を保存するキー名（他タスクから参照可能） |
| Instructions | LLM への指示（複数行可） |
| Input Mapping | 他タスクの出力や変数を入力として注入 |
| Output Format | PlainText / JSON / Markdown |
| Handover Note | 次のタスクへの引き継ぎメモを自動生成 |

### エージェントモードの設定 (use_tools: true)

1. AgentCard の **「Agent Mode (ReAct loop with tools)」** をチェック
2. 追加オプションが表示されます:

| オプション | デフォルト | 説明 |
|---|---|---|
| Auto-apply file edits | ON | OFF にすると変更前に Diff ビューで確認 |
| Max tool iterations | 10 | ループ上限（1〜50） |
| Allowed tools | 全ツール | チェックを外したツールは使用不可 |

### 実行・制御

| 操作 | 方法 |
|---|---|
| ワークフロー開始 | **Run** ボタン |
| 一時停止 | ステップに `pause_after: true` を設定 → 確認ダイアログで次へ |
| 中断 | **Abort** ボタン |
| タスク再試行 | 失敗したタスクの **Retry** ボタン |
| 特定ステップから再開 | ステップヘッダーの **Re-run from here** |

### 出力の操作

- **コピー**: 出力テキスト右上の Copy ボタン
- **ダウンロード**: Download ボタン（.txt / .json）
- **Apply to file**: `apply_output` が設定されたタスクでファイルに直接書き込み
- **手動編集**: 出力をダブルクリックして直接編集可能

---

## 開発者向け情報

### プロジェクト構成

```
src/
├── extension.ts              VS Code エントリーポイント
├── types/index.ts            全型定義
├── llm/
│   ├── gateway.ts            モデルルーティング
│   ├── openaiAdapter.ts      OpenAI API (function calling 対応)
│   ├── anthropicAdapter.ts   Anthropic API (tool_use 対応)
│   ├── googleAdapter.ts      Google AI API (functionDeclarations 対応)
│   ├── ollamaAdapter.ts      Ollama ローカル API
│   └── vscodeLMAdapter.ts    VS Code LM API (プロンプト埋め込み方式)
├── orchestrator/
│   ├── orchestrator.ts       ワークフロー実行エンジン
│   ├── reactLoop.ts          ReAct ループエンジン
│   ├── stateManager.ts       実行状態管理
│   ├── promptBuilder.ts      プロンプト生成
│   └── outputValidator.ts    出力検証
├── tools/
│   ├── toolDefinitions.ts    全ツールの JSON Schema 定義
│   ├── toolExecutor.ts       ツール呼び出しディスパッチャー
│   ├── fileTools.ts          ファイル操作
│   ├── searchTools.ts        コード検索
│   ├── ideTools.ts           VS Code IDE 機能
│   ├── terminalTools.ts      ターミナル実行
│   └── fileChangeTracker.ts  変更追跡・WorkspaceEdit 適用
└── webview/
    ├── App.tsx               ワークフロー管理メインコンポーネント
    ├── components/
    │   ├── AgentCard.tsx     エージェント・タスク設定カード
    │   └── ToolCallLog.tsx   ツール呼び出しログ表示
    └── i18n/                 日英ローカライズ
```

### Cursor Composer / Google Antigravity との連携

本拡張機能は以下の VS Code コマンドを公開しており、外部 AI エージェントから呼び出せます：

#### `aiAgentOrchestrator.runPrompt`

```typescript
// Cursor Composer からの呼び出し例:
const result = await vscode.commands.executeCommand(
  'aiAgentOrchestrator.runPrompt',
  {
    prompt: 'このコードのバグを修正して',
    model: 'claude-opus-4-6',          // 省略時: 'gpt-4o'
    systemPrompt: 'あなたはTypeScript専門家です', // 省略可
  }
);
// result: string (タスク出力テキスト)
```

#### `aiAgentOrchestrator.getLastOutput`

```typescript
// 最後に実行したワークフローの全出力を取得:
const outputs = await vscode.commands.executeCommand(
  'aiAgentOrchestrator.getLastOutput'
);
// outputs: Record<string, string> (output_key → テキスト)
```

### 新規ツールの追加方法

1. `src/tools/toolDefinitions.ts` に JSON Schema を追加
2. 対応する実装関数を `src/tools/` のいずれかに追加
3. `src/tools/toolExecutor.ts` の `dispatch()` に case を追加
4. `src/webview/components/AgentCard.tsx` の `ALL_AGENT_TOOLS` に名前を追加

### 新規モデルプロバイダーの追加方法

1. `src/llm/` に新規アダプタークラスを作成 (`LLMGateway` インターフェースを実装)
2. `src/llm/gateway.ts` の `getGateway()` にプレフィックス分岐を追加
3. `src/webview/components/AgentCard.tsx` の `LLM_MODEL_GROUPS` にモデル例を追加

### テスト実行

```bash
cd /home/user/IDE
npm test              # Vitest でユニットテスト (src/**/*.test.ts)
npm run typecheck     # TypeScript 型チェック
npm run lint          # ESLint
npm run build         # esbuild でバンドル (extension + webview)
```
