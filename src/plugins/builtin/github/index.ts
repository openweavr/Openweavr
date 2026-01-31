import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';

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
      async setup(config, _emit) {
        console.log(`[github] Push trigger registered for ${(config as { repo?: string }).repo ?? 'repo'}`);
        return () => {};
      },
    }),

    defineTrigger({
      name: 'pull_request',
      description: 'Trigger on pull request events',
      async setup(config, _emit) {
        console.log(`[github] PR trigger registered for ${(config as { repo?: string }).repo ?? 'repo'}`);
        return () => {};
      },
    }),

    defineTrigger({
      name: 'issue.opened',
      description: 'Trigger when issue is opened',
      async setup(_config, _emit) {
        console.log(`[github] Issue opened trigger registered`);
        return () => {};
      },
    }),

    defineTrigger({
      name: 'issue.labeled',
      description: 'Trigger when issue is labeled',
      async setup(_config, _emit) {
        console.log(`[github] Issue labeled trigger registered`);
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
