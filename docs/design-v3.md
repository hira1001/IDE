# AI Agent Orchestrator for IDE

## 設計書・要件定義書 v3.0

**更新履歴:**

- v1.0: 初版作成
- v2.0: 入力ソース確定、テンプレート機能、input_mapping、条件分岐、ドライラン、引き継ぎメモ、コスト表示
- v3.0: 全回答反映 + アーキテクチャ改善6件統合 + 個人開発/OSS前提でのロードマップ再設計

**前提条件（v3で確定）:**

- 開発体制: 1人、フルタイム集中開発
- コーディング: AIアシスタント活用（技術難易度は制約にならない）
- 公開形態: オープンソース（GitHub公開）
- UI言語: 日本語・英語の同時対応（初期からi18n）

-----

## 1. プロダクト概要

### 1.1 プロダクト名（仮称）

**AI Agent Orchestrator** — IDE上で複数のAIエージェントを定義・管理・並列/直列実行するVS Code拡張機能

### 1.2 コンセプト

ユーザーが自然言語またはGUIで「AIの開発チーム」をオンデマンドに構築し、タスクを自動実行させるプラットフォーム。エージェントの数・役割・作業順序をすべてユーザーが自由にカスタマイズできる。一度構築したワークフローはテンプレートとして保存・再利用が可能。

### 1.3 解決する課題

|課題                   |本ツールによる解決                              |
|---------------------|---------------------------------------|
|AIへの指示が曖昧で出力品質がばらつく  |メタAIがタスクを構造化し、手順・制約・出力形式を自動設定          |
|複数AIの協調作業を手動で管理するのが煩雑|ワークフローエンジンが直列/並列/条件分岐を自動制御             |
|AI作業のブラックボックス化       |エージェントカードでリアルタイム進捗を可視化                 |
|全体やり直しによるコスト浪費       |カード単位の部分リトライ + 実行前ドライラン + 中間編集         |
|毎回同じ構成を一から作り直す手間     |テンプレート保存・再利用機能                         |
|LLMの出力品質が不安定         |Output Validator による自動検証 + フォーマット修正リトライ|

### 1.4 想定ユースケース

本ツールは文書作成系とコード系の両方を同等に扱う汎用プラットフォームとして設計する。

**文書作成系の例:**

- 技術記事の作成（ドラフト→図解→レビュー→修正）
- 設計書の生成（要件抽出→本文執筆→図表作成→整合性チェック）
- レポートの多言語展開（原文作成→翻訳A→翻訳B→品質チェック）

**コード系の例:**

- 機能実装（コード生成→テスト作成→コードレビュー→修正）
- リファクタリング（分析→リファクタ実行→テスト確認→ドキュメント更新）
- バグ修正（原因分析→修正コード生成→テストケース追加→回帰テスト確認）

-----

## 2. 機能要件

### 2.1 コア機能一覧

|ID  |機能名                 |優先度   |Phase|説明                                        |
|----|--------------------|------|-----|------------------------------------------|
|F-01|自然言語によるワークフロー生成     |**必須**|1    |チャット入力からメタAIがエージェント構成を自動生成                |
|F-02|エージェントカード表示・編集      |**必須**|2    |各エージェントのペルソナ・作業内容をカード型UIで可視化・編集           |
|F-03|ワークフロー実行エンジン        |**必須**|1    |直列/並列/条件分岐のタスクスケジューリングと実行                 |
|F-04|リアルタイム進捗表示          |**必須**|2    |実行中のステータスをカード上でアニメーション表示                  |
|F-05|カード単位の部分リトライ        |**必須**|2    |特定エージェントのタスクだけを再実行                        |
|F-06|実行結果の出力             |**必須**|2    |各出力を別タブで表示 + オプションで統合エージェント               |
|F-07|アクティブファイル自動取得       |**必須**|2    |エディタで開いているファイルを入力ソースとして自動取得               |
|F-08|テンプレート保存・読込         |**必須**|3    |ワークフロー構成をJSONテンプレートとして保存・再利用              |
|F-09|条件分岐ステップ            |**必須**|1    |レビュー結果に基づく自動ループ/終了の制御                     |
|F-10|ドライラン（プレビュー実行）      |**必須**|3    |実際のAPI呼び出し前にプロンプト完成形を確認                   |
|F-11|引き継ぎメモ              |推奨    |3    |エージェントが次のエージェントへの申し送り事項を付与                |
|F-12|コスト見積もり表示           |**必須**|3    |推定トークン数と概算費用をUI上に表示                       |
|F-13|ステップ操作GUI           |**必須**|2    |ステップの追加・削除・並列⇔直列切替・カード移動                  |
|F-14|強制停止（Abort）         |**必須**|2    |実行中のワークフローを途中でキャンセル                       |
|F-15|Output Validator    |**必須**|1    |LLM出力のフォーマット検証 + 自動リトライ（1回）               |
|F-16|中間データの手動編集（ブレークポイント）|**必須**|2    |ステップ完了後に一時停止し、出力を手動編集してから続行               |
|F-17|マルチLLM Gateway      |**必須**|1    |OpenAI / Anthropic / Google AI の統一インターフェース|
|F-18|i18n（日本語・英語）        |**必須**|2    |UIラベルの多言語対応（初期から）                         |

