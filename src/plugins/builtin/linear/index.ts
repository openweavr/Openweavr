import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';

const CreateIssueSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  teamId: z.string(),
  priority: z.number().min(0).max(4).optional(),
  labelIds: z.array(z.string()).optional(),
  assigneeId: z.string().optional(),
  stateId: z.string().optional(),
});

function getApiKey(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string {
  const key = (ctx.config.apiKey as string) ?? ctx.env.LINEAR_API_KEY ?? process.env.LINEAR_API_KEY;
  if (!key) {
    throw new Error('Linear API key required. Set LINEAR_API_KEY env or pass apiKey in config.');
  }
  return key;
}

async function linearGraphQL(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json() as { data?: unknown; errors?: Array<{ message: string }> };

  if (data.errors?.length) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  return data.data;
}

export default definePlugin({
  name: 'linear',
  version: '1.0.0',
  description: 'Linear project management integration',

  actions: [
    defineAction({
      name: 'create_issue',
      description: 'Create a Linear issue',
      schema: CreateIssueSchema,
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const config = CreateIssueSchema.parse(ctx.config);

        ctx.log(`Creating Linear issue: ${config.title}`);

        const query = `
          mutation CreateIssue($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue {
                id
                identifier
                title
                url
              }
            }
          }
        `;

        const result = await linearGraphQL(apiKey, query, {
          input: {
            title: config.title,
            description: config.description,
            teamId: config.teamId,
            priority: config.priority,
            labelIds: config.labelIds,
            assigneeId: config.assigneeId,
            stateId: config.stateId,
          },
        }) as { issueCreate: { issue: unknown } };

        return result.issueCreate.issue;
      },
    }),

    defineAction({
      name: 'update_issue',
      description: 'Update a Linear issue',
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const issueId = ctx.config.issueId as string;
        const title = ctx.config.title as string | undefined;
        const description = ctx.config.description as string | undefined;
        const stateId = ctx.config.stateId as string | undefined;
        const priority = ctx.config.priority as number | undefined;

        ctx.log(`Updating Linear issue: ${issueId}`);

        const query = `
          mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue {
                id
                identifier
                title
                url
              }
            }
          }
        `;

        const input: Record<string, unknown> = {};
        if (title) input.title = title;
        if (description) input.description = description;
        if (stateId) input.stateId = stateId;
        if (priority !== undefined) input.priority = priority;

        const result = await linearGraphQL(apiKey, query, {
          id: issueId,
          input,
        }) as { issueUpdate: { issue: unknown } };

        return result.issueUpdate.issue;
      },
    }),

    defineAction({
      name: 'add_comment',
      description: 'Add a comment to a Linear issue',
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const issueId = ctx.config.issueId as string;
        const body = ctx.config.body as string;

        ctx.log(`Adding comment to Linear issue: ${issueId}`);

        const query = `
          mutation CreateComment($input: CommentCreateInput!) {
            commentCreate(input: $input) {
              success
              comment {
                id
                body
              }
            }
          }
        `;

        const result = await linearGraphQL(apiKey, query, {
          input: { issueId, body },
        }) as { commentCreate: { comment: unknown } };

        return result.commentCreate.comment;
      },
    }),

    defineAction({
      name: 'get_issue',
      description: 'Get a Linear issue by ID or identifier',
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const id = ctx.config.id as string;

        const query = `
          query GetIssue($id: String!) {
            issue(id: $id) {
              id
              identifier
              title
              description
              priority
              state { name }
              assignee { name email }
              labels { nodes { name } }
              url
              createdAt
              updatedAt
            }
          }
        `;

        const result = await linearGraphQL(apiKey, query, { id }) as { issue: unknown };
        return result.issue;
      },
    }),

    defineAction({
      name: 'list_issues',
      description: 'List issues with optional filters',
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const teamId = ctx.config.teamId as string | undefined;
        const first = (ctx.config.limit as number) ?? 50;

        const query = `
          query ListIssues($filter: IssueFilter, $first: Int) {
            issues(filter: $filter, first: $first) {
              nodes {
                id
                identifier
                title
                priority
                state { name }
                assignee { name }
                url
              }
            }
          }
        `;

        const filter: Record<string, unknown> = {};
        if (teamId) filter.team = { id: { eq: teamId } };

        const result = await linearGraphQL(apiKey, query, { filter, first }) as { issues: { nodes: unknown[] } };
        return result.issues.nodes;
      },
    }),
  ],

  triggers: [
    defineTrigger({
      name: 'issue.created',
      description: 'Trigger when a Linear issue is created',
      async setup(_config, _emit) {
        console.log('[linear] Issue created trigger registered');
        return () => {};
      },
    }),

    defineTrigger({
      name: 'issue.updated',
      description: 'Trigger when a Linear issue is updated',
      async setup(_config, _emit) {
        console.log('[linear] Issue updated trigger registered');
        return () => {};
      },
    }),
  ],

  auth: {
    type: 'api_key',
    config: {
      name: 'LINEAR_API_KEY',
    },
  },
});
