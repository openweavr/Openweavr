import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const execFileAsync = promisify(execFile);

// State file for polling persistence
const STATE_FILE = join(homedir(), '.weavr', 'state', 'github-polling.json');

// Polling state
let pollingActive = false;
let pollingTimer: ReturnType<typeof setInterval> | null = null;
let repoState: Map<string, { lastEventId: string }> = new Map();

// GitHub Events API event structure
interface GitHubApiEvent {
  id: string;
  type: string;
  actor: { login: string };
  repo: { name: string };
  payload: Record<string, unknown>;
  created_at: string;
}

// Event handlers for polling mode
interface GitHubEventHandler {
  repo: string;
  triggerType: string;
  config: Record<string, unknown>;
  emit: (data: unknown) => void;
}
const eventHandlers: GitHubEventHandler[] = [];

// Polling state persistence
interface PollingState {
  repos: Record<string, { lastEventId: string }>;
  lastUpdated: string;
}

async function loadPollingState(): Promise<void> {
  try {
    const content = await readFile(STATE_FILE, 'utf-8');
    const state = JSON.parse(content) as PollingState;
    repoState = new Map(Object.entries(state.repos));
    console.log(`[github] Loaded polling state for ${repoState.size} repos`);
  } catch {
    // File doesn't exist or is invalid - start fresh
    repoState = new Map();
  }
}