### 2.2 対象外（v1スコープ外）

- ノードベースのビジュアルエディタ（将来 `depends_on` ベースDAGに移行する際に検討）
- 複数ワークフローの同時実行
- エージェント間のリアルタイム対話（ディベート形式）
- ファイル選択ダイアログ / チャットボックスへの貼り付けによる入力（v2で検討）
- テンプレートのマーケットプレイス共有（v2で検討）

-----

## 3. ユーザーフロー詳細

### 3.1 全体フロー（5フェーズ構成）

```
┌───────────────────────────────────────────────────────────────────┐
│  フェーズ1: ビルド（定義と微調整）                                  │
│                                                                   │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────────┐        │
│  │ 自然言語  │──▶│ メタAI が    │──▶│ GUI上にカード      │        │
│  │ で指示    │   │ JSON生成     │   │ + ステップ自動配置 │        │
│  └──────────┘   └──────────────┘   └────────┬───────────┘        │
│       or                                     │                    │
│  ┌──────────┐                       ユーザーが微調整               │
│  │ テンプレ │──▶ 保存済みフローを読み込み      │                    │
│  │ ート選択 │                                 │                    │
│  └──────────┘                                 │                    │
│                                               │                    │
│  入力ソース: エディタのアクティブファイルを自動取得                 │
│  ブレークポイント: 任意のステップに pause_after を設定可能          │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│  フェーズ1.5: ドライラン（任意）                                    │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ 【👁 プレビュー】ボタン押下                                │    │
│  │ → 各エージェントに送られるプロンプト完成形を表示            │    │
│  │ → 推定トークン数・概算コストを表示                         │    │
│  │ → 問題なければ実行へ / 問題あればカードに戻って修正         │    │
│  └───────────────────────────────────────────────────────────┘    │
├───────────────────────────────────────────────────────────────────┤
│  フェーズ2: コンパイル（実行準備）                                  │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ 【▶ 実行】ボタン押下                                      │    │
│  │ → バリデーション（入力ソース、API キー、参照整合性等）      │    │
│  │ → 依存関係解析 → 実行キュー作成                            │    │
│  │ → アクティブファイルの内容を共有メモリへ自動セット          │    │
│  └───────────────────────────────────────────────────────────┘    │
├───────────────────────────────────────────────────────────────────┤
│  フェーズ3: ランタイム（実行）                                      │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ オーケストレーターがタスク発火                              │    │
│  │ → 並列 / 直列 / 条件分岐 を制御                            │    │
│  │ → Output Validator で出力フォーマットを検証                 │    │
│  │ → 検証失敗時: 自動リトライ1回 → 再失敗ならユーザーに委譲   │    │
│  │ → 各カードのステータスをリアルタイム更新                    │    │
│  │ → pause_after が ON のステップ完了後 → 一時停止             │    │
│  │   → ユーザーが出力を確認・編集 → 【▶ 続行】で再開         │    │
│  │ → 【⏹ 停止】ボタンでいつでもキャンセル可能                 │    │
│  └───────────────────────────────────────────────────────────┘    │
├───────────────────────────────────────────────────────────────────┤
│  フェーズ4: フィードバック（結果と修正）                            │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ 各出力を別々のエディタタブに表示                            │    │
│  │ → オプション: 統合エージェントで1ファイルにまとめることも可  │    │
│  │ → 中間出力はカードクリックで確認可能                        │    │
│  │ → 問題があればカード単位で部分リトライ                      │    │
│  │ → 満足したらテンプレートとして保存可能                      │    │
│  └───────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 フェーズ1 詳細: ビルド

#### 3.2.1 入力ソース（処理対象データの取得）

エディタで開いているアクティブファイルの内容を自動取得する。

**取得仕様:**

|項目       |仕様                                                 |
|---------|---------------------------------------------------|
|取得対象     |VS Codeのアクティブエディタ（`vscode.window.activeTextEditor`）|
|取得タイミング  |【実行】ボタン押下時にスナップショット取得                              |
|対応形式     |プレーンテキスト、Markdown、ソースコード（言語問わず）                    |
|ファイル情報の付与|ファイル名、言語ID、行数をメタデータとして共有メモリに格納                     |
|ファイル未選択時 |警告表示:「エディタでファイルを開いてから実行してください」                     |
|サイズ上限    |100KB（超過時は警告表示 + 先頭からトランケート）                       |

**共有メモリへの格納形式:**

```typescript
interface SourceInput {
  content: string;
  filename: string;       // 例: "design_doc.md"
  language_id: string;    // 例: "markdown", "typescript", "python"
  line_count: number;
  byte_size: number;
}
```

**メタAIへのコンテキスト:** メタAIがワークフローを生成する際、`language_id` を参照して適切なエージェント構成を提案する（TypeScriptファイル→コードレビュアー、Markdown→文章校正AI等）。

#### 3.2.2 自然言語入力

ユーザーはIDE上部のチャットボックスに日本語（または英語）で指示を入力する。

**入力例:**

- 「文章生成と図の作成を並列でやって、最後に全体をレビューするフローを組んで」
- 「3人のAIで、企画書の作成→レビュー→修正の直列フローを作って」
- 「このコードのレビューと修正を2ループで回して」

#### 3.2.3 テンプレートからの読込

保存済みテンプレートを選択してワークフローを復元する（詳細は3.8節）。

#### 3.2.4 メタAI（ワークフロー生成AI）の処理

メタAIは「優秀なプロジェクトマネージャー」として機能し、WorkflowConfig JSONを自動生成する。

**メタAI自身の使用モデル:** ユーザーが設定画面で指定（デフォルト: ユーザーが登録済みのAPIキーのうち最も高性能なモデル）。構造化JSON出力の精度が必要なため、GPT-4o / Claude Sonnet / Gemini Pro クラス以上を推奨。

**メタAIのシステムプロンプト設計:**

```
あなたは優秀なプロジェクトマネージャーであり、AIエージェントの
オーケストレーターです。ユーザーからの曖昧な依頼を分析し、
各AIエージェントが迷いなく実行できるレベルの具体的な作業手順に
分解・構造化してください。

