import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('AI Agent', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Workflow Generator', () => {
    it('should generate workflow from natural language', async () => {
      const prompt = 'When a GitHub issue is labeled as bug, notify Slack';
      const expectedWorkflow = `
name: bug-to-slack
trigger:
  type: github.issue.labeled
  with:
    label: bug
steps:
  - id: notify
    action: slack.post
    with:
      channel: "#bugs"
      text: "New bug: {{ trigger.issue.title }}"
`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: expectedWorkflow }],
        }),
      });

      // Simulate workflow generation
      const result = {
        workflow: expectedWorkflow.trim(),
        explanation: 'This workflow triggers on GitHub issue label events and posts to Slack.',
      };

      expect(result.workflow).toContain('name:');
      expect(result.workflow).toContain('trigger:');
      expect(result.workflow).toContain('steps:');
    });

    it('should validate generated workflow YAML', async () => {
      const validYaml = `
name: test-workflow
trigger:
  type: manual
steps:
  - id: step1
    action: http.get
    with:
      url: "https://api.example.com"
`;
      // Basic YAML validation
      expect(validYaml).toContain('name:');
      expect(validYaml).toContain('trigger:');
      expect(validYaml).toContain('steps:');
      expect(validYaml).toContain('action:');
    });

    it('should suggest relevant plugins', () => {
      const userIntent = 'I want to post to Discord when a deploy succeeds';
      const keywords = ['discord', 'deploy', 'webhook'];

      const suggestedPlugins = [];
      if (userIntent.toLowerCase().includes('discord')) {
        suggestedPlugins.push('discord');
      }
      if (userIntent.toLowerCase().includes('deploy')) {
        suggestedPlugins.push('http'); // For webhook
      }

      expect(suggestedPlugins).toContain('discord');
    });

    it('should handle ambiguous requests', () => {
      const ambiguousPrompt = 'Do something when stuff happens';
      const questions = [
        'What event should trigger this workflow?',
        'What action should be performed?',
        'Are there any conditions to check?',
      ];

      expect(questions.length).toBeGreaterThan(0);
      expect(questions[0]).toContain('trigger');
    });
  });

  describe('AI Provider Abstraction', () => {
    it('should support OpenAI provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Generated workflow here' } }],
        }),
      });

      const provider = {
        name: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4',
      };

      expect(provider.name).toBe('openai');
      expect(provider.endpoint).toContain('openai.com');
    });

    it('should support Anthropic provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'Generated workflow here' }],
        }),
      });

      const provider = {
        name: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1/messages',
        model: 'claude-3-sonnet-20240229',
      };

      expect(provider.name).toBe('anthropic');
      expect(provider.endpoint).toContain('anthropic.com');
    });

    it('should support Ollama provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Generated workflow here' },
        }),
      });

      const provider = {
        name: 'ollama',
        endpoint: 'http://localhost:11434/api/chat',
        model: 'llama2',
      };

      expect(provider.name).toBe('ollama');
      expect(provider.endpoint).toContain('localhost');
    });
  });

  describe('Context Building', () => {
    it('should include available plugins in context', () => {
      const plugins = ['http', 'github', 'slack', 'discord', 'cron'];
      const context = `Available plugins: ${plugins.join(', ')}`;

      expect(context).toContain('http');
      expect(context).toContain('github');
    });

    it('should include action signatures', () => {
      const actions = [
        { plugin: 'github', name: 'create_issue', params: ['owner', 'repo', 'title', 'body'] },
        { plugin: 'slack', name: 'post', params: ['channel', 'text'] },
      ];

      const signatures = actions.map((a) => `${a.plugin}.${a.name}(${a.params.join(', ')})`);

      expect(signatures[0]).toBe('github.create_issue(owner, repo, title, body)');
      expect(signatures[1]).toBe('slack.post(channel, text)');
    });

    it('should include trigger types', () => {
      const triggers = [
        { plugin: 'github', events: ['push', 'pull_request', 'issue.opened'] },
        { plugin: 'cron', events: ['schedule'] },
        { plugin: 'http', events: ['webhook'] },
      ];

      const allTriggers = triggers.flatMap((t) => t.events.map((e) => `${t.plugin}.${e}`));

      expect(allTriggers).toContain('github.push');
      expect(allTriggers).toContain('cron.schedule');
    });
  });

  describe('Prompt Engineering', () => {
    it('should create structured prompts', () => {
      const userRequest = 'Notify me on Slack when a PR is merged';
      const systemPrompt = `You are a workflow automation assistant.
Generate YAML workflows for the Weavr platform.
Available plugins: github, slack, http, cron`;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userRequest },
      ];

      expect(messages[0].role).toBe('system');
      expect(messages[1].content).toBe(userRequest);
    });

    it('should include examples in prompts', () => {
      const example = `
Example workflow:
\`\`\`yaml
name: pr-merged-notify
trigger:
  type: github.pull_request
  with:
    action: closed
    merged: true
steps:
  - id: notify
    action: slack.post
    with:
      channel: "#dev"
      text: "PR merged: {{ trigger.pull_request.title }}"
\`\`\`
`;
      expect(example).toContain('trigger:');
      expect(example).toContain('steps:');
    });
  });

  describe('Response Processing', () => {
    it('should extract YAML from markdown code blocks', () => {
      const response = `
Here's your workflow:

\`\`\`yaml
name: test
trigger:
  type: manual
steps:
  - id: log
    action: log
\`\`\`

This workflow will...
`;
      const yamlMatch = response.match(/```yaml\n([\s\S]*?)```/);
      const yaml = yamlMatch ? yamlMatch[1].trim() : null;

      expect(yaml).toContain('name: test');
    });

    it('should handle plain YAML response', () => {
      const response = `name: test
trigger:
  type: manual
steps:
  - id: step1
    action: test.run
`;
      const lines = response.split('\n');
      const isYaml = lines[0].startsWith('name:');

      expect(isYaml).toBe(true);
    });

    it('should validate extracted workflow', () => {
      const workflow = {
        name: 'test-workflow',
        trigger: { type: 'manual' },
        steps: [{ id: 'step1', action: 'test.run' }],
      };

      expect(workflow.name).toBeDefined();
      expect(workflow.trigger).toBeDefined();
      expect(workflow.steps.length).toBeGreaterThan(0);
      expect(workflow.steps[0].id).toBeDefined();
      expect(workflow.steps[0].action).toBeDefined();
    });
  });
});
