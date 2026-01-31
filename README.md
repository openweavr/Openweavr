# 🧵 Weavr

**Self-hosted workflow automation with AI agents.**

*Weave your dev life together.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 22+](https://img.shields.io/badge/node-22%2B-green.svg)](https://nodejs.org)

---

Weavr connects AI agents with your developer tools—GitHub, Linear, Notion, Slack, databases, CI/CD, and more. Think Zapier/n8n, but with native AI agent support and full data sovereignty.

## ✨ Features

- **🏠 Self-hosted** — Your workflows, your data, your infrastructure
- **🤖 AI-native** — Generate workflows with natural language
- **🔌 Plugin ecosystem** — Extensible integrations for any tool
- **📡 Real-time** — WebSocket-powered event streaming
- **🎯 DAG execution** — Parallel steps, retries, error handling
- **🖥️ CLI + Web UI** — Terminal power users and visual builders welcome

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

## 📖 Example Workflow

```yaml
name: bug-to-slack
description: Notify Slack when GitHub issues are labeled 'bug'

triggers:
  - type: github.issue.labeled
    config:
      label: bug

steps:
  - id: format-message
    action: transform
    config:
      template: |
        🐛 New bug: {{ trigger.issue.title }}
        {{ trigger.issue.html_url }}

  - id: notify-slack
    action: slack.post
    config:
      channel: "#bugs"
      message: "{{ steps.format-message.output }}"
```

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