async function savePollingState(): Promise<void> {
  const state: PollingState = {
    repos: Object.fromEntries(repoState),
    lastUpdated: new Date().toISOString(),
  };
  try {
    await mkdir(dirname(STATE_FILE), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[github] Failed to save polling state:', err);
  }
}

// Check if gh CLI is available
async function isGhAvailable(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

// Check if gh CLI is authenticated
async function isGhAuthenticated(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

// Fetch events for a repository using gh CLI
async function fetchRepoEvents(repo: string): Promise<GitHubApiEvent[]> {
  try {
    const { stdout } = await execFileAsync('gh', [
      'api',
      `repos/${repo}/events`,
      '--jq', '.[0:30]',  // Limit to 30 most recent
    ]);
    if (!stdout.trim()) return [];
    return JSON.parse(stdout);
  } catch (err) {
    const error = err as { stderr?: string };
    if (error.stderr?.includes('rate limit')) {
      console.warn(`[github] Rate limit hit for ${repo}, will retry next cycle`);
    } else {
      console.error(`[github] Failed to fetch events for ${repo}:`, err);
    }
    return [];
  }
}

// Map GitHub Events API event to trigger data format
function mapGitHubApiEvent(event: GitHubApiEvent): {
  triggerType: string;
  data: Record<string, unknown>;
} | null {
  const payload = event.payload;

  switch (event.type) {
    case 'PushEvent': {
      const ref = payload.ref as string;
      const branch = ref?.replace('refs/heads/', '') ?? '';
      const commits = (payload.commits as Array<{
        sha: string;
        message: string;
        author: { name: string; email: string };
        url: string;
      }>) ?? [];
      const head = payload.head as string;
      const before = payload.before as string;

      return {
        triggerType: 'github.push',
        data: {
          ref,
          branch,
          before,
          after: head,
          repository: event.repo.name,
          pusher: { name: event.actor.login },
          commits: commits.map(c => ({
            id: c.sha,
            message: c.message,
            author: c.author,
            url: c.url,
          })),
          headCommit: commits.length > 0 ? {
            id: commits[commits.length - 1].sha,
            message: commits[commits.length - 1].message,
            author: commits[commits.length - 1].author,
            url: commits[commits.length - 1].url,
          } : undefined,
        },
      };
    }

    case 'PullRequestEvent': {
      const pr = payload.pull_request as {
        id: number;
        number: number;
        title: string;
        body: string | null;
        state: string;
        html_url: string;
        head: { ref: string; sha: string };
        base: { ref: string; sha: string };
        user: { login: string };
      };
      const action = payload.action as string;

      return {
        triggerType: 'github.pull_request',
        data: {
          action,
          number: pr.number,
          pullRequest: {
            id: pr.id,
            number: pr.number,
            title: pr.title,
            body: pr.body,
            state: pr.state,
            url: pr.html_url,
            head: pr.head,
            base: pr.base,
            author: pr.user.login,
          },
          repository: event.repo.name,
        },
      };
    }

    case 'IssuesEvent': {
      const issue = payload.issue as {
        id: number;
        number: number;
        title: string;
        body: string | null;
        state: string;
        html_url: string;
        user: { login: string };
        labels: Array<{ name: string }>;
      };
      const action = payload.action as string;
      const label = payload.label as { name: string } | undefined;

      const baseTriggerData = {
        action,
        issue: {
          id: issue.id,
          number: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          url: issue.html_url,
          author: issue.user.login,
          labels: issue.labels.map(l => l.name),
        },
        repository: event.repo.name,
      };

      // Map action to specific trigger type
      if (action === 'opened') {
        return {
          triggerType: 'github.issue.opened',
          data: baseTriggerData,
        };
      } else if (action === 'labeled' && label) {
        return {
          triggerType: 'github.issue.labeled',
          data: { ...baseTriggerData, label: label.name },
        };
      } else {
        return {
          triggerType: 'github.issues',
          data: baseTriggerData,
        };
      }
    }

    default:
      return null;
  }
}

// Check if event matches handler filters
function matchesFilters(config: Record<string, unknown>, data: Record<string, unknown>): boolean {
  // Branch filter for push events
  if (config.branch && data.branch) {
    if (config.branch !== data.branch) return false;
  }

  // Action filter for PR/issue events
  if (config.events && Array.isArray(config.events) && data.action) {
    if (!config.events.includes(data.action)) return false;
  }

  // Label filter for issue.labeled events
  if (config.label && data.label) {
    if (config.label !== data.label) return false;
  }

  return true;
}

// Polling loop
async function pollLoop(): Promise<void> {
  // Get unique repos from handlers
  const repos = [...new Set(eventHandlers.map(h => h.repo))];

  for (const repo of repos) {
    const events = await fetchRepoEvents(repo);
    const state = repoState.get(repo) || { lastEventId: '' };

    // Filter to new events (id > lastEventId)
    const newEvents = events.filter(e => !state.lastEventId || e.id > state.lastEventId);

    // Process oldest first
    for (const event of newEvents.reverse()) {
      const mapped = mapGitHubApiEvent(event);
      if (!mapped) continue;

      // Notify matching handlers
      for (const handler of eventHandlers) {
        if (handler.repo !== repo) continue;
        if (handler.triggerType !== mapped.triggerType) continue;

        // Apply filters
        if (matchesFilters(handler.config, mapped.data)) {
          console.log(`[github] Emitting ${mapped.triggerType} for ${repo}`);
          handler.emit({ type: 'github', triggerType: mapped.triggerType, ...mapped.data });
        }
      }
    }

    // Update state with the newest event id
    if (events.length > 0) {
      repoState.set(repo, { lastEventId: events[0].id });
    }
  }

  // Save state after each poll cycle
  await savePollingState();
}

// Start polling for GitHub events
async function startGitHubPolling(intervalSeconds: number): Promise<void> {
  if (pollingActive) {
    console.log('[github] Polling already active');
    return;
  }

  // Load saved state
  await loadPollingState();

  pollingActive = true;
  console.log(`[github] Starting event polling (interval: ${intervalSeconds}s)`);

  // Initial poll
  await pollLoop();

  // Set up interval
  pollingTimer = setInterval(async () => {
    if (!pollingActive) return;
    try {
      await pollLoop();
    } catch (err) {
      console.error('[github] Poll loop error:', err);
    }
  }, intervalSeconds * 1000);
}

// Stop polling
function stopGitHubPolling(): void {
  if (!pollingActive) return;

  console.log('[github] Stopping event polling');
  pollingActive = false;

  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

// Check if we should stop polling (no handlers left)
function checkStopPolling(): void {
  if (eventHandlers.length === 0) {
    stopGitHubPolling();
  }
}

// GitHub webhook event types
export interface GitHubPushEvent {
  ref: string;
  before: string;
  after: string;
  repository: { full_name: string; name: string; owner: { login: string } };
  pusher: { name: string; email: string };
  commits: Array<{
    id: string;
    message: string;
    author: { name: string; email: string };
    url: string;
  }>;
  head_commit?: {
    id: string;
    message: string;
    author: { name: string; email: string };
    url: string;
  };
}

export interface GitHubPullRequestEvent {
  action: string; // opened, closed, synchronize, etc.
  number: number;
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    head: { ref: string; sha: string };
    base: { ref: string; sha: string };
    user: { login: string };
  };
  repository: { full_name: string; name: string };
}

export interface GitHubIssueEvent {
  action: string; // opened, closed, labeled, etc.
  issue: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    user: { login: string };
    labels: Array<{ name: string }>;
  };
  repository: { full_name: string; name: string };
  label?: { name: string }; // Present for labeled/unlabeled events
}

/**
 * Verify GitHub webhook signature
 * @param payload - Raw request body as string
 * @param signature - X-Hub-Signature-256 header value
 * @param secret - Webhook secret configured in GitHub
 */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

/**
 * Parse GitHub webhook event into trigger data
 * @param eventType - X-GitHub-Event header value
 * @param payload - Parsed JSON payload
 */
export function parseWebhookEvent(eventType: string, payload: unknown): {
  triggerType: string;
  data: Record<string, unknown>;
} | null {
  switch (eventType) {
    case 'push': {
      const event = payload as GitHubPushEvent;
      const branch = event.ref.replace('refs/heads/', '');
      return {
        triggerType: 'github.push',
        data: {
          ref: event.ref,
          branch,
          before: event.before,
          after: event.after,
          repository: event.repository.full_name,
          pusher: event.pusher,
          commits: event.commits,
          headCommit: event.head_commit,
        },
      };
    }

    case 'pull_request': {
      const event = payload as GitHubPullRequestEvent;
      return {
        triggerType: 'github.pull_request',
        data: {
          action: event.action,
          number: event.number,
          pullRequest: {
            id: event.pull_request.id,
            number: event.pull_request.number,
            title: event.pull_request.title,
            body: event.pull_request.body,
            state: event.pull_request.state,
            url: event.pull_request.html_url,
            head: event.pull_request.head,
            base: event.pull_request.base,
            author: event.pull_request.user.login,
          },
          repository: event.repository.full_name,
        },
      };
    }

    case 'issues': {
      const event = payload as GitHubIssueEvent;
      const baseTriggerData = {
        action: event.action,
        issue: {
          id: event.issue.id,
          number: event.issue.number,
          title: event.issue.title,
          body: event.issue.body,
          state: event.issue.state,
          url: event.issue.html_url,
          author: event.issue.user.login,
          labels: event.issue.labels.map(l => l.name),
        },
        repository: event.repository.full_name,
      };

      // Map action to specific trigger type
      if (event.action === 'opened') {
        return {
          triggerType: 'github.issue.opened',
          data: baseTriggerData,
        };
      } else if (event.action === 'labeled' && event.label) {
        return {
          triggerType: 'github.issue.labeled',
          data: { ...baseTriggerData, label: event.label.name },
        };
      } else {
        // Generic issues event
        return {
          triggerType: 'github.issues',
          data: baseTriggerData,
        };
      }
    }

    default:
      return null;
  }
}

const CreateIssueSchema = z.object({
  repo: z.string(),
  title: z.string(),
  body: z.string().optional(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
});

const CreateCommentSchema = z.object({
  repo: z.string(),
  issue_number: z.number(),
  body: z.string(),
});

const CreatePRSchema = z.object({
  repo: z.string(),
  title: z.string(),
  body: z.string().optional(),
  head: z.string(),
  base: z.string().default('main'),
  draft: z.boolean().default(false),
});

function getToken(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string {
  const token = (ctx.config.token as string) ?? ctx.env.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GitHub token required. Set GITHUB_TOKEN env or pass token in config.');
  }
  return token;
}

async function githubApi(
  token: string,
  method: string,
  endpoint: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${JSON.stringify(data)}`);
  }

  return { status: response.status, data };
}

export default definePlugin({
  name: 'github',
  version: '1.0.0',
  description: 'GitHub integration for issues, PRs, and webhooks',

  triggers: [
    defineTrigger({
      name: 'push',
      description: 'Trigger on push to repository',
      schema: z.object({
        repo: z.string().describe('Repository in owner/repo format'),
        branch: z.string().optional().describe('Branch to filter (default: all branches)'),
        mode: z.enum(['webhook', 'polling']).optional().default('polling').describe('Trigger mode (polling uses gh CLI, webhook requires public URL)'),
        pollInterval: z.number().optional().describe('Poll interval in seconds (default: 60)'),
      }),
      async setup(config, emit) {
        const typedConfig = config as { repo: string; branch?: string; mode?: 'webhook' | 'polling'; pollInterval?: number };
        const { repo, branch, mode = 'polling', pollInterval = 60 } = typedConfig;

        if (mode === 'polling') {
          // Check gh CLI
          if (!await isGhAvailable()) {
            console.warn('[github] gh CLI not found - install from https://cli.github.com');
            console.warn('[github] Push trigger will not receive events until gh is installed');
            return () => {};
          }
          if (!await isGhAuthenticated()) {
            console.warn('[github] gh CLI not authenticated - run: gh auth login');
            console.warn('[github] Push trigger will not receive events until authenticated');
            return () => {};
          }

          // Register handler
          const handler: GitHubEventHandler = {
            repo,
            triggerType: 'github.push',
            config: { branch },
            emit,
          };
          eventHandlers.push(handler);

          // Start polling if not active
          await startGitHubPolling(pollInterval);

          console.log(`[github] Push trigger active for ${repo}${branch ? ` (branch: ${branch})` : ''} [polling mode]`);

          return () => {
            const idx = eventHandlers.indexOf(handler);
            if (idx >= 0) eventHandlers.splice(idx, 1);
            checkStopPolling();
            console.log(`[github] Push trigger deactivated for ${repo}`);
          };
        }

        // Webhook mode (existing behavior)
        console.log(`[github] Push trigger registered for ${repo} [webhook mode]`);
        return () => {};
      },
    }),

    defineTrigger({
      name: 'pull_request',
      description: 'Trigger on pull request events',
      schema: z.object({
        repo: z.string().describe('Repository in owner/repo format'),
        events: z.array(z.string()).optional().describe('PR events to trigger on (opened, closed, synchronize, etc.)'),
        mode: z.enum(['webhook', 'polling']).optional().default('polling').describe('Trigger mode (polling uses gh CLI, webhook requires public URL)'),
        pollInterval: z.number().optional().describe('Poll interval in seconds (default: 60)'),
      }),
      async setup(config, emit) {
        const typedConfig = config as { repo: string; events?: string[]; mode?: 'webhook' | 'polling'; pollInterval?: number };
        const { repo, events, mode = 'polling', pollInterval = 60 } = typedConfig;

        if (mode === 'polling') {
          // Check gh CLI
          if (!await isGhAvailable()) {
            console.warn('[github] gh CLI not found - install from https://cli.github.com');
            console.warn('[github] PR trigger will not receive events until gh is installed');
            return () => {};
          }
          if (!await isGhAuthenticated()) {
            console.warn('[github] gh CLI not authenticated - run: gh auth login');
            console.warn('[github] PR trigger will not receive events until authenticated');
            return () => {};
          }

          // Register handler
          const handler: GitHubEventHandler = {
            repo,
            triggerType: 'github.pull_request',
            config: { events },
            emit,
          };
          eventHandlers.push(handler);

          // Start polling if not active
          await startGitHubPolling(pollInterval);

          console.log(`[github] PR trigger active for ${repo}${events ? ` (events: ${events.join(', ')})` : ''} [polling mode]`);

          return () => {
            const idx = eventHandlers.indexOf(handler);
            if (idx >= 0) eventHandlers.splice(idx, 1);
            checkStopPolling();
            console.log(`[github] PR trigger deactivated for ${repo}`);
          };
        }

        // Webhook mode (existing behavior)
        console.log(`[github] PR trigger registered for ${repo} [webhook mode]`);
        return () => {};
      },
    }),

    defineTrigger({
      name: 'issue.opened',
      description: 'Trigger when issue is opened',
      schema: z.object({
        repo: z.string().describe('Repository in owner/repo format'),
        mode: z.enum(['webhook', 'polling']).optional().default('polling').describe('Trigger mode (polling uses gh CLI, webhook requires public URL)'),
        pollInterval: z.number().optional().describe('Poll interval in seconds (default: 60)'),
      }),
      async setup(config, emit) {
        const typedConfig = config as { repo: string; mode?: 'webhook' | 'polling'; pollInterval?: number };
        const { repo, mode = 'polling', pollInterval = 60 } = typedConfig;

        if (mode === 'polling') {
          // Check gh CLI
          if (!await isGhAvailable()) {
            console.warn('[github] gh CLI not found - install from https://cli.github.com');
            console.warn('[github] Issue trigger will not receive events until gh is installed');
            return () => {};
          }
          if (!await isGhAuthenticated()) {
            console.warn('[github] gh CLI not authenticated - run: gh auth login');
            console.warn('[github] Issue trigger will not receive events until authenticated');
            return () => {};
          }

          // Register handler
          const handler: GitHubEventHandler = {
            repo,
            triggerType: 'github.issue.opened',
            config: {},
            emit,
          };
          eventHandlers.push(handler);

          // Start polling if not active
          await startGitHubPolling(pollInterval);

          console.log(`[github] Issue opened trigger active for ${repo} [polling mode]`);

          return () => {
            const idx = eventHandlers.indexOf(handler);
            if (idx >= 0) eventHandlers.splice(idx, 1);
            checkStopPolling();
            console.log(`[github] Issue opened trigger deactivated for ${repo}`);
          };
        }

        // Webhook mode (existing behavior)
        console.log(`[github] Issue opened trigger registered [webhook mode]`);
        return () => {};
      },
    }),

    defineTrigger({
      name: 'issue.labeled',
      description: 'Trigger when issue is labeled',
      schema: z.object({
        repo: z.string().describe('Repository in owner/repo format'),
        label: z.string().optional().describe('Specific label to filter on'),
        mode: z.enum(['webhook', 'polling']).optional().default('polling').describe('Trigger mode (polling uses gh CLI, webhook requires public URL)'),
        pollInterval: z.number().optional().describe('Poll interval in seconds (default: 60)'),
      }),
      async setup(config, emit) {
        const typedConfig = config as { repo: string; label?: string; mode?: 'webhook' | 'polling'; pollInterval?: number };
        const { repo, label, mode = 'polling', pollInterval = 60 } = typedConfig;

        if (mode === 'polling') {
          // Check gh CLI
          if (!await isGhAvailable()) {
            console.warn('[github] gh CLI not found - install from https://cli.github.com');
            console.warn('[github] Issue labeled trigger will not receive events until gh is installed');
            return () => {};
          }
          if (!await isGhAuthenticated()) {
            console.warn('[github] gh CLI not authenticated - run: gh auth login');
            console.warn('[github] Issue labeled trigger will not receive events until authenticated');
            return () => {};
          }

          // Register handler
          const handler: GitHubEventHandler = {
            repo,
            triggerType: 'github.issue.labeled',
            config: { label },
            emit,
          };
          eventHandlers.push(handler);

          // Start polling if not active
          await startGitHubPolling(pollInterval);

          console.log(`[github] Issue labeled trigger active for ${repo}${label ? ` (label: ${label})` : ''} [polling mode]`);

          return () => {
            const idx = eventHandlers.indexOf(handler);
            if (idx >= 0) eventHandlers.splice(idx, 1);
            checkStopPolling();
            console.log(`[github] Issue labeled trigger deactivated for ${repo}`);
          };
        }

        // Webhook mode (existing behavior)
        console.log(`[github] Issue labeled trigger registered [webhook mode]`);
        return () => {};
      },
    }),
  ],

  actions: [
    defineAction({
      name: 'create_issue',
      description: 'Create a GitHub issue',
      schema: CreateIssueSchema,
      async execute(ctx) {
        const token = getToken(ctx);
        const config = CreateIssueSchema.parse(ctx.config);

        ctx.log(`Creating issue in ${config.repo}: ${config.title}`);

        const { data } = await githubApi(token, 'POST', `/repos/${config.repo}/issues`, {
          title: config.title,
          body: config.body,
          labels: config.labels,
          assignees: config.assignees,
        });

        return data;
      },
    }),

    defineAction({
      name: 'create_comment',
      description: 'Add a comment to an issue or PR',
      schema: CreateCommentSchema,
      async execute(ctx) {
        const token = getToken(ctx);
        const config = CreateCommentSchema.parse(ctx.config);

        ctx.log(`Adding comment to ${config.repo}#${config.issue_number}`);

        const { data } = await githubApi(
          token,
          'POST',
          `/repos/${config.repo}/issues/${config.issue_number}/comments`,
          { body: config.body }
        );

        return data;
      },
    }),

    defineAction({
      name: 'create_pr',
      description: 'Create a pull request',
      schema: CreatePRSchema,
      async execute(ctx) {
        const token = getToken(ctx);
        const config = CreatePRSchema.parse(ctx.config);

        ctx.log(`Creating PR in ${config.repo}: ${config.title}`);

        const { data } = await githubApi(token, 'POST', `/repos/${config.repo}/pulls`, {
          title: config.title,
          body: config.body,
          head: config.head,
          base: config.base,
          draft: config.draft,
        });

        return data;
      },
    }),

    defineAction({
      name: 'get_issue',
      description: 'Get issue details',
      async execute(ctx) {
        const token = getToken(ctx);
        const repo = ctx.config.repo as string;
        const issueNumber = ctx.config.issue_number as number;

        const { data } = await githubApi(token, 'GET', `/repos/${repo}/issues/${issueNumber}`);
        return data;
      },
    }),

    defineAction({
      name: 'get_pr',
      description: 'Get pull request details',
      async execute(ctx) {
        const token = getToken(ctx);
        const repo = ctx.config.repo as string;
        const prNumber = ctx.config.pr_number as number;

        const { data } = await githubApi(token, 'GET', `/repos/${repo}/pulls/${prNumber}`);
        return data;
      },
    }),

    defineAction({
      name: 'add_labels',
      description: 'Add labels to an issue or PR',
      async execute(ctx) {
        const token = getToken(ctx);
        const repo = ctx.config.repo as string;
        const issueNumber = ctx.config.issue_number as number;
        const labels = ctx.config.labels as string[];

        ctx.log(`Adding labels to ${repo}#${issueNumber}: ${labels.join(', ')}`);

        const { data } = await githubApi(
          token,
          'POST',
          `/repos/${repo}/issues/${issueNumber}/labels`,
          { labels }
        );

        return data;
      },
    }),

    defineAction({
      name: 'list_issues',
      description: 'List repository issues',
      async execute(ctx) {
        const token = getToken(ctx);
        const repo = ctx.config.repo as string;
        const state = (ctx.config.state as string) ?? 'open';
        const labels = ctx.config.labels as string | undefined;

        let endpoint = `/repos/${repo}/issues?state=${state}`;
        if (labels) endpoint += `&labels=${encodeURIComponent(labels)}`;

        const { data } = await githubApi(token, 'GET', endpoint);
        return data;
      },
    }),
  ],

  auth: {
    type: 'api_key',
    config: {
      name: 'GITHUB_TOKEN',
      header: 'Authorization',
      prefix: 'Bearer ',
    },
  },
});
