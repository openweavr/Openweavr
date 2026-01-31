import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';

function getApiKey(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string {
  const key = (ctx.config.apiKey as string) ?? ctx.env.NOTION_API_KEY ?? process.env.NOTION_API_KEY;
  if (!key) {
    throw new Error('Notion API key required. Set NOTION_API_KEY env or pass apiKey in config.');
  }
  return key;
}

async function notionApi(
  apiKey: string,
  method: string,
  endpoint: string,
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Notion API error: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

export default definePlugin({
  name: 'notion',
  version: '1.0.0',
  description: 'Notion integration for pages and databases',

  actions: [
    defineAction({
      name: 'create_page',
      description: 'Create a new Notion page',
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const parentId = ctx.config.parentId as string;
        const parentType = (ctx.config.parentType as string) ?? 'database_id';
        const title = ctx.config.title as string;
        const content = ctx.config.content as string | undefined;
        const properties = ctx.config.properties as Record<string, unknown> | undefined;

        ctx.log(`Creating Notion page: ${title}`);

        const parent: Record<string, string> = {};
        parent[parentType] = parentId;

        const pageData: Record<string, unknown> = { parent };

        if (parentType === 'database_id') {
          pageData.properties = properties ?? {
            title: { title: [{ text: { content: title } }] },
          };
        } else {
          pageData.properties = {
            title: { title: [{ text: { content: title } }] },
          };
        }

        if (content) {
          pageData.children = [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', text: { content } }],
              },
            },
          ];
        }

        return await notionApi(apiKey, 'POST', '/pages', pageData);
      },
    }),

    defineAction({
      name: 'update_page',
      description: 'Update a Notion page properties',
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const pageId = ctx.config.pageId as string;
        const properties = ctx.config.properties as Record<string, unknown>;

        ctx.log(`Updating Notion page: ${pageId}`);

        return await notionApi(apiKey, 'PATCH', `/pages/${pageId}`, { properties });
      },
    }),

    defineAction({
      name: 'get_page',
      description: 'Get a Notion page by ID',
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const pageId = ctx.config.pageId as string;

        return await notionApi(apiKey, 'GET', `/pages/${pageId}`);
      },
    }),

    defineAction({
      name: 'query_database',
      description: 'Query a Notion database',
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const databaseId = ctx.config.databaseId as string;
        const filter = ctx.config.filter as Record<string, unknown> | undefined;
        const sorts = ctx.config.sorts as Array<Record<string, unknown>> | undefined;
        const pageSize = (ctx.config.pageSize as number) ?? 100;

        ctx.log(`Querying Notion database: ${databaseId}`);

        const body: Record<string, unknown> = { page_size: pageSize };
        if (filter) body.filter = filter;
        if (sorts) body.sorts = sorts;

        return await notionApi(apiKey, 'POST', `/databases/${databaseId}/query`, body);
      },
    }),

    defineAction({
      name: 'append_block',
      description: 'Append content blocks to a page',
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const pageId = ctx.config.pageId as string;
        const content = ctx.config.content as string;
        const type = (ctx.config.type as string) ?? 'paragraph';

        ctx.log(`Appending to Notion page: ${pageId}`);

        const children = [
          {
            object: 'block',
            type,
            [type]: {
              rich_text: [{ type: 'text', text: { content } }],
            },
          },
        ];

        return await notionApi(apiKey, 'PATCH', `/blocks/${pageId}/children`, { children });
      },
    }),

    defineAction({
      name: 'search',
      description: 'Search Notion pages and databases',
      async execute(ctx) {
        const apiKey = getApiKey(ctx);
        const query = ctx.config.query as string;
        const filter = ctx.config.filter as { property: string; value: string } | undefined;

        ctx.log(`Searching Notion: ${query}`);

        const body: Record<string, unknown> = { query };
        if (filter) {
          body.filter = { property: filter.property, value: filter.value };
        }

        return await notionApi(apiKey, 'POST', '/search', body);
      },
    }),
  ],

  triggers: [
    defineTrigger({
      name: 'page.updated',
      description: 'Trigger when a Notion page is updated (via polling)',
      async setup(_config, _emit) {
        console.log('[notion] Page updated trigger registered');
        return () => {};
      },
    }),
  ],

  auth: {
    type: 'api_key',
    config: {
      name: 'NOTION_API_KEY',
    },
  },
});
