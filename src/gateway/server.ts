import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, readdir, readFile, stat, access, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { GatewayClient, GatewayMessage, WeavrConfig, WorkflowRun } from '../types/index.js';
import { DEFAULT_CONFIG } from '../types/index.js';
import { WorkflowExecutor } from '../engine/executor.js';
import { parser } from '../engine/parser.js';
import { globalRegistry } from '../plugins/sdk/registry.js';
import { TriggerScheduler } from '../engine/scheduler.js';
import { initializePlugins, isPluginsInitialized } from '../plugins/loader.js';

export interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  broadcast(channel: string, message: GatewayMessage): void;
  getClients(): GatewayClient[];
}

export function createGatewayServer(config: WeavrConfig): GatewayServer {
  const app = new Hono();
  const clients = new Map<string, GatewayClient>();
  const runHistory: Array<{
    id: string;
    workflow: string;
    status: 'running' | 'success' | 'failed';
    startedAt: string;
    completedAt?: string;
    duration?: number;
    error?: string;
    logs: Array<{ timestamp: string; level: 'info' | 'error' | 'success'; stepId?: string; message: string }>;
    steps: Array<{ id: string; status: string; duration?: number; error?: string; output?: unknown }>;
  }> = [];

  // Helper to add log to run history
  const addRunLog = (runId: string, level: 'info' | 'error' | 'success', message: string, stepId?: string) => {
    const entry = runHistory.find(r => r.id === runId);
    if (entry) {
      entry.logs.push({
        timestamp: new Date().toISOString(),
        level,
        stepId,
        message,
      });
    }
  };

  let httpServer: ReturnType<typeof serve> | null = null;
  let wss: WebSocketServer | null = null;

  // Create workflow executor
  const executor = new WorkflowExecutor({
    registry: globalRegistry,
    onStepStart: (runId, stepId) => {
      addRunLog(runId, 'info', `Starting step: ${stepId}`, stepId);
      broadcast('runs', {
        type: 'step.started',
        payload: { runId, stepId },
      });
    },
    onLog: (runId, stepId, message) => {
      // Capture all logs from action execution (including tool calls)
      addRunLog(runId, 'info', message, stepId);
      // Also broadcast to connected clients in real-time
      broadcast('runs', {
        type: 'step.log',
        payload: { runId, stepId, message },
      });
    },
    onStepComplete: (runId, stepId, result) => {
      if (result.status === 'completed') {
        addRunLog(runId, 'success', `Step completed in ${result.duration}ms`, stepId);
        // Log output summary
        if (result.output) {
          const outputStr = typeof result.output === 'string'
            ? result.output.slice(0, 200)
            : JSON.stringify(result.output).slice(0, 200);
          addRunLog(runId, 'info', `Output: ${outputStr}${outputStr.length >= 200 ? '...' : ''}`, stepId);
        }
      } else if (result.status === 'failed') {
        addRunLog(runId, 'error', `Step failed: ${result.error}`, stepId);
      }
      broadcast('runs', {
        type: 'step.completed',
        payload: { runId, stepId, status: result.status, duration: result.duration, error: result.error },
      });
    },
    onRunComplete: (run) => {
      // Update run history
      const historyEntry = runHistory.find(r => r.id === run.id);
      if (historyEntry) {
        historyEntry.status = run.status === 'completed' ? 'success' : 'failed';
        historyEntry.completedAt = run.completedAt?.toISOString();
        historyEntry.duration = run.completedAt && run.startedAt
          ? run.completedAt.getTime() - run.startedAt.getTime()
          : undefined;
        historyEntry.error = run.error;
        historyEntry.steps = Array.from(run.steps.entries()).map(([id, step]) => ({
          id,
          status: step.status,
          duration: step.duration,
          error: step.error,
          output: step.output,
        }));

        // Add final log entry
        if (run.status === 'completed') {
          addRunLog(run.id, 'success', `Workflow completed successfully in ${historyEntry.duration}ms`);
        } else {
          addRunLog(run.id, 'error', `Workflow failed: ${run.error}`);
        }
      }
      broadcast('runs', {
        type: 'workflow.completed',
        payload: {
          runId: run.id,
          workflow: run.workflowName,
          status: run.status === 'completed' ? 'success' : 'failed',
          error: run.error,
        },
      });
    },
  });

  // Health check endpoint
  app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

  // Workflows directory
  const workflowsDir = config.workflowsDir ?? join(process.cwd(), 'workflows');

  // Ensure workflows directory exists
  mkdir(workflowsDir, { recursive: true }).catch(() => {});

  // Create trigger scheduler
  const scheduler = new TriggerScheduler(workflowsDir, globalRegistry, {
    onWorkflowTriggered: (workflowName, runId) => {
      // Create run history entry for scheduled runs
      const historyEntry = {
        id: runId,
        workflow: workflowName,
        status: 'running' as const,
        startedAt: new Date().toISOString(),
        logs: [{
          timestamp: new Date().toISOString(),
          level: 'info' as const,
          message: `Workflow triggered by scheduler: ${workflowName}`,
        }],
        steps: [] as Array<{ id: string; status: string; duration?: number; error?: string; output?: unknown }>,
      };
      runHistory.unshift(historyEntry);
      if (runHistory.length > 100) runHistory.pop();

      broadcast('runs', {
        type: 'workflow.started',
        payload: { runId, workflow: workflowName, trigger: 'scheduled' },
      });
    },
    onWorkflowCompleted: (workflowName, runId, status) => {
      broadcast('runs', {
        type: 'workflow.completed',
        payload: { runId, workflow: workflowName, status },
      });
    },
    // Use server's executor for proper history tracking
    onExecuteWorkflow: async (workflow, triggerData, runId) => {
      try {
        await executor.execute(workflow, triggerData, runId);
      } catch (err) {
        console.error(`[scheduler] Execution error for ${workflow.name}:`, err);
        // Ensure the history entry is updated even if something unexpected happens
        const entry = runHistory.find(r => r.id === runId);
        if (entry && entry.status === 'running') {
          entry.status = 'failed';
          entry.error = err instanceof Error ? err.message : String(err);
          entry.completedAt = new Date().toISOString();
          addRunLog(runId, 'error', `Unexpected error: ${entry.error}`);
        }
      }
    },
  });

  // Load and start all scheduled workflows
  scheduler.loadAndScheduleAll().catch(err => {
    console.error('[gateway] Failed to load scheduled workflows:', err);
  });

  // API routes
  app.get('/api/workflows', async (c) => {
    try {
      await mkdir(workflowsDir, { recursive: true });
      const files = await readdir(workflowsDir);
      const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

      // Get all scheduled workflows
      const scheduled = scheduler.getScheduledWorkflows();
      const scheduleMap = new Map(scheduled.map(s => [s.name, s]));

      const workflows = await Promise.all(yamlFiles.map(async (file) => {
        const content = await readFile(join(workflowsDir, file), 'utf-8');
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const descMatch = content.match(/^description:\s*(.+)$/m);
        const triggerMatches = content.match(/trigger:/g) ?? [];
        const stepMatches = content.match(/^\s+-\s+id:/gm) ?? [];
        const triggerTypeMatch = content.match(/trigger:\s*\n\s*type:\s*(.+)$/m);

        const workflowName = nameMatch?.[1]?.trim() ?? file.replace(/\.ya?ml$/, '');
        const schedule = scheduleMap.get(workflowName);

        return {
          name: workflowName,
          description: descMatch?.[1]?.trim(),
          triggerCount: triggerMatches.length,
          stepCount: stepMatches.length,
          triggerType: triggerTypeMatch?.[1]?.trim(),
          // Schedule info
          scheduled: !!schedule,
          scheduleStatus: schedule?.status ?? 'inactive',
          nextRun: schedule?.nextRun,
          lastRun: schedule?.lastRun,
          lastStatus: schedule?.lastStatus,
        };
      }));

      return c.json({ workflows });
    } catch {
      return c.json({ workflows: [] });
    }
  });

  app.get('/api/workflows/:name', async (c) => {
    const name = c.req.param('name');
    try {
      const filePath = join(workflowsDir, `${name}.yaml`);
      const content = await readFile(filePath, 'utf-8');
      return c.json({ name, content });
    } catch {
      return c.json({ name, content: null, error: 'Workflow not found' }, 404);
    }
  });

  // Delete workflow
  app.delete('/api/workflows/:name', async (c) => {
    const name = c.req.param('name');
    try {
      const filePath = join(workflowsDir, `${name}.yaml`);

      // Check if file exists
      await access(filePath);

      // Unschedule if scheduled
      scheduler.unscheduleWorkflow(name);

      // Delete the file
      await unlink(filePath);

      broadcast('workflows', {
        type: 'workflow.deleted',
        payload: { name },
      });

      return c.json({ success: true, name });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ error: 'Workflow not found' }, 404);
      }
      return c.json({ error: 'Failed to delete workflow' }, 500);
    }
  });

  // Save workflow
  app.post('/api/workflows', async (c) => {
    try {
      const body = await c.req.json();
      const { name, yaml } = body as { name?: string; yaml?: string };

      if (!name || !yaml) {
        return c.json({ error: 'Missing name or yaml' }, 400);
      }

      // Sanitize name for filename
      const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
      const filePath = join(workflowsDir, `${safeName}.yaml`);

      await mkdir(workflowsDir, { recursive: true });
      await writeFile(filePath, yaml, 'utf-8');

      // Reschedule if workflow was already scheduled
      const existingSchedule = scheduler.getWorkflowSchedule(safeName);
      if (existingSchedule) {
        console.log(`[scheduler] Rescheduling ${safeName} after edit...`);
        scheduler.unscheduleWorkflow(safeName);
        await scheduler.scheduleWorkflow(safeName, yaml);
      }

      broadcast('workflows', {
        type: 'workflow.saved',
        payload: { name: safeName, path: filePath },
      });

      return c.json({ success: true, name: safeName, path: filePath });
    } catch (err) {
      return c.json({ error: 'Failed to save workflow', details: String(err) }, 500);
    }
  });

  app.post('/api/workflows/:name/run', async (c) => {
    const name = c.req.param('name');
    const body = await c.req.json().catch(() => ({}));

    // Load workflow file
    const filePath = join(workflowsDir, `${name}.yaml`);
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return c.json({ error: `Workflow not found: ${name}` }, 404);
    }

    // Parse workflow
    let workflow;
    try {
      workflow = parser.parse(content);
    } catch (err) {
      return c.json({ error: `Invalid workflow: ${err instanceof Error ? err.message : String(err)}` }, 400);
    }

    // Create run history entry
    const runId = randomUUID();
    const historyEntry = {
      id: runId,
      workflow: name,
      status: 'running' as const,
      startedAt: new Date().toISOString(),
      logs: [{
        timestamp: new Date().toISOString(),
        level: 'info' as const,
        message: `Starting workflow: ${name}`,
      }],
      steps: [] as Array<{ id: string; status: string; duration?: number; error?: string; output?: unknown }>,
    };
    runHistory.unshift(historyEntry);

    // Keep only last 100 runs
    if (runHistory.length > 100) {
      runHistory.pop();
    }

    broadcast('runs', {
      type: 'workflow.started',
      payload: { runId, workflow: name, trigger: body },
    });

    // Execute workflow asynchronously
    executor.execute(workflow, body.data, runId).catch((err) => {
      console.error(`Workflow execution error: ${err}`);
      // Update history entry on error
      const entry = runHistory.find(r => r.id === runId);
      if (entry) {
        entry.status = 'failed';
        entry.error = err instanceof Error ? err.message : String(err);
        entry.completedAt = new Date().toISOString();
      }
    });

    return c.json({ runId, status: 'running', message: `Workflow "${name}" started` });
  });

  app.get('/api/runs', (c) => {
    return c.json({
      runs: runHistory.map(r => ({
        id: r.id,
        workflow: r.workflow,
        status: r.status,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        duration: r.duration,
      }))
    });
  });

  app.get('/api/runs/:id', (c) => {
    const id = c.req.param('id');
    const run = runHistory.find(r => r.id === id);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }
    return c.json(run);
  });

  // Scheduler management endpoints
  app.get('/api/scheduler', (c) => {
    const workflows = scheduler.getScheduledWorkflows();
    return c.json({
      workflows: workflows.map(w => ({
        name: w.name,
        triggerType: w.triggerType,
        triggerConfig: w.triggerConfig,
        status: w.status,
        nextRun: w.nextRun,
        lastRun: w.lastRun,
        lastStatus: w.lastStatus,
      })),
    });
  });

  app.post('/api/scheduler/:name/deploy', async (c) => {
    const name = c.req.param('name');
    try {
      const filePath = join(workflowsDir, `${name}.yaml`);
      const content = await readFile(filePath, 'utf-8');
      const result = await scheduler.scheduleWorkflow(name, content);

      if (result) {
        return c.json({
          success: true,
          scheduled: true,
          nextRun: result.nextRun,
          triggerType: result.triggerType,
        });
      } else {
        return c.json({ success: false, error: 'Workflow has no trigger' }, 400);
      }
    } catch (err) {
      return c.json({ success: false, error: `Failed to deploy: ${err}` }, 500);
    }
  });

  app.post('/api/scheduler/:name/undeploy', (c) => {
    const name = c.req.param('name');
    const result = scheduler.unscheduleWorkflow(name);
    return c.json({ success: result });
  });

  app.post('/api/scheduler/:name/pause', (c) => {
    const name = c.req.param('name');
    const result = scheduler.pauseWorkflow(name);
    return c.json({ success: result });
  });

  app.post('/api/scheduler/:name/resume', (c) => {
    const name = c.req.param('name');
    const result = scheduler.resumeWorkflow(name);
    const schedule = scheduler.getWorkflowSchedule(name);
    return c.json({ success: result, nextRun: schedule?.nextRun });
  });

  app.get('/api/plugins', (c) => {
    return c.json({ plugins: [] });
  });

  // Config management
  const weavrDir = join(homedir(), '.weavr');
  const configFile = join(weavrDir, 'config.yaml');

  app.get('/api/config', async (c) => {
    try {
      const content = await readFile(configFile, 'utf-8');
      const config = parseYaml(content) as WeavrConfig;
      // Don't send the actual API key, just indicate if one is set
      const safeConfig = {
        ...config,
        ai: config.ai ? {
          ...config.ai,
          apiKey: config.ai.apiKey ? '••••••••' : undefined,
          hasApiKey: Boolean(config.ai.apiKey),
        } : undefined,
      };
      return c.json({ config: safeConfig, exists: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ config: DEFAULT_CONFIG, exists: false });
      }
      return c.json({ error: 'Failed to load config' }, 500);
    }
  });

  app.post('/api/config', async (c) => {
    try {
      const body = await c.req.json();
      const { config: newConfig } = body as { config: Partial<WeavrConfig> & { ai?: { apiKey?: string } } };

      // Load existing config to preserve API key if not changed
      let existingConfig: WeavrConfig = DEFAULT_CONFIG;
      try {
        const content = await readFile(configFile, 'utf-8');
        existingConfig = parseYaml(content) as WeavrConfig;
      } catch {
        // No existing config
      }

      // Merge config, preserving API key if not provided or if it's the masked value
      const mergedConfig: WeavrConfig = {
        ...existingConfig,
        ...newConfig,
        server: { ...existingConfig.server, ...newConfig.server },
      };

      if (newConfig.ai) {
        mergedConfig.ai = {
          ...existingConfig.ai,
          ...newConfig.ai,
        };
        // Only update API key if a new one is provided (not masked)
        if (newConfig.ai.apiKey && newConfig.ai.apiKey !== '••••••••') {
          mergedConfig.ai.apiKey = newConfig.ai.apiKey;
        } else if (existingConfig.ai?.apiKey) {
          mergedConfig.ai.apiKey = existingConfig.ai.apiKey;
        }
      }

      // Ensure directories exist
      await mkdir(weavrDir, { recursive: true });
      await mkdir(join(weavrDir, 'workflows'), { recursive: true });
      await mkdir(join(weavrDir, 'plugins'), { recursive: true });
      await mkdir(join(weavrDir, 'logs'), { recursive: true });

      // Save config
      await writeFile(configFile, stringifyYaml(mergedConfig), 'utf-8');

      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: 'Failed to save config', details: String(err) }, 500);
    }
  });

  app.get('/api/config/status', async (c) => {
    try {
      await access(configFile);
      return c.json({ configured: true });
    } catch {
      return c.json({ configured: false });
    }
  });

  // AI workflow generation endpoint
  app.post('/api/ai/generate-workflow', async (c) => {
    try {
      const body = await c.req.json();
      const { prompt } = body as { prompt?: string };

      if (!prompt) {
        return c.json({ error: 'No prompt provided' }, 400);
      }

      // Load config to get AI settings
      let aiConfig: { provider?: string; model?: string; apiKey?: string } = {};
      try {
        const content = await readFile(configFile, 'utf-8');
        const config = parseYaml(content) as WeavrConfig;
        aiConfig = config.ai ?? {};
      } catch {
        return c.json({ error: 'AI not configured. Go to Settings to add your API key.' }, 400);
      }

      if (!aiConfig.apiKey && aiConfig.provider !== 'ollama') {
        return c.json({ error: 'No API key configured. Go to Settings to add your API key.' }, 400);
      }

      const systemPrompt = `You are a workflow automation expert for Weavr, a self-hosted automation platform. Generate valid YAML workflows based on user descriptions.

## TRIGGERS (use exactly one)

| Trigger | Description | Fields | Output |
|---------|-------------|--------|--------|
| cron.schedule | Run on schedule | expression (cron), timezone | - |
| http.webhook | HTTP endpoint | path, method | body, headers, query |
| github.push | Code pushed | repo, branch | commits, pusher, ref |
| github.pull_request | PR events | repo, events | action, pull_request |
| github.issue.opened | Issue created | repo | issue, repository |
| filesystem.watch | File changes | path, pattern | file, event |
| telegram.message | Telegram msg | - | message, chat, from |
| whatsapp.message | WhatsApp msg | - | text, from, messageId |

## ACTIONS

### HTTP
| Action | Description | Fields | Output |
|--------|-------------|--------|--------|
| http.get | Fetch URL | url, headers | status, data, ok |
| http.post | POST to URL | url, body, headers | status, data, ok |
| http.request | Custom request | url, method, body | status, data, headers, ok |

### AI (requires configured AI provider)
| Action | Description | Fields | Output |
|--------|-------------|--------|--------|
| ai.complete | Generate text | prompt, system, maxTokens | text, model, provider |
| ai.summarize | Summarize text | text, maxLength, style (concise/detailed/bullet-points) | summary |
| ai.classify | Classify text | text, categories | category, confidence |

### Messaging
| Action | Description | Fields | Output |
|--------|-------------|--------|--------|
| slack.post | Slack message | channel, text | ts, channel |
| discord.send | Discord webhook | webhook_url, content | id |
| telegram.send | Telegram msg | chatId, text, parseMode | messageId, sent |
| whatsapp.send | WhatsApp msg | to (phone), text | messageId, sent |
| imessage.send | iMessage (macOS) | to, text, service | sent |
| email.send | Send email | to, subject, body | messageId |

### GitHub
| Action | Description | Fields | Output |
|--------|-------------|--------|--------|
| github.create_issue | Create issue | repo, title, body, labels | number, url |
| github.create_comment | Add comment | repo, issue_number, body | id, url |

### Filesystem (local)
| Action | Description | Fields | Output |
|--------|-------------|--------|--------|
| filesystem.read | Read file | path, parse (auto/text/json/yaml) | content, data, size |
| filesystem.write | Write file | path, content, mode (write/append) | path, size, written |
| filesystem.list | List directory | path, pattern | files, count |
| filesystem.delete | Delete file | path | deleted |

### Shell (local)
| Action | Description | Fields | Output |
|--------|-------------|--------|--------|
| shell.exec | Run command | command, cwd, timeout | stdout, stderr, exitCode |
| shell.script | Run script | script, interpreter (bash/python3/node) | stdout, stderr, exitCode |

### Data
| Action | Description | Fields | Output |
|--------|-------------|--------|--------|
| json.parse | Parse JSON | input | data |
| json.get | Extract value | input, path | value |
| transform | Template | template | result |

### Local System
| Action | Description | Fields | Output |
|--------|-------------|--------|--------|
| notification.show | System notification | title, message, sound | shown |
| clipboard.read | Read clipboard | - | text |
| clipboard.write | Write clipboard | text | written |

## TEMPLATE SYNTAX

Reference previous step outputs: \`{{ steps.<step-id>.<field> }}\`
Reference trigger data: \`{{ trigger.<field> }}\`

IMPORTANT: Use the correct output field for each action:
- ai.summarize → \`{{ steps.summarize.summary }}\` (NOT .data)
- ai.complete → \`{{ steps.generate.text }}\`
- http.get → \`{{ steps.fetch.data }}\`
- filesystem.read → \`{{ steps.read.content }}\` or \`{{ steps.read.data }}\`
- shell.exec → \`{{ steps.run.stdout }}\`

## OUTPUT FORMAT

\`\`\`yaml
name: descriptive-workflow-name
description: Brief description of what this workflow does

trigger:
  type: <trigger-type>
  with:
    <field>: <value>

steps:
  - id: descriptive-step-name
    action: <action-type>
    with:
      <field>: <value>

  - id: next-step
    action: <action-type>
    needs: [descriptive-step-name]
    with:
      <field>: "{{ steps.descriptive-step-name.<output-field> }}"
\`\`\`

## RULES

1. Always include a trigger (cron.schedule for scheduled tasks, http.webhook for API triggers)
2. Use descriptive kebab-case step IDs (fetch-news, summarize-content, send-notification)
3. Use "needs" array to specify step dependencies
4. Use the CORRECT output field from the tables above (not generic .data)
5. Include a description field for the workflow
6. For cron expressions: minute hour day month weekday (e.g., "0 9 * * *" = 9 AM daily)
7. Wrap template expressions in quotes: "{{ steps.x.y }}"

## EXAMPLE

User: "Every morning at 9am, fetch top HN stories and send a summary to Slack"

\`\`\`yaml
name: hn-morning-digest
description: Daily Hacker News digest sent to Slack at 9 AM

trigger:
  type: cron.schedule
  with:
    expression: "0 9 * * *"
    timezone: "America/New_York"

steps:
  - id: fetch-stories
    action: http.get
    with:
      url: "https://hacker-news.firebaseio.com/v0/topstories.json"

  - id: summarize
    action: ai.summarize
    needs: [fetch-stories]
    with:
      text: "{{ steps.fetch-stories.data }}"
      maxLength: 300
      style: "bullet-points"

  - id: post-to-slack
    action: slack.post
    needs: [summarize]
    with:
      channel: "#news"
      text: "{{ steps.summarize.summary }}"
\`\`\`

Output ONLY the YAML code block, no additional text.`;

      let yamlContent = '';

      // Call AI provider
      if (aiConfig.provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: aiConfig.model ?? 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt },
            ],
            temperature: 0.7,
            max_tokens: 1500,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          return c.json({ error: `OpenAI API error: ${err.error?.message ?? response.statusText}` }, 500);
        }

        const data = await response.json();
        yamlContent = data.choices?.[0]?.message?.content ?? '';
      } else if (aiConfig.provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': aiConfig.apiKey!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: aiConfig.model ?? 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            system: systemPrompt,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          return c.json({ error: `Anthropic API error: ${err.error?.message ?? response.statusText}` }, 500);
        }

        const data = await response.json();
        yamlContent = data.content?.[0]?.text ?? '';
      } else if (aiConfig.provider === 'ollama') {
        const response = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: aiConfig.model ?? 'llama2',
            prompt: `${systemPrompt}\n\nUser request: ${prompt}`,
            stream: false,
          }),
        });

        if (!response.ok) {
          return c.json({ error: 'Ollama is not running or model not available' }, 500);
        }

        const data = await response.json();
        yamlContent = data.response ?? '';
      } else {
        return c.json({ error: `Unsupported AI provider: ${aiConfig.provider}` }, 400);
      }

      // Extract YAML from markdown code block if present
      const yamlMatch = yamlContent.match(/```ya?ml\n([\s\S]*?)```/);
      const yaml = yamlMatch ? yamlMatch[1].trim() : yamlContent.trim();

      if (!yaml) {
        return c.json({ error: 'Failed to generate valid workflow YAML' }, 500);
      }

      return c.json({ yaml });
    } catch (err) {
      console.error('AI generation error:', err);
      return c.json({ error: `Failed to generate workflow: ${String(err)}` }, 500);
    }
  });

  // Agentic AI Chat sessions storage
  const chatSessions = new Map<string, {
    id: string;
    messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolName?: string }>;
    createdAt: number;
    planReady: boolean;
  }>();

  // Cleanup old sessions (older than 1 hour)
  setInterval(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [id, session] of chatSessions) {
      if (session.createdAt < oneHourAgo) {
        chatSessions.delete(id);
      }
    }
  }, 5 * 60 * 1000);

  // Tool definitions for the agentic chat
  const chatTools = [
    {
      name: 'web_search',
      description: 'Search the web for information about APIs, services, or how to accomplish tasks',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'web_fetch',
      description: 'Fetch and read content from a URL (documentation, API specs, etc.)',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
        },
        required: ['url'],
      },
    },
    {
      name: 'list_actions',
      description: 'List all available workflow actions and triggers with their parameters',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional category to filter (e.g., "http", "ai", "slack")' },
        },
      },
    },
  ];

  // Execute a tool and return the result
  async function executeTool(toolName: string, input: Record<string, unknown>): Promise<string> {
    switch (toolName) {
      case 'web_search': {
        // Simple web search using DuckDuckGo instant answers
        const query = encodeURIComponent(String(input.query));
        try {
          const response = await fetch(`https://api.duckduckgo.com/?q=${query}&format=json&no_html=1`);
          const data = await response.json() as { Abstract?: string; RelatedTopics?: Array<{ Text?: string }> };
          const results: string[] = [];
          if (data.Abstract) results.push(`Summary: ${data.Abstract}`);
          if (data.RelatedTopics?.length) {
            results.push('Related topics:');
            for (const topic of data.RelatedTopics.slice(0, 5)) {
              if (topic.Text) results.push(`- ${topic.Text}`);
            }
          }
          return results.length > 0 ? results.join('\n') : 'No results found. Try a different query or use web_fetch with a specific URL.';
        } catch {
          return 'Search failed';
        }
      }

      case 'web_fetch': {
        try {
          const response = await fetch(String(input.url), {
            headers: { 'User-Agent': 'Weavr/1.0' },
          });
          if (!response.ok) {
            return `Failed to fetch: ${response.status} ${response.statusText}`;
          }
          const text = await response.text();
          // Limit response size
          return text.slice(0, 8000) + (text.length > 8000 ? '\n...(truncated)' : '');
        } catch (err) {
          return `Fetch failed: ${String(err)}`;
        }
      }

      case 'list_actions': {
        const category = input.category ? String(input.category).toLowerCase() : null;
        const actions = globalRegistry.listActions();
        const triggers = globalRegistry.listTriggers();

        let result = '## Available Actions\n\n';
        for (const { plugin, action } of actions) {
          const fullName = `${plugin}.${action.name}`;
          if (category && !fullName.toLowerCase().includes(category)) continue;
          result += `### ${fullName}\n`;
          result += `${action.description || 'No description'}\n`;
          result += '\n';
        }

        result += '## Available Triggers\n\n';
        for (const { plugin, trigger } of triggers) {
          const fullName = `${plugin}.${trigger.name}`;
          if (category && !fullName.toLowerCase().includes(category)) continue;
          result += `### ${fullName}\n`;
          result += `${trigger.description || 'No description'}\n`;
          result += '\n';
        }

        return result;
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  // Agentic chat endpoint with streaming
  app.post('/api/ai/chat', async (c) => {
    try {
      const body = await c.req.json();
      const { message, sessionId: existingSessionId } = body as { message?: string; sessionId?: string };

      if (!message) {
        return c.json({ error: 'No message provided' }, 400);
      }

      // Load config for AI settings
      let aiConfig: { provider?: string; model?: string; apiKey?: string } = {};
      try {
        const content = await readFile(configFile, 'utf-8');
        const config = parseYaml(content) as WeavrConfig;
        aiConfig = config.ai ?? {};
      } catch {
        return c.json({ error: 'AI not configured. Go to Settings to add your API key.' }, 400);
      }

      if (!aiConfig.apiKey && aiConfig.provider !== 'ollama') {
        return c.json({ error: 'No API key configured. Go to Settings to add your API key.' }, 400);
      }

      // Auto-detect provider from API key if not explicitly set
      if (!aiConfig.provider && aiConfig.apiKey) {
        // Anthropic keys typically start with 'sk-ant-'
        if (aiConfig.apiKey.startsWith('sk-ant-')) {
          aiConfig.provider = 'anthropic';
        } else {
          // Assume OpenAI for other keys
          aiConfig.provider = 'openai';
        }
      }

      // Get or create session
      let sessionId = existingSessionId;
      let session = sessionId ? chatSessions.get(sessionId) : null;

      if (!session) {
        sessionId = randomUUID();
        session = {
          id: sessionId,
          messages: [],
          createdAt: Date.now(),
          planReady: false,
        };
        chatSessions.set(sessionId, session);
      }

      // Add user message
      session.messages.push({ role: 'user', content: message });

      // Build system prompt for agentic workflow planning
      const systemPrompt = `You are an AI assistant that helps users plan and create workflow automations for Weavr.

Your role is to:
1. Understand what the user wants to automate
2. Research and gather information using tools when needed
3. Ask clarifying questions if the requirements are unclear
4. Create a detailed plan for the workflow
5. When the plan is complete and approved, you'll generate the final YAML

Available tools:
- web_search: Search the web for API documentation, service info, etc.
- web_fetch: Fetch content from URLs (documentation, examples)
- list_actions: List available Weavr actions and triggers

When you have a complete plan ready and the user approves it, respond with "[PLAN_READY]" at the end of your message.

Be conversational, helpful, and thorough. Ask questions when needed. Use tools to research APIs or services the user mentions.`;

      // Prepare messages for API
      const apiMessages = session.messages.map(m => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.role === 'tool' ? `[Tool Result: ${m.toolName}]\n${m.content}` : m.content,
      }));

      // Set up streaming response
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (data: unknown) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };

          // Send session ID
          send({ sessionId, type: 'session' });

          let fullResponse = '';
          let continueLoop = true;
          const maxIterations = 10;
          let iteration = 0;

          while (continueLoop && iteration < maxIterations) {
            iteration++;

            // Call AI with tools
            let response: Response;
            let responseData: Record<string, unknown>;

            if (aiConfig.provider === 'anthropic') {
              response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': aiConfig.apiKey!,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                  model: aiConfig.model ?? 'claude-sonnet-4-20250514',
                  max_tokens: 4096,
                  system: systemPrompt,
                  tools: chatTools,
                  messages: apiMessages,
                }),
              });

              if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                send({ type: 'error', error: `API error: ${(err as Record<string, Record<string, string>>).error?.message ?? response.statusText}` });
                controller.close();
                return;
              }

              responseData = await response.json() as Record<string, unknown>;
              const content = (responseData.content as Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }>) ?? [];

              for (const block of content) {
                if (block.type === 'text') {
                  fullResponse += block.text;
                  send({ type: 'delta', content: block.text });
                } else if (block.type === 'tool_use') {
                  // Tool call
                  send({ type: 'tool_start', toolName: block.name });

                  const toolResult = await executeTool(block.name!, block.input as Record<string, unknown>);

                  send({ type: 'tool_end', toolName: block.name, result: toolResult.slice(0, 200) + '...' });

                  // Add tool result to messages
                  session!.messages.push({ role: 'tool', content: toolResult, toolName: block.name });
                  apiMessages.push({
                    role: 'user',
                    content: `[Tool Result: ${block.name}]\n${toolResult}`,
                  });
                }
              }

              // Check if we need to continue (tool use or not)
              continueLoop = (responseData.stop_reason as string) === 'tool_use';

            } else if (aiConfig.provider === 'openai') {
              // OpenAI with function calling
              response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${aiConfig.apiKey}`,
                },
                body: JSON.stringify({
                  model: aiConfig.model ?? 'gpt-4o-mini',
                  max_tokens: 4096,
                  messages: [
                    { role: 'system', content: systemPrompt },
                    ...apiMessages,
                  ],
                  tools: chatTools.map(t => ({
                    type: 'function',
                    function: {
                      name: t.name,
                      description: t.description,
                      parameters: t.input_schema,
                    },
                  })),
                }),
              });

              if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                send({ type: 'error', error: `API error: ${(err as Record<string, Record<string, string>>).error?.message ?? response.statusText}` });
                controller.close();
                return;
              }

              responseData = await response.json() as Record<string, unknown>;
              const choice = (responseData.choices as Array<{ message: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> }; finish_reason: string }>)?.[0];

              if (choice?.message?.content) {
                fullResponse += choice.message.content;
                send({ type: 'delta', content: choice.message.content });
              }

              if (choice?.message?.tool_calls) {
                for (const toolCall of choice.message.tool_calls) {
                  const toolName = toolCall.function.name;
                  const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

                  send({ type: 'tool_start', toolName });

                  const toolResult = await executeTool(toolName, toolInput);

                  send({ type: 'tool_end', toolName, result: toolResult.slice(0, 200) + '...' });

                  session!.messages.push({ role: 'tool', content: toolResult, toolName });
                  apiMessages.push({
                    role: 'user',
                    content: `[Tool Result: ${toolName}]\n${toolResult}`,
                  });
                }
                continueLoop = true;
              } else {
                continueLoop = false;
              }

            } else {
              const providerName = aiConfig.provider || 'unknown';
              send({ type: 'error', error: `Provider "${providerName}" does not support tool use for agentic chat. Please use OpenAI or Anthropic.` });
              controller.close();
              return;
            }
          }

          // Save assistant response
          if (fullResponse) {
            session!.messages.push({ role: 'assistant', content: fullResponse });

            // Check if plan is ready
            if (fullResponse.includes('[PLAN_READY]')) {
              session!.planReady = true;
              send({ type: 'plan_ready' });
            }
          }

          send({ type: 'done' });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (err) {
      console.error('AI chat error:', err);
      return c.json({ error: `Chat error: ${String(err)}` }, 500);
    }
  });

  // Generate workflow from chat session
  app.post('/api/ai/chat/generate', async (c) => {
    try {
      const body = await c.req.json();
      const { sessionId } = body as { sessionId?: string };

      if (!sessionId) {
        return c.json({ error: 'No session ID provided' }, 400);
      }

      const session = chatSessions.get(sessionId);
      if (!session) {
        return c.json({ error: 'Session not found' }, 404);
      }

      // Load AI config
      let aiConfig: { provider?: string; model?: string; apiKey?: string } = {};
      try {
        const content = await readFile(configFile, 'utf-8');
        const config = parseYaml(content) as WeavrConfig;
        aiConfig = config.ai ?? {};
      } catch {
        return c.json({ error: 'AI not configured' }, 400);
      }

      // Build conversation context
      const conversationContext = session.messages
        .filter(m => m.role !== 'tool')
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

      // Use the same system prompt as the one-shot generation but with conversation context
      const systemPrompt = `You are a workflow automation expert for Weavr. Based on the conversation below, generate the final YAML workflow.

CONVERSATION:
${conversationContext}

Generate ONLY the YAML code block. Use the correct action IDs and output field references.

Output format:
\`\`\`yaml
name: workflow-name
description: Description

trigger:
  type: trigger-type
  with:
    field: value

steps:
  - id: step-name
    action: action-type
    with:
      field: value
\`\`\``;

      let yamlContent = '';

      if (aiConfig.provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': aiConfig.apiKey!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: aiConfig.model ?? 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            system: systemPrompt,
            messages: [{ role: 'user', content: 'Generate the final workflow YAML based on our conversation.' }],
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          return c.json({ error: `API error: ${(err as Record<string, Record<string, string>>).error?.message ?? response.statusText}` }, 500);
        }

        const data = await response.json() as { content?: Array<{ text?: string }> };
        yamlContent = data.content?.[0]?.text ?? '';
      } else if (aiConfig.provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: aiConfig.model ?? 'gpt-4o-mini',
            max_tokens: 2000,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: 'Generate the final workflow YAML based on our conversation.' },
            ],
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          return c.json({ error: `API error: ${(err as Record<string, Record<string, string>>).error?.message ?? response.statusText}` }, 500);
        }

        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        yamlContent = data.choices?.[0]?.message?.content ?? '';
      } else {
        return c.json({ error: 'Unsupported AI provider for workflow generation' }, 400);
      }

      // Extract YAML from markdown
      const yamlMatch = yamlContent.match(/```ya?ml\n([\s\S]*?)```/);
      const yaml = yamlMatch ? yamlMatch[1].trim() : yamlContent.trim();

      if (!yaml) {
        return c.json({ error: 'Failed to generate workflow YAML' }, 500);
      }

      // Clean up session
      chatSessions.delete(sessionId);

      return c.json({ yaml });
    } catch (err) {
      console.error('Workflow generation error:', err);
      return c.json({ error: `Generation error: ${String(err)}` }, 500);
    }
  });

  // WhatsApp messaging endpoints
  let whatsappBroadcast: ((channel: string, message: GatewayMessage) => void) | null = null;

  app.get('/api/messaging/whatsapp/status', async (c) => {
    const action = globalRegistry.getAction('whatsapp.status');
    if (!action) {
      return c.json({ connected: false, error: 'WhatsApp plugin not loaded' });
    }

    try {
      const result = await action.execute({
        workflowName: '_settings',
        runId: '_settings',
        stepId: '_settings',
        config: {},
        steps: {},
        env: {},
        log: () => {},
      });
      return c.json(result);
    } catch (err) {
      return c.json({ connected: false, error: String(err) });
    }
  });

  app.post('/api/messaging/whatsapp/connect', async (c) => {
    const action = globalRegistry.getAction('whatsapp.connect');
    if (!action) {
      return c.json({ error: 'WhatsApp plugin not loaded' }, 400);
    }

    // Store broadcast function for WhatsApp to use
    whatsappBroadcast = broadcast;

    // Start connection asynchronously
    action.execute({
      workflowName: '_settings',
      runId: '_settings',
      stepId: '_settings',
      config: { _broadcast: broadcast },
      steps: {},
      env: {},
      log: (msg) => console.log(`[whatsapp] ${msg}`),
    }).catch(err => {
      console.error('[whatsapp] Connection error:', err);
    });

    return c.json({ status: 'connecting' });
  });

  app.post('/api/messaging/whatsapp/disconnect', async (c) => {
    const action = globalRegistry.getAction('whatsapp.disconnect');
    if (!action) {
      return c.json({ error: 'WhatsApp plugin not loaded' }, 400);
    }

    try {
      const result = await action.execute({
        workflowName: '_settings',
        runId: '_settings',
        stepId: '_settings',
        config: {},
        steps: {},
        env: {},
        log: () => {},
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // Webhook receiver - triggers scheduled workflows
  app.post('/webhook/:source', async (c) => {
    const source = c.req.param('source');
    const body = await c.req.json().catch(() => ({}));
    const headers = Object.fromEntries(c.req.raw.headers);

    broadcast('webhooks', {
      type: 'webhook.received',
      payload: { source, body, headers },
    });

    // Trigger any workflows listening for this webhook
    const { triggered, runIds } = await scheduler.triggerWebhook(source, { body, headers });

    return c.json({
      received: true,
      triggered,
      runIds,
    });
  });

  // Serve static web UI
  // Determine the web directory based on where we're running from
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const isDevMode = __dirname.includes('/src/');
  let webDir: string;

  if (isDevMode) {
    // Running from src via tsx - web files are in dist/web
    webDir = join(__dirname, '..', '..', 'dist', 'web');
  } else if (__dirname.endsWith('/dist')) {
    // Bundled code where __dirname is the dist folder
    webDir = join(__dirname, 'web');
  } else {
    // Bundled code where __dirname is dist/cli or similar
    webDir = join(__dirname, '..', 'web');
  }

  console.log(`[server] Static files: webDir=${webDir}`);

  // Serve static assets
  app.use('/assets/*', serveStatic({ root: webDir }));

  // Serve index.html for all non-API routes (SPA fallback)
  app.get('*', async (c) => {
    const path = c.req.path;

    // Skip API and health routes
    if (path.startsWith('/api') || path.startsWith('/webhook') || path === '/health') {
      return c.notFound();
    }

    try {
      const indexPath = join(webDir, 'index.html');
      const html = await readFile(indexPath, 'utf-8');
      return c.html(html);
    } catch {
      return c.text('Web UI not found. Run: npm run build:web', 404);
    }
  });

  function broadcast(channel: string, message: GatewayMessage): void {
    const fullMessage: GatewayMessage = {
      ...message,
      id: message.id ?? randomUUID(),
      timestamp: message.timestamp ?? Date.now(),
    };

    const data = JSON.stringify(fullMessage);

    for (const client of clients.values()) {
      if (client.subscriptions.has(channel) || client.subscriptions.has('*')) {
        const socket = client.socket as WebSocket;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      }
    }
  }

  // Send current service status to a client
  async function sendServiceStatus(socket: WebSocket): Promise<void> {
    try {
      // Check if plugins are initialized
      const pluginsReady = isPluginsInitialized();

      // Get WhatsApp status
      let whatsappStatus = 'unknown';
      try {
        const whatsappAction = globalRegistry.getAction('whatsapp.status');
        if (whatsappAction) {
          const result = await whatsappAction.execute({
            workflowName: '_system',
            runId: '_status_check',
            stepId: '_status',
            config: {},
            steps: {},
            env: {},
            log: () => {},
          });
          whatsappStatus = (result as { connected?: boolean })?.connected ? 'connected' : 'disconnected';
        }
      } catch {
        whatsappStatus = 'unavailable';
      }

      // Send status to client
      socket.send(JSON.stringify({
        type: 'services:status',
        payload: {
          pluginsInitialized: pluginsReady,
          services: {
            whatsapp: whatsappStatus,
          },
        },
        timestamp: Date.now(),
      }));
    } catch (err) {
      console.error('[gateway] Error sending service status:', err);
    }
  }

  function handleConnection(socket: WebSocket): void {
    const clientId = randomUUID();
    const client: GatewayClient = {
      id: clientId,
      socket,
      subscriptions: new Set(['*']),
    };

    clients.set(clientId, client);

    socket.send(JSON.stringify({
      type: 'connected',
      payload: { clientId },
      timestamp: Date.now(),
    }));

    // Send current service status to the newly connected client
    sendServiceStatus(socket);

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as GatewayMessage;
        handleMessage(client, message);
      } catch {
        socket.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid JSON' },
        }));
      }
    });

    socket.on('close', () => {
      clients.delete(clientId);
    });

    socket.on('error', (err) => {
      console.error(`WebSocket error for client ${clientId}:`, err.message);
      clients.delete(clientId);
    });
  }

  function handleMessage(client: GatewayClient, message: GatewayMessage): void {
    const socket = client.socket as WebSocket;

    switch (message.type) {
      case 'subscribe': {
        const channels = (message.payload as { channels?: string[] })?.channels ?? [];
        for (const channel of channels) {
          client.subscriptions.add(channel);
        }
        socket.send(JSON.stringify({
          type: 'subscribed',
          payload: { channels: Array.from(client.subscriptions) },
        }));
        break;
      }

      case 'unsubscribe': {
        const channels = (message.payload as { channels?: string[] })?.channels ?? [];
        for (const channel of channels) {
          client.subscriptions.delete(channel);
        }
        socket.send(JSON.stringify({
          type: 'unsubscribed',
          payload: { channels: Array.from(client.subscriptions) },
        }));
        break;
      }

      case 'ping': {
        socket.send(JSON.stringify({
          type: 'pong',
          payload: {},
          timestamp: Date.now(),
        }));
        break;
      }

      default: {
        socket.send(JSON.stringify({
          type: 'error',
          payload: { message: `Unknown message type: ${message.type}` },
        }));
      }
    }
  }

  return {
    async start() {
      const { port, host } = config.server;

      httpServer = serve({
        fetch: app.fetch,
        port,
        hostname: host,
      });

      const address = httpServer.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;

      wss = new WebSocketServer({ server: httpServer as Server });
      wss.on('connection', handleConnection);

      console.log(`Gateway server running at http://${host}:${actualPort}`);
      console.log(`WebSocket available at ws://${host}:${actualPort}`);

      // Initialize all plugins now that broadcast is available
      // This will auto-connect services like WhatsApp if they have saved credentials
      try {
        await initializePlugins(broadcast);
      } catch (err) {
        console.error('[gateway] Plugin initialization failed:', err);
      }
    },

    async stop() {
      for (const client of clients.values()) {
        const socket = client.socket as WebSocket;
        socket.close();
      }
      clients.clear();

      wss?.close();
      httpServer?.close();
    },

    broadcast,

    getClients() {
      return Array.from(clients.values());
    },
  };
}
