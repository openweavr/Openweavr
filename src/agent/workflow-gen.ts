import type { AIProvider, Message } from './providers/index.js';
import type { Workflow } from '../types/index.js';
import { WorkflowSchema } from '../types/index.js';
import { parse as parseYaml } from 'yaml';

const SYSTEM_PROMPT = `You are Weavr, an AI assistant that generates workflow automation definitions in YAML format.

You help users create workflows that connect their developer tools - GitHub, Slack, HTTP APIs, scheduled tasks, and more.

## Available Plugins and Actions

### http plugin
- http.request: Make HTTP requests (GET, POST, PUT, DELETE)
- http.get: Shorthand for GET requests
- http.post: Shorthand for POST requests
Triggers:
- http.webhook: Trigger on incoming webhook

### cron plugin
- cron.wait: Wait for a duration
Triggers:
- cron.schedule: Trigger on a cron schedule (e.g., "0 9 * * *" for 9am daily)

### github plugin
- github.create_issue: Create a GitHub issue
- github.create_comment: Add comment to issue/PR
- github.create_pr: Create a pull request
- github.get_issue: Get issue details
- github.add_labels: Add labels to issue/PR
- github.list_issues: List repository issues
Triggers:
- github.push: Trigger on push
- github.pull_request: Trigger on PR events
- github.issue.opened: Trigger when issue opened
- github.issue.labeled: Trigger when issue labeled

### slack plugin
- slack.post: Post message to channel
- slack.update: Update existing message
- slack.react: Add reaction to message
Triggers:
- slack.message: Trigger on new messages
- slack.slash_command: Trigger on slash command

### Built-in actions
- transform: Transform data using templates (use {{ variable }} syntax)
- log: Log a message
- delay: Wait for specified time
- condition: Evaluate a condition

## Workflow YAML Structure

\`\`\`yaml
name: workflow-name
description: What this workflow does

memory:
  - id: project-context
    description: Optional human-readable label
    sources:
      - id: docs
        type: file
        path: docs/overview.md
      - id: website
        type: url
        url: https://openweavr.ai
      - id: notes
        type: text
        text: "Static notes or instructions"
    template: |
      # Project Context
      {{ sources.docs }}

triggers:
  - type: plugin.trigger_name
    config:
      key: value

steps:
  - id: unique-step-id
    action: plugin.action_name
    config:
      key: value
    depends_on:
      - previous-step-id  # optional
    retry:
      attempts: 3
      delay: 1000
\`\`\`

## Template Variables

In step configs, you can use:
- {{ trigger.field }}: Access trigger data
- {{ steps.step_id }}: Access output from a previous step
- {{ env.VAR_NAME }}: Access environment variables
- {{ memory.blocks.block_id }}: Use assembled memory block content
- {{ memory.sources.block_id.source_id }}: Use specific memory source content

## Guidelines

1. Always use descriptive step IDs (kebab-case)
2. Add dependencies (depends_on) when steps need outputs from previous steps
3. Use meaningful workflow names and descriptions
4. Include error handling with retries for external API calls
5. Keep workflows focused on a single purpose

When the user describes what they want, respond ONLY with the YAML workflow definition. No explanations or markdown code fences - just the raw YAML.`;

export interface WorkflowGeneratorOptions {
  provider: AIProvider;
}

export class WorkflowGenerator {
  private provider: AIProvider;

  constructor(options: WorkflowGeneratorOptions) {
    this.provider = options.provider;
  }

  async generate(prompt: string): Promise<{ workflow: Workflow; yaml: string }> {
    const messages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    const result = await this.provider.complete({
      messages,
      temperature: 0.3, // Lower temperature for more consistent output
      maxTokens: 2048,
    });

    const yaml = this.extractYaml(result.content);
    const workflow = this.parseWorkflow(yaml);

    return { workflow, yaml };
  }

  async refine(
    currentYaml: string,
    feedback: string
  ): Promise<{ workflow: Workflow; yaml: string }> {
    const messages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Here's a workflow I have:\n\n${currentYaml}\n\nPlease modify it based on this feedback: ${feedback}`,
      },
    ];

    const result = await this.provider.complete({
      messages,
      temperature: 0.3,
      maxTokens: 2048,
    });

    const yaml = this.extractYaml(result.content);
    const workflow = this.parseWorkflow(yaml);

    return { workflow, yaml };
  }

  async explain(yaml: string): Promise<string> {
    const messages: Message[] = [
      {
        role: 'system',
        content:
          'You are Weavr, an AI assistant. Explain workflows in clear, concise terms. Focus on what the workflow does, when it triggers, and what each step accomplishes.',
      },
      {
        role: 'user',
        content: `Explain this workflow:\n\n${yaml}`,
      },
    ];

    const result = await this.provider.complete({
      messages,
      temperature: 0.5,
      maxTokens: 1024,
    });

    return result.content;
  }

  async debug(yaml: string, error: string): Promise<string> {
    const messages: Message[] = [
      {
        role: 'system',
        content:
          'You are Weavr, an AI debugging assistant. Help users fix workflow errors. Be specific about what went wrong and how to fix it. If you can provide a corrected YAML, do so.',
      },
      {
        role: 'user',
        content: `This workflow failed with an error:\n\nWorkflow:\n${yaml}\n\nError:\n${error}\n\nWhat went wrong and how do I fix it?`,
      },
    ];

    const result = await this.provider.complete({
      messages,
      temperature: 0.5,
      maxTokens: 1024,
    });

    return result.content;
  }

  private extractYaml(content: string): string {
    // Remove markdown code fences if present
    let yaml = content.trim();

    // Handle ```yaml ... ``` blocks
    const codeBlockMatch = yaml.match(/```(?:ya?ml)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      yaml = codeBlockMatch[1].trim();
    }

    return yaml;
  }

  private parseWorkflow(yaml: string): Workflow {
    try {
      const raw = parseYaml(yaml);
      return WorkflowSchema.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse generated workflow: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
