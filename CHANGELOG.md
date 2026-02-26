# Changelog

All notable changes to AI Agent Orchestrator are documented here.

## [Unreleased]

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
