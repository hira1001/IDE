# AI Agent Orchestrator — メジャーアップデート設計書 v4.0

**作成日:** 2026-02-27  
**最終更新:** 2026-02-27 22:10 — 並行作業 (クリップボード修正 / Undo/Redo修正 / プロジェクト全体コンテキスト実装) を反映  
**前提:** 設計書 v3.0 の実装が完了し、プロジェクト全体コンテキスト機能も追加実装された段階から、品質・互換性・UXを次のレベルに引き上げるための改善計画

---

## 目的

本ドキュメントは、現在の実装に残る技術的負債とUXギャップを解消し、Vanilla VS Code だけでなく **Cursor, Windsurf, VSCodium, GitHub Codespaces, Gitpod, vscode.dev** を含むすべての VS Code 系環境でシームレスに動作する拡張機能に昇格させるための設計書である。

各項目は「すでに満たされている」か「対応が必要」かを精査した結果、**実際に対応が必要な項目のみ** を記載している。

---

## 現状の実装評価（対応不要 = 既に実装済み）

| 提案された項目 | 実装状態 | 判定 |
|---|---|---|
| CSS Variables / テーマ追従 | `--aao-*` が `var(--vscode-*)` にすべてマッピング済み | ✅ 対応不要 |
| クリップボードの安全性 | `AgentCard.tsx` で `navigator.clipboard` → 失敗時 `clipboard:write` メッセージで拡張ホスト側 `vscode.env.clipboard` にフォールバック（`1fc8e2e` で修正済み） | ✅ 対応不要 |
| ドラッグ＆ドロップ | `StepBlock.tsx` + `AgentCard.tsx` にカード並べ替えD&D実装済み + CSSアニメーション (`01e7ed3`) | ✅ 対応不要 |
| VS Code 標準通知 | `showInformationMessage` / `showErrorMessage` / `showWarningMessage` を計8箇所で使用済み | ✅ 対応不要 |
| トークン/コスト表示 | `DryRunPanel` + `ExecutionBar` に推定コスト表示 | ✅ 対応不要 |
| 部分リトライ | `orchestrator.retryTask()` + AgentCard のリトライボタン | ✅ 対応不要 |
| Proposed API | 使用なし | ✅ 対応不要 |
| `@vscode/webview-ui-toolkit` ライブラリ使用 | package.json に依存あるがコード中での `import` ゼロ。カスタムCSS で同等のネイティブ感を達成 | ✅ 対応不要 |
| **Undo / Redo** | `useWorkflowState.ts` に線形テープモデルで実装済み（`1fc8e2e` で修正済み） | ✅ 対応不要 |
| **プロジェクト全体コンテキスト** | `projectContextProvider.ts` (506行) — 3層モデル (ツリー→アクティブ→関連ファイル)、import解析、.gitignore、フレームワーク検出。`__project__`/`__tree__`/`__source__` サポート (`f19f01b`) | ✅ 対応不要 |
| **ContextIndicatorコンポーネント** | `App.tsx` にFile/Projectトグル、リフレッシュ、トークン推計バッジ表示 | ✅ 対応不要 |
| **PromptBuilder `__project__`/`__tree__`** | XML構造 (`<project_context>`, `<structure>`, `<active_file>`, `<related_files>`) で構造化済み | ✅ 対応不要 |
| **StateManager ProjectContext** | `setProjectContext()` / `getProjectContext()` 追加済み、後方互換性維持 | ✅ 対応不要 |
| **VS Code設定** | `contextMode` (file/project) / `contextTokenBudget` (デフォルト32000) 追加済み | ✅ 対応不要 |

---

## A. クロスプラットフォーム互換性（必須修正）

> **注:** 並行AIにより `projectContextProvider.ts` が `fs`/`path` を使用して新規実装されたため、移行対象ファイルが増えている。

### A-1. Node.js `fs` / `path` の排除 → `vscode.workspace.fs` / `vscode.Uri` 移行

**現状の問題:**

