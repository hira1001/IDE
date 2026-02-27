# AI Agent Orchestrator — 開発途中項目 調査レポート

**調査日:** 2026-02-27  
**対象:** AI Agent Orchestrator VSCode 拡張機能  
**調査方法:** 設計書 `design-v3.md` と実装コードの差分分析、ソースコード全文検索

---

## サマリー

- ソースコード内に `TODO` / `FIXME` / `HACK` / `WIP` / `未実装` コメントは **一切なし**
- 設計書のロードマップ Phase 0-3 の大部分は実装済みだが、チェックリストは全て `[ ]` のまま
- 主な不足: コアモジュールのテスト、非機能要件の一部、UIコンポーネント2件

---

## 1. 未実装のUIコンポーネント

設計書 §5.3 で定義されているが、`src/webview/components/` に存在しないもの:

| コンポーネント | 設計書の役割 | 影響する機能要件 |
|---|---|---|
| **`StepConnector`** | ステップ間の矢印接続表示。条件分岐のジャンプ矢印を視覚化 | §4.2「条件分岐＝矢印の分岐表示」 |
| **`AddStepButton`** | ステップの追加ボタン | **F-13** ステップ操作GUI |

> ステップの追加・削除・移動のGUI操作 (F-13) のうち、並列⇔直列切替は `StepBlock.tsx` に実装済み。
> ステップの**追加と削除**は未実装。

---

## 2. 非機能要件の未充足

設計書 §7 の非機能要件との差分:

### 🔴 重大度: 高

| 要件 | 設計書 | 実装状態 |
|---|---|---|
| API エラーリトライ | 自動リトライ**最大3回 (指数バックオフ)** | ❌ **未実装** — API呼び出し失敗時はそのままエラー。`callWithTimeout()` はタイムアウト検知のみ |
| 循環参照検出 | §3.4「循環参照がないか」をコンパイル時チェック | ❌ `validator.ts` に **ロジックなし** |

### 🟡 重大度: 中

| 要件 | 設計書 | 実装状態 |
|---|---|---|
| 通知の二重化 | カード上表示 + VS Code通知ポップアップ | ⚠️ エラー時のみ `showErrorMessage` で二重通知。完了等は Webview Toast のみ |
| 同時実行数 | 並列ステップ最大5エージェント | ⚠️ `Promise.all` で無制限実行。上限チェックなし |
| CostTable手動更新 | §8.8「設定ファイルとして外出し、手動更新可能」 | ❌ `pricing.ts` にハードコード。設定UIなし |

---

## 3. テストカバレッジの主要ギャップ

### テストが存在するモジュール ✅

`conditionEvaluator`, `dryRunner`, `outputValidator`, `promptBuilder`, `stateManager`, `validator`, `ollamaAdapter`, `tokenCounter`, `templateManager`

### テストが存在しないモジュール ❌

| モジュール | LOC | 重要度 | 備考 |
|---|---|---|---|
| **`orchestrator.ts`** | 438行 | 🔴 **最重要** | コアエンジン。parallel/sequential/conditional実行、pause/resume、retry |
| **`projectContextProvider.ts`** | 506行 | 🔴 **高** | 最大のサービスモジュール。import解析、ファイルツリー構築、トークンバジェット制御 |
| `metaAIService.ts` | 119行 | 🟡 中 | ワークフロー自動生成。JSONパース・バリデーション |
| `openaiAdapter.ts` | 61行 | 🟡 中 | API統合テスト |
| `anthropicAdapter.ts` | 60行 | 🟡 中 | API統合テスト |
| `googleAdapter.ts` | 64行 | 🟡 中 | API統合テスト |
| `extension.ts` | 556行 | 🟡 中 | エントリポイント。メッセージハンドリング統合テスト |
| `fileContextProvider.ts` | 52行 | 🟢 低 | VSCode API依存 |
| Webview 全コンポーネント | — | 🟢 低 | React コンポーネントのテストが一切なし |

---

## 4. 機能要件の不足分

| ID | 機能名 | 不足している部分 |
|---|---|---|
| **F-06** | 実行結果の出力 | 「オプションで統合エージェントで1ファイルにまとめる」機能が未実装 |
| **F-13** | ステップ操作GUI | ステップの**追加・削除・カード移動**が未実装 (種類切替のみ実装済み) |

---

## 5. コード品質の気になる点

| 項目 | 詳細 | 推奨アクション |
|---|---|---|
| `Promise.all` vs `Promise.allSettled` | README に `Promise.allSettled` と記載だが実装は `Promise.all`。並列タスクで1つがエラーになると**全タスクが巻き込まれる** | `Promise.allSettled` に変更 |
| 未使用 NPM 依存 | `@anthropic-ai/sdk`, `@google/generative-ai`, `openai` が dependencies にあるが、全アダプターは `fetch` 直接使用 | 削除してバンドルサイズ削減 |
| DryRunner のコンテキスト非対応 | `DryRunner.run()` は `SourceInput` のみ。`ProjectContext` に非対応 | シグネチャを拡張 |
| LoopController の独立性 | 設計書では独立コンポーネントだが `orchestrator.ts` に統合 | 設計書を更新 or 分離 |

---

## 6. 未決定事項 (設計書 §11)

| # | 項目 | 選択肢 | 設計書の判断時期 |
|---|---|---|---|
| 1 | ストリーミング出力 | 有効 vs 無効 | Phase 2 で判断 |
| 2 | 条件分岐の手動オーバーライド | 自動判定のみ vs 確認ステップ挿入 | Phase 2 でUXテスト後 |
| 3 | VS Code Marketplace 公開名 | 仮称のまま vs リブランド | Phase 3 で決定 |

---

## 7. ロードマップ更新状況

設計書 §9 のチェックリスト全項目が `[ ]` のまま。実態に合わせた更新が必要:

```diff
 ### Phase 0: 技術検証 + プロジェクト基盤
-- [ ] プロジェクト初期化（TypeScript + ESLint + Prettier + Vitest）
-- [ ] GitHub リポジトリ作成 + CI（GitHub Actions）
-- [ ] 各LLM API の基本接続テスト
-- [ ] VS Code Webview + React の基本構成確認
-- [ ] メタAIのプロンプトテスト
+- [x] プロジェクト初期化（TypeScript + ESLint + Prettier + Vitest）
+- [x] GitHub リポジトリ作成 + CI（GitHub Actions）
+- [ ] 各LLM API の基本接続テスト ← Ollama以外テストなし
+- [x] VS Code Webview + React の基本構成確認
+- [ ] メタAIのプロンプトテスト ← テストなし
```

---

## 推奨対応の優先順位

| 優先度 | 項目 | 工数見積 |
|---|---|---|
| 🔴 1 | `orchestrator.ts` のユニットテスト追加 | 中 |
| 🔴 2 | `projectContextProvider.ts` のユニットテスト追加 | 中 |
| 🔴 3 | API呼び出しの指数バックオフリトライ (最大3回) 実装 | 小 |
| 🔴 4 | 循環参照検出を `validator.ts` に追加 | 小 |
| 🟡 5 | `Promise.all` → `Promise.allSettled` 変更 | 小 |
| 🟡 6 | 未使用 NPM 依存の削除 | 小 |
| 🟡 7 | `StepConnector` / `AddStepButton` の実装 | 中 |
| 🟡 8 | DryRunner の ProjectContext 対応 | 小 |
| 🟢 9 | ロードマップのチェックリスト更新 | 微小 |
| 🟢 10 | CostTable の設定UI / 統合エージェント機能 | 中 |