【コンテキスト】
- 処理対象ファイル: ${filename}
- ファイルの種類: ${language_id}
- ファイルの行数: ${line_count}

【ルール】
1. instructions（具体的な作業ステップ）を3〜5項目にブレイクダウン
2. constraints（制約事項や禁止事項）を必ず設定
3. output_format（出力形式）を明確に指定
4. 依存関係のないタスクは parallel に、依存があるものは sequential に
5. レビュー→修正のパターンには conditional ステップを使用
6. 各タスクの input_mapping と output_key を明示的に指定すること
7. 重要な中間確認が必要なステップには pause_after: true を設定

【出力形式】
指定のJSONスキーマに厳密に従って出力してください。
```

**出力JSONスキーマ例（v3）:**

```json
{
  "agents": [
    {
      "id": "agent_001",
      "name": "テクニカルライター",
      "persona": "論理的で厳密なIT系の編集者です。",
      "model": "gpt-4o"
    },
    {
      "id": "agent_002",
      "name": "図解アーキテクト",
      "persona": "システム構成を視覚的に表現するのが得意です。",
      "model": "claude-sonnet-4-5"
    },
    {
      "id": "agent_003",
      "name": "品質レビュアー",
      "persona": "厳格だが建設的なレビューを行います。",
      "model": "gemini-1.5-pro"
    }
  ],
  "workflow": [
    {
      "step": 1,
      "type": "parallel",
      "pause_after": false,
      "tasks": [
        {
          "task_id": "task_draft",
          "agent_id": "agent_001",
          "task_name": "本文ドラフト作成",
          "instructions": [
            "入力テキストの要点を抽出し、章立て構成を決定する",
            "各章のドラフト文を作成する",
            "専門用語リストを末尾に付与する"
          ],
          "constraints": [
            "語尾は「です・ます」調に統一",
            "元の文章の意味や意図は変更しない"
          ],
          "output_format": "Markdown",
          "output_key": "draft_text",
          "input_mapping": [
            { "from_step": 0, "from_agent_id": "__source__", "label": "元ファイル" }
          ],
          "enable_handover_note": true
        }
      ]
    }
  ]
}
```

#### 3.2.5 エージェントカードのGUI仕様

**カードの状態遷移:**

```
待機 (Idle) ─── クリック ──→ 編集中 (Editing)
    │                              │
    │                         閉じる/自動保存
    │                              ▼
    │                        確定 (Ready)
    │                              │
    │                         【実行】押下
    │                              ▼
    └─────────────────────→ 実行中 (Running)
                                   │
                          ┌────────┼────────┐
                          ▼        │        ▼
                    完了 (Done)     │   エラー (Error)
                                   ▼
                            一時停止 (Paused)