| ファイル | 使用箇所 | 問題 |
|---|---|---|
| `src/services/templateManager.ts` | `import * as fs from 'fs/promises'` / `import * as path from 'path'` | Web Extension (vscode.dev, Codespaces) で動作不可 |
| `src/services/projectContextProvider.ts` | `import * as fs from 'fs'` / `import * as path from 'path'` | 同上 |

**対応方針:**
- `fs.readFile` → `vscode.workspace.fs.readFile`
- `fs.writeFile` → `vscode.workspace.fs.writeFile`
- `fs.readdir` → `vscode.workspace.fs.readDirectory`
- `fs.mkdir` → `vscode.workspace.fs.createDirectory`
- `fs.stat` → `vscode.workspace.fs.stat`
- `path.join` → `vscode.Uri.joinPath`
- `path.extname` → URI ベースのヘルパー関数
- `path.basename` → `vscode.Uri` のパスセグメント操作
- `path.relative` → ワークスペースルートURIからの相対パス計算

**影響範囲:**
- `templateManager.ts` の `save()`, `list()`, `delete()`, `importFromJson()`, `exportToJson()` 全メソッド
- `projectContextProvider.ts` の `buildFileTree()`, `readRelatedFiles()`, `resolveImportPaths()` など

**注意:** `TemplateManager` に `vscode.Uri` を渡すため、コンストラクタのシグネチャが変更になる。テスト (`templateManager.test.ts`) も `vscode.workspace.fs` のモック対応が必要。

---

### A-2. `process.env` の排除

**現状の問題:**

`extension.ts` の4箇所で `process.env.HOME` / `process.env.USERPROFILE` を使用:
- L215: テンプレート保存パス
- L229: テンプレート一覧パス
- L274: テンプレートエクスポートパス
- L299: テンプレートインポートパス

**対応方針:**
- グローバルテンプレート保存先: `vscode.Uri.joinPath(context.globalStorageUri, 'templates')` に変更
- ワークスペーステンプレート保存先: `vscode.Uri.joinPath(workspaceFolderUri, '.vscode', 'aao-templates')` に変更
- `process.env` への依存を完全排除

---

### A-3. SecretStorage のフォールバック

**現状の問題:**

`extension.ts` の `getApiKeys()` と `configureApiKeys()` で `context.secrets.get()` / `context.secrets.store()` を try-catch なしで直接呼び出し。
OSのキーチェーンがない環境（Docker コンテナ、VSCodium、一部の Linux）で例外が発生するとクラッシュする。

**対応方針:**

```typescript
// セッション中のメモリフォールバック
const memorySecrets = new Map<string, string>();

async function safeSecretsGet(
  secrets: vscode.SecretStorage, 
  key: string
): Promise<string | undefined> {
  try {
    return await secrets.get(key);
  } catch {
    // フォールバック: メモリから取得（セッション限定）
    return memorySecrets.get(key);
  }
}

async function safeSecretsStore(
  secrets: vscode.SecretStorage, 
  key: string, 
  value: string
): Promise<void> {
  try {
    await secrets.store(key, value);
  } catch {
    // フォールバック: メモリに保存（セッション限定）
    memorySecrets.set(key, value);
    vscode.window.showWarningMessage(
      'API key stored in memory only (keychain unavailable). It will be lost when VS Code closes.'
    );
  }
}
```

---

## B. コア品質・信頼性の強化

### B-1. API呼び出しの指数バックオフリトライ（設計書 §7 非機能要件）

**現状の問題:**

`orchestrator.ts` の `runTask()` で LLM API 呼び出しが失敗した場合、即座にエラーになる。
設計書 §7 では「APIタイムアウト 60秒 + 自動リトライ最大3回（指数バックオフ）」が必須要件。

**対応方針:**

```typescript
private async callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await this.callWithTimeout(fn(), this.timeout);
    } catch (err) {
      lastError = err as Error;
      if (lastError.name === 'AbortError') throw lastError;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);  // 1s, 2s, 4s
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError!;
}
```

