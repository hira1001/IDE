# Changelog

All notable changes to AI Agent Orchestrator are documented here.

## [Unreleased]

### Added
- **Settings GUI** — ⚙ button opens SettingsModal for API keys, default generation model, Ollama endpoint, and VS Code LM status (no more Command Palette-only setup)
- **Dynamic model dropdowns** — agent model selectors now only show models for configured providers; unavailable providers are hidden
- **Ollama tool calling** — OllamaAdapter now supports ReAct (Reason → Act → Observe) loops with tool calling via `/v1/chat/completions` for models like llama3.1 and qwen2.5-coder
- **o1/o3 model support** — OpenAI o1 and o3 reasoning models now work correctly (system prompt omitted, temperature/top_p excluded per API spec)
- **Enter-to-save in SettingsModal** — API key input fields accept Enter key to save
- **Ctrl+, shortcut** — opens Settings from anywhere in the webview
- **Auth error "Check API Keys" button** — when a 401/403 error occurs, a button is shown to open Settings directly
- **Expanded pricing table** — 35+ models with accurate pricing (gpt-4o variants, Claude 4.x, Gemini 2.x, o1/o3 series)
- **Empty workflow validation** — validator now reports an error when the workflow array is empty

### Fixed
- **Custom model initialization** — AgentCard now correctly detects when an agent's current model is not in any known group and shows the custom text input immediately
- **noApiKeys banner re-appearance** — clearing all API keys now correctly re-shows the "no API keys" banner
- **String.replace() `$` corruption** — system prompt template substitution now uses replacer functions to prevent `$&`, `$'` etc. from being interpreted as special patterns in filenames
- **o1/o3 rejected by runPrompt** — `VALID_PREFIXES` validation now includes `'o1'` and `'o3'`
- **Double SecretStorage reads** — `buildSettingsCurrent` now fetches API keys once with `Promise.all` and passes them to `getAvailableModels`
- **`(err as Error)` type casts** — all catch blocks now use `err instanceof Error` narrowing for type safety
- **Execution log unbounded growth** — log is now capped at 2,000 entries
- **`waitForResume()` polling** — switched from recursive `setTimeout` to `setInterval` (clearable)

### Changed
- **App.tsx IIFE removal** — error display section no longer uses IIFE anti-pattern; computed values are pre-calculated before JSX return
- **Parallel SecretStorage reads** — `buildSettingsCurrent` and `autoUpdateDefaultModel` now read all secrets concurrently with `Promise.all`
- **`getLatestHandoverNoteFor()` optimization** — reversed linear scan replaced with backwards loop (no array copy)

### Tests
- 309 tests passing (up from 287 at v0.1.0 release)
- Added tests for: OllamaAdapter tool calling, promptBuilder `from_step` resolution, metaAIService `$` filename safety, conditionEvaluator edge cases, outputValidator edge cases, validator empty workflow / invalid goto / missing conditional config, stateManager handover notes and log cap

## [0.1.0] - 2026-02-28

### Added
- Initial implementation based on design document v3.0
- Multi-LLM Gateway (OpenAI, Anthropic, Google AI)
- Workflow Orchestrator with parallel, sequential, and conditional steps
- Output Validator with automatic format correction retry
- State Manager (Blackboard pattern) for shared memory
- MetaAI Service for natural language → WorkflowConfig generation
- Template Manager (workspace + global JSON templates)
- File Context Provider (active editor snapshot)
- React Webview with VS Code theme compatibility
- i18n support (English + Japanese)
- Dry Run preview with token/cost estimation
- Breakpoint panel for mid-workflow output editing
- AbortController-based safe cancellation
- GitHub Actions CI (tests, lint, typecheck, VSIX packaging)
