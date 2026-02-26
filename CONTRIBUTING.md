# Contributing to AI Agent Orchestrator

Thank you for your interest in contributing!

## Development Setup

### Prerequisites

- Node.js 20+
- VS Code 1.85+

### Getting Started

```bash
git clone https://github.com/ai-agent-orchestrator/vscode-extension
cd vscode-extension
npm install
```

### Project Structure

```
src/
├── types/          # TypeScript interfaces (shared by Extension Host + Webview)
├── llm/            # LLM Gateway adapters (OpenAI, Anthropic, Google AI)
├── orchestrator/   # Workflow engine (Scheduler, Prompt Builder, Validator)
├── services/       # MetaAI, Template Manager, File Context Provider
├── webview/        # React UI (components, hooks, i18n)
└── extension.ts    # VS Code Extension entry point
docs/
└── design-v3.md    # Full design document
```

### Development Workflow

```bash
# Type check (extension)
npx tsc --noEmit

# Type check (webview)
npx tsc --noEmit -p tsconfig.webview.json

# Run tests (watch mode)
npm run test:watch

# Lint
npm run lint

# Format
npm run format

# Build both extension + webview
npm run build
```

### Running in VS Code

1. Open the repo in VS Code
2. Press `F5` to launch the Extension Development Host
3. The extension will be available in the new VS Code window

### Testing

- Unit tests live alongside source files (`*.test.ts`)
- Run with `npm test`
- Tests use Vitest (no VS Code API mocking required for unit tests)

### i18n

All UI strings go in:
- `src/webview/i18n/en.json` (English)
- `src/webview/i18n/ja.json` (Japanese)

Add both when adding new UI text.

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes with tests
4. Run `npm test && npm run lint` before submitting
5. Open a PR against `main`

## Code of Conduct

Be respectful and constructive. This is a welcoming, inclusive project.