```

**追加状態:**

- `Paused`: `pause_after: true` のステップ完了後に遷移
- `Validating`: Output Validator が出力を検証中
- `Retrying`: フォーマット検証失敗による自動リトライ中
- `Skipped`: 条件分岐で通過しなかった場合
- `Aborted`: 強制停止により中断された場合

#### 3.2.6 ブレークポイント（中間停止）の設定

ステップブロックのヘッダーに「⏸ 完了後に一時停止」トグルを配置。ONにすると `pause_after: true` がセットされる。

### 3.3 フェーズ1.5 詳細: ドライラン（F-10）

**トリガー:** 【👁 プレビュー】ボタン押下

推定トークン数・概算コスト・プロンプトプレビューを表示。APIは呼び出さない。

### 3.4 フェーズ2 詳細: コンパイル

**バリデーション（コンパイル時チェック）:**

|チェック項目                            |エラー時の挙動                        |
|----------------------------------|-------------------------------|
|アクティブエディタが存在するか                   |警告ダイアログ表示、実行中止                 |
|全タスクの input_mapping が有効か          |不正な参照があるカードをハイライト              |
|output_key の重複がないか（同一ステップ内の並列タスク間）|重複箇所をハイライト。ただしループ元と修正先の同名keyは許容|
|使用モデルのAPIキーが設定済みか                 |未設定プロバイダーごとに設定画面へのリンク表示        |
|条件分岐の on_fail_goto 先が存在するか        |エラー表示                          |
|循環参照がないか                          |エラー表示                          |
|入力ファイルが100KB以内か                   |警告 + トランケート確認                  |

### 3.5 フェーズ3 詳細: ランタイム

**Output Validator の動作（F-15）:**

|出力形式     |検証内容                                                |
|---------|----------------------------------------------------|
|Markdown |先頭が `#` または通常テキストで始まるか                              |
|Mermaid  |`graph`, `flowchart`, `sequenceDiagram` 等のキーワードで始まるか|
|JSON     |`JSON.parse()` が成功するか                               |
|Code     |言語固有のパターンチェック（import文、関数定義等）                        |
|PlainText|常にPass                                              |

**リアルタイムUI更新:**

|カード状態           |視覚表現                          |
|----------------|------------------------------|
|待機中 (Idle)      |グレーアウト、薄い枠線                   |
|実行中 (Running)   |枠線パルスアニメーション + スピナー           |
|検証中 (Validating)|黄色枠 + 🔍 アイコン                  |
|リトライ中 (Retrying)|オレンジ枠 + 🔄 アイコン               |
|一時停止 (Paused)   |青枠 + ⏸ アイコン                   |
|完了 (Done)       |緑枠 + ✅                        |
|エラー (Error)     |赤枠 + ⚠️                       |
|スキップ (Skipped)  |点線枠 + ⏭                       |
|中断 (Aborted)    |グレー枠 + ⏹                      |

### 3.6 フェーズ3補足: 強制停止の詳細（F-14）

**停止処理:** 全アクティブタスクの `AbortController.abort()` を呼び出し。完了済みタスクの出力は保持される。

### 3.7 フェーズ4 詳細: フィードバック

各エージェントの最終出力を別々のVS Codeエディタタブに表示。部分リトライ、テンプレート保存が可能。

### 3.8 テンプレート機能（F-08）

**保存形式:** JSON ファイル（`.aao-template.json`）
**保存場所:** `.vscode/aao-templates/` または `~/.aao-templates/`

-----

## 4. 画面設計

### 4.1 全体レイアウト

```
┌───────────────────────────────────────────────────────┐
│  VS Code Webview Panel                                │
│                                                       │
│  ┌─────────────────────────────────┐ [📂] [💾]       │
│  │ 💬 AIチームを構成する指示...     │                  │
│  └─────────────────────────────────┘                  │
│                                                       │
│  📎 入力ソース: design_doc.md (markdown, 567行)       │
│                                                       │
│  ── Step 1 (並列) ─── [種類▼] [⏸完了後停止] [🗑️] ── │
│  │                                               │    │
│  │  ┌──────────────┐  ┌──────────────┐           │    │
│  │  │⠿ 🤖 AI1      │  │⠿ 🤖 AI2      │           │    │
│  │  │  ライター     │  │  図解担当     │           │    │
│  │  │  GPT-4o      │  │  Claude      │           │    │
│  │  └──────────────┘  └──────────────┘           │    │
│  ─────────────────────────────────────────────── │    │
│                                                       │
│  ┌───────────────────────────────────────────────┐    │
│  │ 💰~$0.08-$0.24 │ 👁 プレビュー │ ⏹ 停止 │ ▶ 実行│    │
│  └───────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────┘
```

### 4.2 デザイン原則

