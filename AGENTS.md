# Weavr AI Agent Documentation

This document provides detailed information about the AI agent implementation in Weavr.

> **Note**: When making changes to the AI agent, update the public documentation in `docs/agents.html` to keep it in sync. This includes new tools, configuration options, or behavior changes.

## Overview

The AI agent is implemented in `src/plugins/builtin/ai/index.ts` and provides autonomous task execution with tool use capabilities.

## Agent Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent Loop                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   System    │  │    LLM      │  │   Tool Execution    │  │
│  │   Prompt    │→ │   Call      │→ │   (web_search,      │  │
│  │ (+ date)    │  │ (Anthropic/ │  │    web_fetch, etc)  │  │
│  │             │  │  OpenAI)    │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                          ↑                    │              │
│                          └────────────────────┘              │
│                        (iterate until done)                  │
└─────────────────────────────────────────────────────────────┘
```

## Available Tools

### web_search
Search the web using Brave Search API.

**Requires**: `BRAVE_API_KEY` environment variable

```typescript
{
  name: 'web_search',
  description: 'Search the web for information',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' }
    },
    required: ['query']
  }
}
```

**Setup**:
1. Get a free API key at https://brave.com/search/api/
2. Choose "Data for Search" plan (free: 2000 queries/month)
3. Set `BRAVE_API_KEY` environment variable

**Fallback**: Tavily Search (`TAVILY_API_KEY`) if Brave unavailable.

### web_fetch
Fetch and extract content from a URL.

```typescript
{
  name: 'web_fetch',
  description: 'Fetch content from a URL',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' }
    },
    required: ['url']
  }
}
```

### shell_exec
Execute shell commands (sandboxed).

```typescript
{
  name: 'shell_exec',
  description: 'Execute a shell command',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute' }
    },
    required: ['command']
  }
}
```

### read_file / write_file
File system operations.

## System Prompt Structure

The agent system prompt has several components:

### 1. Date Context (Always Prepended)
```typescript
const dateContext = `## Current Date
Today is ${currentDate}. Always use this date as your reference for "current", "today", "now", or "latest" queries.`;
```

### 2. Default System Prompt
Located at ~line 1120 in `src/plugins/builtin/ai/index.ts`:

```typescript
const defaultSystem = `You are an autonomous AI agent that accomplishes tasks through careful planning and strategic tool use.

## Your Approach (Follow This Order)

### 1. PLAN FIRST (Before ANY tool call)
Before making your first tool call, create a brief plan...

### 2. GATHER STRATEGICALLY
When using tools:
- Batch related queries when possible
- Prefer web_search first, then web_fetch for specific URLs
- If a tool fails, try alternatives immediately in the same turn

### 3. REFLECT BEFORE CONTINUING
After each tool result, briefly assess...

### 4. SYNTHESIZE EARLY
Once you have sufficient information, synthesize your answer.

## Efficiency Rules
- Aim to complete in 2-3 iterations, not 5+
- When you have 70%+ of needed info, start synthesizing
...`;
```

### 3. Custom System Prompts
Workflows can provide custom system prompts via the `system` parameter:

```yaml
steps:
  - id: agent
    action: ai.agent
    with:
      task: "Research market trends"
      system: "You're a financial analyst..."  # Custom prompt
```

The date context is always prepended: `finalSystemPrompt = dateContext + (customSystem ?? defaultSystem)`

## Agent Configuration

### Workflow Parameters

```yaml
steps:
  - id: agent
    action: ai.agent
    with:
      task: "The task description"           # Required
      tools: "web_search,web_fetch,shell"    # Optional: comma-separated
      maxIterations: 10                       # Optional: default 10
      system: "Custom system prompt"          # Optional
```

### Global Config (~/.weavr/config.yaml)

```yaml
anthropicKey: "sk-ant-..."
openaiKey: "sk-..."
model: "claude-sonnet-4-20250514"
```

## LLM Provider Priority

1. **Anthropic** (if `anthropicKey` configured)
2. **OpenAI** (if `openaiKey` configured)

## MCP Integration

The agent can use tools from MCP (Model Context Protocol) servers:

```typescript
// MCP tools are discovered automatically from running servers
const mcpTools = await mcpManager.getAllTools();
```

MCP servers can be configured in `~/.weavr/config.yaml`:

```yaml
mcp:
  servers:
    my-server:
      command: "npx"
      args: ["-y", "@some/mcp-server"]
```

### Git MCP Server

For local git operations (commits, branches, diffs, etc.), configure the Git MCP server:

```yaml
mcp:
  servers:
    git:
      command: "npx"
      args: ["-y", "@modelcontextprotocol/server-git"]
```

This gives the AI agent access to tools like:
- `git_log` - View commit history
- `git_diff` - See changes between commits
- `git_status` - Check repository status
- `git_commit` - Create commits
- `git_branch` - Manage branches
- `git_checkout` - Switch branches

**Example workflow using git tools:**

```yaml
name: code-review
trigger:
  type: manual
steps:
  - id: review
    action: ai.agent
    with:
      task: |
        Review the recent commits and summarize the changes.
        List any potential issues or improvements.
      tools: "git"
```

**Note**: The Git MCP server operates on local repositories. For GitHub-specific operations (issues, PRs, webhooks), use the `github` plugin actions.

## Error Handling

### Tool Failures
- Tools return error messages starting with `[FAILED]` or `[ERROR]`
- The agent is instructed to try alternatives in the same iteration
- Helpful suggestions are provided (e.g., specific URLs to try)

### Rate Limiting
- Uses `fetchWithTimeout` helper with retry logic
- Exponential backoff for 429/5xx errors
- Respects `Retry-After` headers

### Missing API Keys
Returns structured JSON with setup instructions:

```json
{
  "error": "missing_search_api_key",
  "message": "web_search requires a search API key...",
  "setup": {
    "brave": {
      "url": "https://brave.com/search/api/",
      "env": "BRAVE_API_KEY"
    }
  }
}
```

## Performance Optimization

The system prompt encourages efficient agent behavior:

1. **Planning First**: Think before making tool calls
2. **Batching**: Group related searches when possible
3. **Early Synthesis**: Don't over-research (70% rule)
4. **Same-Turn Recovery**: Try alternatives immediately on failure
5. **Iteration Targets**: Aim for 2-3 iterations, not 5+

## Debugging

### Enable Verbose Logging
Check server logs:
```bash
tail -f /tmp/weavr.log
```

### Log Output Includes
- `Agent iteration X/Y`
- Tool names and inputs
- `Using Brave Search API` / `Using Tavily Search API`
- Search results count
- Error messages

### Common Issues

| Issue | Solution |
|-------|----------|
| "missing_search_api_key" | Set `BRAVE_API_KEY` env var |
| "Agent completed with no result" | Check if task is clear |
| Rate limiting | Reduce concurrent workflows |
| Wrong dates in searches | Date context should fix this |

## Code Locations

| Component | File | Lines (approx) |
|-----------|------|----------------|
| Agent action definition | `src/plugins/builtin/ai/index.ts` | 629-1424 |
| Tool definitions | `src/plugins/builtin/ai/index.ts` | 664-800 |
| Web search implementation | `src/plugins/builtin/ai/index.ts` | 800-950 |
| System prompt | `src/plugins/builtin/ai/index.ts` | 1115-1175 |
| Agentic loop | `src/plugins/builtin/ai/index.ts` | 1180-1400 |
