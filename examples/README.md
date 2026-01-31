# Weavr Example Workflows

A collection of ready-to-use workflow examples. Copy any of these to your `~/.weavr/workflows/` directory.

## Quick Start Examples

### Hello World
Simple workflow to test your setup.
```yaml
name: hello-world
description: A simple test workflow

steps:
  - id: greet
    action: log
    config:
      message: "Hello from Weavr! 🧵"
```

---

## GitHub Automation

### [Bug to Slack](./github/bug-to-slack.yaml)
Notify your team when issues are labeled as bugs.

### [PR Review Reminder](./github/pr-review-reminder.yaml)
Daily reminder for open pull requests needing review.

### [Auto-label Issues](./github/auto-label-issues.yaml)
Automatically label issues based on content.

---

## Notifications

### [Daily Standup Reminder](./notifications/daily-standup.yaml)
Morning reminder for team standups.

### [Deploy Notification](./notifications/deploy-notify.yaml)
Notify Slack when deployments happen.

---

## Data Pipelines

### [API Health Check](./data/api-health-check.yaml)
Periodic health checks for your APIs.

### [Data Sync](./data/sync-webhook.yaml)
Sync data between services on webhook.

---

## Contributing Examples

Have a useful workflow? We'd love to include it!

1. Create your workflow YAML
2. Test it with `weavr run <name>`
3. Submit a PR adding it to `examples/`

Include:
- Clear `name` and `description`
- Comments explaining complex steps
- Any required environment variables