1. **VS Codeネイティブ感**: VS Code Webview UI Toolkit使用。テーマ自動追従
2. **縦型パイプライン**: 視線を上→下に誘導。Step間は矢印で接続
3. **並列＝横並び、直列＝縦1列**: レイアウトだけで実行形式が直感的に分かる
4. **条件分岐＝矢印の分岐表示**: NG→Step Nへのジャンプ矢印を視覚化
5. **折りたたみ式カード**: デフォルトはコンパクト表示、クリックで詳細展開
6. **自動保存**: 編集即反映
7. **最小限のアニメーション**: 実行中パルスのみ
8. **コスト意識の常時表示**: 実行ボタン横に推定コスト
9. **停止ボタンの常時表示**: 実行中は【⏹ 停止】が目立つ位置に

-----

## 5. システムアーキテクチャ

### 5.1 技術スタック

|レイヤー             |技術                                      |理由                            |
|-----------------|----------------------------------------|------------------------------|
|IDE連携            |VS Code Extension API (TypeScript)      |最大のユーザーベース                    |
|フロントエンド (Webview)|React + VS Code Webview UI Toolkit      |状態管理 + ネイティブ感                 |
|i18n             |i18next + react-i18next                 |業界標準、VS Code拡張との相性良好          |
|ワークフローエンジン       |カスタム実装（ステップベース）                         |v1の要件に対してLangGraph.jsはオーバースペック|
|LLM API          |OpenAI / Anthropic / Google AI（初期から3社対応）|Gateway パターンで統一               |
|図の生成             |Mermaid.js                              |テキストベースで生成・修正が容易              |
|状態管理             |Blackboard パターン（インメモリ）                  |エージェント間のデータ共有                 |
|テンプレート保存         |JSON ファイル（ローカル）                         |Git管理可能                       |
|テスト              |Vitest + VS Code Extension Test Runner  |高速 + Extension統合テスト           |
|リント・フォーマット       |ESLint + Prettier                       |OSS標準                         |

### 5.2 LLM Gateway 設計（F-17）

```typescript
interface LLMGateway {
  chat(request: LLMRequest): Promise<LLMResponse>;
  abort(): void;
  estimateTokens(text: string): number;
}

interface LLMRequest {
  model: LLMModel;
  system_prompt: string;
  user_prompt: string;
  max_tokens?: number;
  temperature?: number;
}

interface LLMResponse {
  content: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
  duration_ms: number;
}

class OpenAIAdapter implements LLMGateway { ... }
class AnthropicAdapter implements LLMGateway { ... }
class GoogleAIAdapter implements LLMGateway { ... }
```

### 5.3 コンポーネント構成

```
VS Code Extension
├── Extension Host (Node.js / TypeScript)
│   ├── MetaAI Service
│   ├── Orchestrator
│   │   ├── Step Scheduler
│   │   ├── Prompt Builder
│   │   ├── Output Validator
│   │   ├── Condition Evaluator
│   │   ├── Loop Controller
│   │   └── Abort Manager
│   ├── LLM Gateway
│   │   ├── OpenAI Adapter
│   │   ├── Anthropic Adapter
│   │   ├── Google AI Adapter
│   │   └── Token Counter
│   ├── State Manager (Blackboard)
│   │   ├── Source Input Store
│   │   ├── Output Store
│   │   ├── Handover Notes Store
│   │   └── Execution Log
│   ├── Template Manager
│   └── File Context Provider
│
└── Webview (React + TypeScript)
    ├── i18n/ (en.json / ja.json)
    ├── ChatInput
    ├── TemplateSelector
    ├── SourceFileIndicator
    ├── PipelineView
    │   ├── StepBlock
    │   ├── StepConnector
    │   └── AgentCard
    ├── BreakpointPanel
    ├── DryRunPanel
    ├── AddStepButton
    └── ExecutionBar (Sticky)
```

### 5.4 データフロー

```
[ユーザー入力（自然言語 or テンプレート選択）]
    │
    ▼
[MetaAI Service]  ←── [File Context Provider: language_id等]
    │ 生成: WorkflowConfig (JSON)
    ▼
[Webview: PipelineView]  ←──── ユーザーが微調整
    │
    ├─ 【👁 プレビュー】→ [DryRunPanel]
    │
    ▼ 【▶ 実行】ボタン
[File Context Provider] → スナップショット取得
    ▼
[Step Scheduler] + [Abort Manager]
    │
    ├── Step N (parallel/sequential/conditional)
    │   └─ [Prompt Builder] → [LLM Gateway] → [Output Validator] → [State Manager]
    │
    ▼
[Webview: 結果表示] + [VS Code Editor Tab]
    │
    └─ [Template Manager: 保存]（任意）
```

-----

## 6. データモデル

### 6.1 Agent

