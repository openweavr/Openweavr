# Messaging Trigger Examples

These workflows demonstrate how to use messaging triggers with Weavr. All messaging triggers work without requiring public URLs - they connect directly to each platform.

## Available Triggers

| Trigger | Protocol | Environment Variables |
|---------|----------|----------------------|
| `slack.message` | Socket Mode (WebSocket) | `SLACK_APP_TOKEN`, `SLACK_TOKEN` |
| `telegram.message` | Long-polling | `TELEGRAM_BOT_TOKEN` |
| `discord.message` | Gateway (WebSocket) | `DISCORD_BOT_TOKEN` |
| `whatsapp.message` | Baileys (WebSocket) | QR code login |

## Setup Instructions

### Slack

1. Create a Slack App at https://api.slack.com/apps
2. Enable **Socket Mode** in Settings > Socket Mode
3. Generate an **App-Level Token** with `connections:write` scope
4. Add Bot Token Scopes: `channels:history`, `channels:read`, `chat:write`
5. Install the app to your workspace
6. Set environment variables:
   ```bash
   export SLACK_APP_TOKEN="xapp-..."  # App-level token
   export SLACK_TOKEN="xoxb-..."       # Bot token
   ```

### Telegram

1. Create a bot via [@BotFather](https://t.me/botfather)
2. Copy the bot token
3. Set environment variable:
   ```bash
   export TELEGRAM_BOT_TOKEN="123456789:ABC..."
   ```

### Discord

1. Create an application at https://discord.com/developers
2. Go to Bot section and create a bot
3. Enable **MESSAGE CONTENT INTENT** under Privileged Gateway Intents
4. Copy the bot token
5. Set environment variable:
   ```bash
   export DISCORD_BOT_TOKEN="..."
   ```

### WhatsApp

WhatsApp uses the Baileys library and requires QR code scanning:

1. Connect via the web UI Settings page
2. Scan the QR code with WhatsApp mobile app
3. Session is saved for auto-reconnect

## Workflows

### `slack-customer-request.yaml`
AI-powered customer request handler that:
- Triggers on messages in #customer-requests
- Analyzes the request using AI
- Replies in a thread with analysis and suggestions

### `slack-alert-investigation.yaml`
Multi-step alert investigation that:
- Triggers on messages containing [ALERT]
- Uses AI to gather context and analyze
- Posts root cause analysis in thread

### `telegram-ai-assistant.yaml`
Personal AI assistant bot that:
- Responds to private messages
- Uses AI to generate helpful responses

### `discord-support-bot.yaml`
Support channel bot that:
- Classifies incoming messages (bug, feature, question, etc.)
- Generates appropriate responses based on category

## Running Workflows

1. Start the server:
   ```bash
   node weavr.mjs serve
   ```

2. Deploy a workflow:
   ```bash
   curl -X POST http://localhost:3847/api/scheduler/slack-customer-request/deploy
   ```

3. Check messaging status:
   ```bash
   curl http://localhost:3847/api/messaging/status
   ```

## Trigger Configuration Options

### Slack Message Trigger
```yaml
trigger:
  type: slack.message
  with:
    channel: "#channel-name"  # Optional: filter by channel
    pattern: "regex"          # Optional: filter by text pattern
    ignoreBot: true           # Optional: ignore bot messages (default: true)
```

### Telegram Message Trigger
```yaml
trigger:
  type: telegram.message
  with:
    chatId: 123456789         # Optional: filter by chat ID
    chatType: private         # Optional: private, group, supergroup, channel
    pattern: "regex"          # Optional: filter by text pattern
```

### Discord Message Trigger
```yaml
trigger:
  type: discord.message
  with:
    channelId: "1234567890"   # Optional: filter by channel ID
    guildId: "1234567890"     # Optional: filter by server/guild ID
    pattern: "regex"          # Optional: filter by content pattern
    ignoreBot: true           # Optional: ignore bot messages (default: true)
```

## Trigger Data Available

All messaging triggers provide these fields in `{{ trigger.* }}`:

| Field | Description |
|-------|-------------|
| `trigger.type` | Trigger type (e.g., `slack.message`) |
| `trigger.text` | Message text content |
| `trigger.channel` / `trigger.channelId` | Channel identifier |
| `trigger.user` / `trigger.from` | Sender information |
| `trigger.timestamp` / `trigger.ts` | Message timestamp |
| `trigger.threadTs` / `trigger.replyTo` | Thread/reply reference |
