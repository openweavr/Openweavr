# Weavr - Claude Code Guidelines

This file provides context for Claude Code when working on the Weavr codebase.

## Quick Links

- **Agent-specific guidelines**: See [AGENTS.md](./AGENTS.md) for detailed information about the AI agent implementation
- **Project README**: See [README.md](./README.md) for project overview

## Project Overview

Weavr is a self-hosted workflow automation platform with native AI agent support. Think Zapier/n8n, but with AI agents and full data sovereignty.

## Build & Development

```bash
# Install dependencies
npm install

# Build everything (backend + web UI)
npm run build

# Build backend only (faster, for non-web changes)
npm run build:backend

# Build web UI only
npm run build:web

# Run tests
npm test

# Start the server
node weavr.mjs serve
```

**Note**: `npm run build` now builds both backend and web UI in one command.

## Project Structure

```
src/
├── cli/              # CLI commands (program.ts)
├── gateway/          # HTTP/WebSocket server (server.ts)
├── plugins/
│   ├── builtin/      # Built-in plugins
│   │   ├── ai/       # AI agent plugin (index.ts - main agent logic)
│   │   └── ...
│   ├── loader.ts     # Plugin loading & MCP management
│   └── sdk/          # Plugin SDK types
├── mcp/              # MCP (Model Context Protocol) client
├── web/              # React web UI (Vite)
└── index.ts          # Main exports

workflows/            # Example workflow definitions (YAML)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/plugins/builtin/ai/index.ts` | AI agent implementation (~1400 lines) |
| `src/gateway/server.ts` | HTTP/WebSocket server, chat endpoint |
| `src/plugins/loader.ts` | Plugin loading, MCP server management |
| `src/web/` | React frontend (Vite build) |
| `workflows/*.yaml` | Workflow definitions |

## Coding Conventions

- **Language**: TypeScript (ESM)
- **Runtime**: Node.js 22+
- **Build**: tsdown (Rolldown-based bundler)
- **Web**: React + Vite
- **Style**: Prefer strict typing, avoid `any`

## Configuration

User config lives at `~/.weavr/config.yaml`:

```yaml
# LLM provider settings
anthropicKey: "sk-ant-..."
openaiKey: "sk-..."
model: "claude-sonnet-4-20250514"

# Search API (required for web_search tool)
# Set via environment: BRAVE_API_KEY or TAVILY_API_KEY
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `OPENAI_API_KEY` | OpenAI API key (fallback) |
| `BRAVE_API_KEY` | Brave Search API (for web_search) |
| `TAVILY_API_KEY` | Tavily Search API (alternative) |

## Testing Workflows

```bash
# Start server
node weavr.mjs serve

# Run a workflow manually
curl -X POST http://localhost:3847/api/workflows/<name>/run

# Check logs
tail -f /tmp/weavr.log
```

## Common Tasks

### Adding a new action to the AI plugin

1. Edit `src/plugins/builtin/ai/index.ts`
2. Add tool definition to `availableTools` array
3. Add handler in the `switch (toolName)` block
4. Rebuild: `npm run build`

### Modifying the system prompt

The agent system prompt is in `src/plugins/builtin/ai/index.ts` around line 1115. Key sections:
- `dateContext` - Current date (always prepended)
- `defaultSystem` - Default agent instructions
- `finalSystemPrompt` - Combined prompt sent to LLM

## Troubleshooting

- **Web search failing**: Requires `BRAVE_API_KEY` environment variable
- **Build errors**: Run `npm run build` and check for TypeScript errors
- **Server won't start**: Check if port 3847 is in use