- `runTask()` 内の `this.callWithTimeout(gateway.chat(...))` を `this.callWithRetry(() => gateway.chat(...))` に置換
- Output Validator のリトライ（1回、既存）とは独立。API レベルのネットワーク/レート制限エラーのみ対象

---

### B-2. 循環参照検出（設計書 §3.4 バリデーション項目）

**現状の問題:**

`validator.ts` に循環参照チェックのロジックがない。`on_fail_goto` / `then_goto` が相互参照すると無限ループになりうる。

**対応方針:**

```typescript
// validator.ts に追加
function detectCycles(workflow: WorkflowStep[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const visited = new Set<number>();
  
  function dfs(stepNumber: number, path: Set<number>): boolean {
    if (path.has(stepNumber)) return true; // 循環検知
    if (visited.has(stepNumber)) return false;
    visited.add(stepNumber);
    path.add(stepNumber);
    
    const step = workflow.find(s => s.step === stepNumber);
    if (!step) return false;
    
    if (step.on_fail_goto !== undefined && dfs(step.on_fail_goto, new Set(path))) {
      errors.push({
        type: 'error',
        message: `Circular reference detected: step ${stepNumber} → step ${step.on_fail_goto}`,
        target: `step_${stepNumber}`,
      });
    }
    if (step.then_goto !== undefined && dfs(step.then_goto, new Set(path))) {
      errors.push({
        type: 'error',
        message: `Circular reference detected: step ${stepNumber} → step ${step.then_goto}`,
        target: `step_${stepNumber}`,
      });
    }
    return false;
  }
  
  for (const step of workflow) {
    dfs(step.step, new Set());
  }
  return errors;
}
```

---

### B-3. `Promise.all` → `Promise.allSettled` への変更

**現状の問題:**

`orchestrator.ts` L222 の並列ステップ実行で `Promise.all()` を使用。
1つのタスクがエラーになると他の並列タスクも巻き込まれ、出力が失われる。

**対応方針:**

```typescript
private async runParallelStep(...): Promise<void> {
  const results = await Promise.allSettled(tasks);
  // 失敗したタスクのエラーは stateManager に記録済み（runTask内で処理）
  // ここでは全体のエラーチェックは不要
}
```

---

### B-4. コアモジュールのテスト追加

**テストが不足しているモジュール（重要度順）:**

| モジュール | LOC | 推奨テスト |
|---|---|---|
| `orchestrator.ts` | 438 | parallel/sequential/conditional 実行、pause/resume、abort、retryTask、指数バックオフ |
| `projectContextProvider.ts` | 506 | ファイルツリー構築、import解析、トークンバジェット制限、関連ファイル優先順位 |
| `metaAIService.ts` | 119 | JSONパース、コードフェンス除去、バリデーション |
| 3つの LLM アダプター | 各60行 | API レスポンス処理、エラーハンドリング、abort |

---

## C. UXの向上（新機能）

### C-1. テキスト選択の自動取得と表示

**現状:**

`fileContextProvider.ts` はアクティブファイルの全内容を取得するが、**エディタで選択中のテキスト（ハイライト部分）** は取得していない。

**対応方針:**

`fileContextProvider.ts` に選択範囲取得を追加:

```typescript
interface SourceInput {
  content: string;
  filename: string;
  language_id: string;
  line_count: number;
  byte_size: number;
  // ★ 新規追加
  selection?: {
    text: string;
    startLine: number;
    endLine: number;
  };
}
```

Webview側:
- 入力欄上部に選択範囲バッジを表示: `📎 utils.ts:L23-L45 (選択中: 22行)`
- プロンプトに選択範囲を `__selection__` として自動埋め込み

アクティブエディタ変更時 (`onDidChangeActiveTextEditor`) / 選択変更時 (`onDidChangeTextEditorSelection`) に自動更新。

---

### C-2. インラインDiff適用機能（Actionable Outputs）

**用途:** エージェントがコードを生成した場合に、元ファイルとの差分を VS Code 標準の Diff エディタで確認・マージできる。

**対応方針:**

