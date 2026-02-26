# AI Agent Orchestrator

> Orchestrate multiple AI agents for development tasks in VS Code.

Build an "AI development team" on-demand with natural language or GUI — parallel, sequential, and conditional workflows with real-time progress visualization.

## Features

- **Natural language workflow generation** — Describe what you want; the Meta AI builds the agent team automatically
- **Multi-agent pipelines** — Parallel, sequential, and conditional (review loop) steps
- **Multi-LLM support** — OpenAI, Anthropic, and Google AI in the same workflow
- **Breakpoints** — Pause at any step to review and edit intermediate outputs
- **Dry run** — Preview prompts and estimate costs before executing
- **Output Validator** — Auto-validates LLM output format with one retry
- **Partial retry** — Re-run only the failed card, not the whole workflow
- **Templates** — Save and reuse workflow configurations as JSON
- **i18n** — English and Japanese UI from day one

## Quick Start

1. Install the extension from VS Code Marketplace
2. Open a file you want to process (Markdown, code, etc.)
3. Run **AI Agent: Open Panel** from the Command Palette (`Ctrl+Shift+P`)
4. Configure your API keys via **AI Agent: Configure API Keys**
5. Type a natural language instruction and click **Generate**
6. Review the generated agent cards, then click **▶ Run**

## API Keys

The extension uses VS Code's `SecretStorage` — your keys are stored securely and never leave your machine.

Supported providers:
| Provider | Models |
|---|---|
| OpenAI | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo` |
| Anthropic | `claude-sonnet-4-5`, `claude-haiku-4-5`, `claude-opus-4-5` |
| Google AI | `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash` |

## Example Workflows

**Technical article (document-focused):**
> "Draft an article and create a system diagram in parallel, then run a quality review loop up to 3 times"

**Code review (code-focused):**
> "Review this TypeScript file and generate improvement suggestions, then create a fixed version"

## Architecture

```
Extension Host (Node.js)         Webview (React)
├── MetaAI Service          ←──  ChatInput (natural language)
├── Orchestrator                 PipelineView (cards + steps)
│   ├── Step Scheduler           ExecutionBar (run / stop / preview)
│   ├── Prompt Builder           DryRunPanel
│   ├── Output Validator         BreakpointPanel
│   └── Condition Evaluator
├── LLM Gateway
│   ├── OpenAI Adapter
│   ├── Anthropic Adapter
│   └── Google AI Adapter
├── State Manager (Blackboard)
└── Template Manager
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build (extension + webview)
npm run build

# Watch mode
npm run dev
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions.

## License

[MIT](LICENSE)