```typescript
interface Agent {
  id: string;
  name: string;
  persona: string;
  model: LLMModel;
}

type LLMModel =
  | "gpt-4o" | "gpt-4o-mini" | "gpt-4-turbo"
  | "claude-sonnet-4-5" | "claude-haiku-4-5" | "claude-opus-4-5"
  | "gemini-1.5-pro" | "gemini-1.5-flash" | "gemini-2.0-flash";
```

### 6.2 InputSource

```typescript
interface InputSource {
  from_step: number;       // 0 = 初期入力（ループ時は最新のoutput_keyを優先）
  from_agent_id: string;   // "__source__" = アクティブファイル
  label: string;
}
```

**ループ時の参照解決ルール:** `input_mapping` は `from_step` + `from_agent_id` で参照先を指定するが、実際のデータ取得は `output_key` 経由で行う。ループにより同じ `output_key` が複数回書き込まれた場合、**常に最新の値が使用される**（上書き方式）。

### 6.3 Task

```typescript
interface Task {
  task_id: string;
  agent_id: string;
  task_name: string;
  instructions: string[];
  constraints: string[];
  output_format: OutputFormat;
  output_key: string;
  input_mapping: InputSource[];
  enable_handover_note: boolean;
}

type OutputFormat = "Markdown" | "Mermaid" | "JSON" | "PlainText" | "Code";
```

### 6.4 ConditionalConfig

```typescript
interface ConditionalConfig {
  evaluator_agent_id: string;
  pass_keyword: string;
  fail_keyword: string;
  max_loops: number;
}
```

### 6.5 WorkflowStep

```typescript
interface WorkflowStep {
  step: number;
  type: "parallel" | "sequential" | "conditional";
  pause_after: boolean;
  tasks: Task[];
  condition?: ConditionalConfig;
  on_fail_goto?: number;
  then_goto?: number;
}
```

### 6.6 WorkflowConfig

```typescript
interface WorkflowConfig {
  agents: Agent[];
  workflow: WorkflowStep[];
}
```

### 6.7 SourceInput

```typescript
interface SourceInput {
  content: string;
  filename: string;
  language_id: string;
  line_count: number;
  byte_size: number;
}
```

### 6.8 HandoverNote

```typescript
interface HandoverNote {
  from_agent_id: string;
  from_step: number;
  note: string;
}
```

### 6.9 ExecutionState

```typescript
interface ExecutionState {
  workflow_id: string;
  status: WorkflowStatus;
  current_step: number;
  loop_counts: Map<number, number>;
  task_states: Map<string, TaskState>;
  output_store: Map<string, string>;
  handover_notes: HandoverNote[];
  execution_log: ExecutionLogEntry[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

type WorkflowStatus = "idle" | "running" | "paused" | "completed" | "error" | "aborted";

interface TaskState {
  status: TaskStatus;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
  error_message?: string;
  validation_result?: "pass" | "retried_pass" | "fail";
  retry_count: number;
}

type TaskStatus = "idle" | "running" | "validating" | "retrying"
               | "paused" | "completed" | "error" | "skipped" | "aborted";

interface ExecutionLogEntry {
  timestamp: string;
  step: number;
  task_id: string;
  event: "start" | "complete" | "error" | "retry" | "validation_fail"
       | "validation_pass" | "loop" | "skip" | "pause" | "resume"
       | "abort" | "manual_edit";
  details?: string;
}
```

### 6.10 WorkflowTemplate

```typescript
interface WorkflowTemplate {
  schema_version: string;
  template_id: string;
  name: string;
  description: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  config: WorkflowConfig;
}
```

### 6.11 CostTable（コスト計算用）

```typescript
interface ModelPricing {
  model: LLMModel;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
}

const DEFAULT_PRICING: ModelPricing[] = [
  { model: "gpt-4o", input_cost_per_1k: 0.0025, output_cost_per_1k: 0.01 },
  { model: "claude-sonnet-4-5", input_cost_per_1k: 0.003, output_cost_per_1k: 0.015 },
  { model: "gemini-1.5-pro", input_cost_per_1k: 0.00125, output_cost_per_1k: 0.005 },
];
```

-----

## 7. 非機能要件

|項目       |要件                                           |
|---------|---------------------------------------------|
|パフォーマンス  |LLM APIレスポンス以外の処理は100ms以内                    |
|同時実行数    |並列ステップで最大5エージェントまで同時実行                       |
|エラーハンドリング|APIタイムアウト（60秒）、自動リトライ最大3回（指数バックオフ）           |
|出力検証リトライ |Output Validator 失敗時の自動リトライは1回のみ             |
|ループ上限    |条件分岐ループはmax_loops（デフォルト3）で強制終了               |
|コンテキスト管理 |output_key ベースで必要なデータのみ渡す                    |
|入力ファイルサイズ|最大100KB                                      |
|セキュリティ   |APIキーは SecretStorage、プロンプトは system/user データ分離|
|テーマ対応    |ダーク/ライト自動追従                                  |
|i18n     |日本語・英語（初期から。i18next + JSONリソース）              |
|テンプレート互換性|schema_version で後方互換性を担保                     |
|強制停止     |AbortController による安全なキャンセル                  |
|通知       |カード上表示 + VS Code通知ポップアップの二重化                 |