1. AgentCard に「✨ エディタに適用」ボタンを追加（`output_format === 'Code'` の場合のみ表示）

2. Webview → Extension Host メッセージ:
```typescript
// types/index.ts に追加
type WebviewMessage = ... | {
  type: 'output:apply_diff';
  payload: { content: string; output_key: string };
};
```

3. Extension Host 側の処理:
```typescript
case 'output:apply_diff': {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  // AI提案内容を仮想ドキュメントとして保持
  const scheme = 'aao-proposed';
  const proposedUri = vscode.Uri.parse(
    `${scheme}:${editor.document.fileName} (AI Proposed)`
  );
  
  // TextDocumentContentProvider を登録して仮想ドキュメントを提供
  // vscode.commands.executeCommand('vscode.diff', 
  //   editor.document.uri, proposedUri, 'Current ↔ AI Proposed');
  break;
}
```

4. `TextDocumentContentProvider` を `activate()` 内で登録:
```typescript
const provider = new class implements vscode.TextDocumentContentProvider {
  private contents = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this._onDidChange.event;
  
  setContent(uri: vscode.Uri, content: string) {
    this.contents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }
  
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }
};

context.subscriptions.push(
  vscode.workspace.registerTextDocumentContentProvider('aao-proposed', provider)
);
```

---

### C-3. Ollama コスト表示の改善

**現状:** DryRunPanel のコスト表示で Ollama モデルも他のモデルと同じく `$0.00` と表示される。

**対応方針:**

`pricing.ts` で Ollama モデルの判定を追加:

```typescript
export function getCostForTokens(model: string, input: number, output: number): number {
  if (model.startsWith('ollama:')) return 0;
  // ...既存のロジック
}

export function getCostLabel(model: string, cost: number): string {
  if (model.startsWith('ollama:')) return 'Local (Free)';
  return `$${cost.toFixed(4)}`;
}
```

DryRunPanel / ExecutionBar で `getCostLabel()` を使用し、Ollama 実行時は `💰 Local (Free)` と表示。

---

### C-4. Edit & Resume（プロンプト修正＆再実行）

**現状:** 失敗したタスクは「リトライ」（同じプロンプトで再実行）のみ可能。

**対応方針:**

失敗したタスクの AgentCard に新しいアクション追加:
- 既存: 「🔄 再実行」（同一プロンプトでリトライ）
- **新規: 「✏️ 修正して再実行」（指示を編集してからリトライ）**

フロー:
1. ユーザーが「✏️ 修正して再実行」をクリック
2. AgentCard の `instructions` / `constraints` エディタが展開
3. ユーザーが内容を修正
4. 「▶ この修正で再実行」ボタンで、修正後の config で `retryTask()` を呼び出し

これは既存の GUI 編集機能 + 部分リトライの組み合わせで実現可能。主な変更は UI ワークフローの改善。

---

## D. アーキテクチャ改善

### D-1. `TemplateManager` への `vscode` 依存注入

**現状:** `TemplateManager` は `fs` / `path` を直接使用しており、Extension Host の `vscode` API に依存していない独立モジュール。

**移行方針:**

`TemplateManager` のコンストラクタに `vscode.workspace.fs` 互換のファイルシステムインターフェースを注入する:

```typescript
interface FileSystem {
  readFile(uri: vscode.Uri): Thenable<Uint8Array>;
  writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>;
  readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
  createDirectory(uri: vscode.Uri): Thenable<void>;
  delete(uri: vscode.Uri): Thenable<void>;
  stat(uri: vscode.Uri): Thenable<vscode.FileStat>;
}

class TemplateManager {
  constructor(private readonly fs: FileSystem) {}
  // ...
}
```

テスト時はモック `FileSystem` を注入でき、テストの `fs` 依存も解消される。

---

### D-2. CSP (Content Security Policy) の `connect-src` 追加

**現状の問題:**

CSP ヘッダーに `connect-src` ディレクティブがない。LLM アダプターが Extension Host 側の `fetch` を使っているため現状は問題ないが、将来的にWebview から直接API呼び出しする場合にブロックされる。

