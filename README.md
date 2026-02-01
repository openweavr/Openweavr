# 🧵 Weavr

**Self-hosted workflow automation with AI agents.**

*Weave your dev life together.*

[![CI](https://github.com/manthan787/weavr/actions/workflows/ci.yml/badge.svg)](https://github.com/manthan787/weavr/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/manthan787/weavr?include_prereleases&sort=semver)](https://github.com/manthan787/weavr/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 22+](https://img.shields.io/badge/node-22%2B-green.svg)](https://nodejs.org)

---

Weavr connects AI agents with your developer tools—GitHub, Linear, Notion, Slack, databases, CI/CD, and more. Think Zapier/n8n, but with native AI agent support and full data sovereignty.

## ✨ Features

- **🏠 Self-hosted** — Your workflows, your data, your infrastructure
- **🤖 AI Agents** — Autonomous agents with web search, tool use, and multi-step reasoning
- **🔌 Plugin ecosystem** — Extensible integrations for any tool
- **📡 Real-time** — WebSocket-powered event streaming
- **🎯 DAG execution** — Parallel steps, retries, error handling
- **🖥️ CLI + Web UI** — Terminal power users and visual builders welcome
- **💬 Messaging** — Built-in WhatsApp, Telegram, and iMessage support

## 🚀 Quick Start

```bash
# Install
npm install -g weavr

# Setup
weavr onboard

# Start the gateway
weavr serve

# Create your first workflow
weavr create
```

## 📖 Example Workflows

### AI Research Agent

```yaml
name: daily-market-research
description: AI agent researches market data and sends a report

trigger:
  type: cron.schedule
  with:
    expression: "0 9 * * *"  # Every day at 9am

steps:
  - id: research
    action: ai.agent
    with:
      tools: "web_search,web_fetch"
      task: |
        Research current market conditions:
        - Gold and silver prices vs USD
        - Top investment opportunities
        - Key financial news from reliable sources
        Compile into an easy-to-read report.

  - id: notify
    action: whatsapp.send
    needs: [research]
    with:
      to: "+1234567890"
      text: "{{ steps.research.result }}"
```

### GitHub to Slack Notifications

```yaml
name: bug-to-slack
description: Notify Slack when GitHub issues are labeled 'bug'

trigger:
  type: github.issue.labeled
  with:
    label: bug

steps:
  - id: notify
    action: slack.post
    with:
      channel: "#bugs"
      message: "🐛 New bug: {{ trigger.issue.title }}\n{{ trigger.issue.html_url }}"
```

See more examples in the [examples/](./examples) directory.

## 🛠️ CLI Commands

```bash
# Setup & Diagnostics
weavr onboard          # Interactive setup wizard
weavr doctor           # Diagnose configuration issues

# Server
weavr serve            # Start gateway server
weavr serve --port 3847

# Workflows
weavr list             # List all workflows
weavr run <name>       # Run a workflow manually
weavr create           # Create new workflow (interactive)

# AI (coming soon)
weavr ask "When PR is merged, deploy to staging"
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Gateway Server                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  HTTP API   │  │  WebSocket  │  │  Webhook Receiver   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
      │   Engine    │ │   Plugins   │ │  AI Agent   │
      │ (DAG exec)  │ │  (GitHub,   │ │  (Natural   │
      │             │ │  Slack...)  │ │  language)  │
      └─────────────┘ └─────────────┘ └─────────────┘
```

## ⚙️ Configuration

### AI Provider
Configure your AI provider during onboarding or in Settings:
- **Anthropic** (Claude) - Recommended
- **OpenAI** (GPT-4)
- **Ollama** (Local models)

### Web Search (for AI Agents)
AI agents need a search API to browse the web. Get a free Brave Search API key:

1. Sign up at [brave.com/search/api](https://brave.com/search/api/)
2. Choose "Data for Search" plan (2,000 free queries/month)
3. Add your API key in Settings or set `BRAVE_API_KEY` environment variable

## 📁 Project Structure

```
~/.weavr/
├── config.yaml        # Global configuration
├── workflows/         # Your workflow definitions
├── plugins/           # Installed plugins
└── logs/              # Execution logs
```

## 🔌 Creating Plugins

```typescript
import { definePlugin, defineAction } from 'weavr/plugins';

export default definePlugin({
  name: 'my-plugin',
  version: '1.0.0',

  actions: [
    defineAction({
      name: 'greet',
      execute: async (ctx) => {
        const name = ctx.config.name as string;
        ctx.log(`Hello, ${name}!`);
        return { greeted: name };
      },
    }),
  ],
});
```

## 🤝 Contributing

We welcome contributions! AI-assisted PRs are explicitly encouraged.

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines.

## 📜 License

MIT © Weavr Contributors