-----

## 8. 既知の技術的課題と対策

### 8.1 コンテキスト長とAPIコストの爆発

**対策:** `output_key` + `input_mapping` により必要なデータのみ選択的に渡す。ドライランで事前確認。

### 8.2 AI同士の無限ループ

**対策:** `max_loops` で上限設定（デフォルト3）。ブレークポイントでユーザーが途中介入可能。

### 8.3 並列実行時のデータ競合

**対策:** 並列エージェントは共有メモリの読み取りのみ。書き込みは `output_key` で分離。

### 8.4 条件分岐の判定精度

**対策:** プロンプトで先頭行にキーワード記載を強く指示。どちらも未検出 → REVISION_NEEDED（安全側）。

### 8.5 引き継ぎメモの分離精度

**対策:** 区切り `--- 引き継ぎメモ ---` をプロンプトで明示指定。正規表現パース。

### 8.6 LLM出力フォーマット違反

**対策:** Output Validator がフォーマットを検証。検証失敗 → 自動リトライ1回。

### 8.7 プロンプトインジェクション

**対策:** Prompt Builder が `<system_instructions>` と `<user_data>` を構造的に分離。

### 8.8 複数LLMプロバイダーの料金変動

**対策:** `CostTable` を設定ファイルとして外出し。ユーザーが手動更新可能。

-----

## 9. 開発ロードマップ（個人開発・フルタイム前提）

### Phase 0: 技術検証 + プロジェクト基盤（1.5週間）

- [ ] プロジェクト初期化（TypeScript + ESLint + Prettier + Vitest）
- [ ] GitHub リポジトリ作成 + CI（GitHub Actions）
- [ ] 各LLM API の基本接続テスト
- [ ] VS Code Webview + React の基本構成確認
- [ ] メタAIのプロンプトテスト

### Phase 1: コアエンジン — CLIプロトタイプ（2.5週間）

- [ ] LLM Gateway（3社 Adapter + Token Counter）
- [ ] Orchestrator（Step Scheduler / Prompt Builder / Output Validator / Condition Evaluator / Loop Controller）
- [ ] State Manager（Output Store / Handover Notes / Execution Log）
- [ ] MetaAI Service

### Phase 2: VS Code拡張 + GUI（3.5週間）

- [ ] Extension基盤（コマンド、File Context Provider、SecretStorage、設定画面）
- [ ] Webview（React + i18n + 全コンポーネント）
- [ ] 実行連携（postMessage API、リアルタイム更新、Abort Manager）

### Phase 3: 洗練 + OSS公開準備（2.5週間）

- [ ] テンプレート保存・読込
- [ ] ドライラン
- [ ] 品質（ユニットテスト、統合テスト、エッジケース）
- [ ] OSS公開準備（README、CONTRIBUTING、CHANGELOG、Marketplace）

**合計: 約10週間（2.5ヶ月）**

-----

## 10. 将来の拡張（v2以降で検討）

|#|項目                           |概要                                      |
|-|-----------------------------|----------------------------------------|
|1|depends_on ベースDAG            |ステップ概念を廃止し、タスク単位の依存関係制御に移行              |
|2|入力ソースの拡張                     |ファイル選択ダイアログ、複数ファイル対応                   |
|3|テンプレートマーケットプレイス              |コミュニティでテンプレートを共有・検索・インストール              |
|4|ストリーミング出力                    |LLM APIのストリーミングレスポンスに対応                  |
|5|MCP（Model Context Protocol）対応|外部ツール・データソースとの接続                        |
|6|ワークフローの条件分岐拡張                |キーワードベース以外の判定                           |
|7|エージェント間リアルタイム対話              |ディベート形式でのAI同士の議論・合意形成                   |

-----

## 11. 未決定事項

|#|項目                      |選択肢               |判断時期           |
|-|------------------------|------------------|---------------|
|1|ストリーミング出力               |有効 vs 無効          |Phase 2 で判断    |
|2|条件分岐の手動オーバーライド          |自動判定のみ vs 確認ステップ挿入|Phase 2 でUXテスト後|
|3|VS Code Marketplace の公開名|仮称のまま vs リブランド    |Phase 3 で決定    |

**決定済み（v3で解決）:**

- output_key のループ時衝突 → **上書き方式**に決定（6.2節参照）