**対応方針:**

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'nonce-${nonce}' ${webview.cspSource};
  style-src ${webview.cspSource} 'unsafe-inline';
  font-src ${webview.cspSource};
  img-src ${webview.cspSource} data:;
  connect-src https://api.openai.com https://api.anthropic.com 
              https://generativelanguage.googleapis.com;
" />
```

> ※ Ollama は `http://localhost:*` を許可する必要があるが、CSP の `connect-src` で localhost を許可するかは要検討。実際には全てのAPI呼び出しは Extension Host 側で行われるため、現状の構成を維持し、Webview からの直接呼び出しは行わない方針を推奨。

---

## 優先順位と工数見積

| 優先度 | ID | 項目 | 工数 | カテゴリ |
|---|---|---|---|---|
| 🔴 1 | A-1 | `fs`/`path` → `vscode.workspace.fs`/`Uri` 移行 | 大 | 互換性 |
| 🔴 2 | A-2 | `process.env` の排除 | 小 | 互換性 |
| 🔴 3 | A-3 | SecretStorage フォールバック | 小 | 互換性 |
| 🔴 4 | B-1 | 指数バックオフリトライ | 小 | 信頼性 |
| 🔴 5 | B-2 | 循環参照検出 | 小 | 信頼性 |
| 🟡 6 | B-3 | `Promise.allSettled` 変更 | 小 | 信頼性 |
| 🟡 7 | B-4 | コアモジュールテスト追加 | 大 | 品質 |
| 🟡 8 | C-1 | テキスト選択の自動取得 | 中 | UX |
| 🟡 9 | C-2 | インラインDiff適用 | 中 | UX |
| 🟡 10 | C-3 | Ollama コスト表示改善 | 小 | UX |
| 🟢 11 | C-4 | Edit & Resume | 小 | UX |
| 🟢 12 | D-1 | TemplateManager DI リファクタ | 中 | 設計 |
| 🟢 13 | D-2 | CSP connect-src | 小 | セキュリティ |

**合計推定工数:** 約3〜4週間（フルタイム、AIアシスタント活用前提）

---

## 実装順序の推奨

### Phase 4A: クロスプラットフォーム互換性 (1.5週間)

1. D-1: `TemplateManager` に FileSystem インターフェース注入
2. A-1: `templateManager.ts` / `projectContextProvider.ts` の `fs`/`path` 排除
3. A-2: `extension.ts` の `process.env` 排除
4. A-3: SecretStorage フォールバック

### Phase 4B: コア品質強化 (1週間)

5. B-1: 指数バックオフリトライ
6. B-2: 循環参照検出
7. B-3: `Promise.allSettled` 変更
8. B-4: `orchestrator.ts` / `projectContextProvider.ts` のテスト追加

### Phase 4C: UX向上 (1週間)

9. C-1: テキスト選択の自動取得
10. C-3: Ollama コスト表示改善
11. C-2: インラインDiff適用
12. C-4: Edit & Resume

---

## 付録: 対応不要と判断した項目の根拠

| 提案項目 | 不要と判断した理由 |
|---|---|
| `@vscode/webview-ui-toolkit` のコンポーネント使用 | カスタム CSS で `--vscode-*` 変数に完全にマッピング済み。Toolkit のコンポーネントは見た目の統一性に貢献するが、現在の実装は同等以上のネイティブ感を達成しており、導入コストに見合わない |
| クリップボード安全性 | `AgentCard.tsx` で `navigator.clipboard` → `vscode.env.clipboard` のフォールバック済み |
| ドラッグ&ドロップアニメーション | `StepBlock.tsx` + `AgentCard.tsx` に D&D 実装済み（CSS アニメーション含む） |
| VS Code 標準通知 | 既に8箇所で `showInformationMessage` / `showErrorMessage` / `showWarningMessage` を使用 |
| トークン/コスト推定表示 | `DryRunPanel` で表示済み。Ollama の「Local (Free)」表示のみ C-3 として追加 |