-----

## 付録A: 用語集

|用語                |定義                                    |
|------------------|--------------------------------------|
|メタAI              |ユーザーの自然言語指示をWorkflowConfig JSONに変換するAI|
|エージェントカード         |各AIエージェントのペルソナ・タスクを表示・編集するUI要素        |
|オーケストレーター         |ワークフローの実行順序を管理し、APIコールを制御するエンジン       |
|共有メモリ (Blackboard)|全エージェントがアクセスする状態管理ストア                 |
|output_key        |各タスクの出力を共有メモリに保存する際のキー名               |
|input_mapping     |タスクがどの output_key のデータを入力として受け取るかの定義  |
|引き継ぎメモ            |エージェントが次の担当者に残す申し送り事項                 |
|ドライラン             |APIを呼び出さずにプロンプト完成形とコスト見積もりを確認する機能     |
|ブレークポイント          |ステップ完了後に自動停止し、ユーザーが出力を編集できる停止点        |
|Output Validator  |LLMの出力が指定フォーマットに準拠しているか検証する機能         |
|テンプレート            |保存されたワークフロー構成。再利用・派生が可能               |
|条件分岐              |レビュー結果に基づいてフローの進行方向を自動決定するステップタイプ     |
|LLM Gateway       |複数のLLMプロバイダーを統一インターフェースで扱う抽象化レイヤー     |

-----

## 付録B: v2 → v3 変更点サマリー

|カテゴリ                   |変更内容                                                                       |
|-----------------------|---------------------------------------------------------------------------|
|改善提案①: DAG             |v1はステップベース維持と決定。将来の depends_on 移行をv2ロードマップに記載                              |
|改善提案②: output_key      |Task モデルに `output_key` フィールド追加。Output Store のキー構造を変更                       |
|改善提案③: 強制停止            |F-14追加。Abort Manager、AbortController、停止後のUI仕様を詳細定義                         |
|改善提案④: Output Validator|F-15追加。形式別検証ルール、自動リトライ1回、リトライプロンプト設計                                       |
|改善提案⑤: 中間データ編集         |F-16追加。`pause_after` ブレークポイント方式、BreakpointPanel UI設計                       |
|改善提案⑥: セキュリティ          |プロンプトの `<system_instructions>` / `<user_data>` 分離構造を Prompt Builder に組込    |
|LLM Gateway            |3社同時対応。統一インターフェース + 薄い Adapter パターンの型定義                                    |
|出力表示                   |別タブ表示（デフォルト）+ 統合エージェントオプション                                                |
|開発体制                   |個人開発・フルタイム・AIコーディング活用に最適化したロードマップ（10週間）                                    |
|OSS対応                  |MIT License、README/CONTRIBUTING/CHANGELOG、GitHub Actions CI、Marketplace公開準備|
|i18n                   |i18next 採用。en.json / ja.json を初期から用意                                       |
|エラー通知                  |カード上 + VS Code通知ポップアップの二重化                                                 |
|コスト計算                  |CostTable型定義（ModelPricing）。ユーザーが料金を手動更新可能                                  |
|カード状態                  |Validating / Retrying / Paused / Aborted を追加（計9状態）                         |
|ワークフローエンジン             |LangGraph.js → カスタム実装に変更（v1の要件にはオーバースペックと判断）                               |

-----

## 付録C: v3.0 最終監査結果

**監査日:** 2026-02-26
**監査観点:** 内部整合性、参照の正確性、定義の網羅性、データモデルとフローの矛盾、エッジケース

|#|指摘事項                                                      |重大度  |対応                                   |
|-|----------------------------------------------------------|-----|-------------------------------------|
|1|input_mapping のループ時参照解決が未定義                               |**高**|6.2節にループ時の参照解決ルール（output_key上書き方式）を追記|
|2|output_key の重複バリデーションがループケースを考慮していない                      |**中**|バリデーション表の記述を修正                        |
|3|セキュリティ対策の参照番号がF-06を誤参照                                    |**低**|参照を削除し、正しい記述に修正                      |
|4|Output Validatorの検証ルール参照が「6.3節」だが実際は3.5節                  |**低**|正しいセクション番号に修正                        |
|5|メタAI自身が使用するLLMモデルの指定が未定義                                  |**中**|3.2.4節にメタAIの使用モデル設定を追記               |
|6|Webview↔Extension Host間の通信プロトコルが未定義                       |**中**|ロードマップPhase 2にメッセージタイプ一覧を追記          |
|7|未決定事項#3（output_keyのループ時衝突）が6.2節で既に決定済みなのに未決定のまま           |**低**|未決定事項から削除し、決定済みセクションに移動              |

**総合評価:** 上記7件を修正済み。設計書として実装着手可能な状態。
