import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';

const PostMessageSchema = z.object({
  channel: z.string(),
  text: z.string().optional(),
  blocks: z.array(z.unknown()).optional(),
  thread_ts: z.string().optional(),
  unfurl_links: z.boolean().default(true),
  unfurl_media: z.boolean().default(true),
});

const UpdateMessageSchema = z.object({
  channel: z.string(),
  ts: z.string(),
  text: z.string().optional(),
  blocks: z.array(z.unknown()).optional(),
});

const ReactionSchema = z.object({
  channel: z.string(),
  timestamp: z.string(),
  name: z.string(),
});

function getToken(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string {
  const token = (ctx.config.token as string) ?? ctx.env.SLACK_TOKEN ?? process.env.SLACK_TOKEN;
  if (!token) {
    throw new Error('Slack token required. Set SLACK_TOKEN env or pass token in config.');
  }
  return token;
}

async function slackApi(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json() as { ok: boolean; error?: string };

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error ?? 'unknown'}`);
  }

  return { ok: true, data };
}

export default definePlugin({
  name: 'slack',
  version: '1.0.0',
  description: 'Slack integration for messaging and notifications',

  triggers: [
    defineTrigger({
      name: 'message',
      description: 'Trigger on new messages in a channel',
      async setup(config, _emit) {
        const channel = (config as { channel?: string }).channel;
        console.log(`[slack] Message trigger registered for ${channel ?? 'channel'}`);
        return () => {};
      },
    }),

    defineTrigger({
      name: 'slash_command',
      description: 'Trigger on slash command',
      async setup(config, _emit) {
        const command = (config as { command?: string }).command;
        console.log(`[slack] Slash command trigger registered: ${command ?? '/command'}`);
        return () => {};
      },
    }),

    defineTrigger({
      name: 'reaction_added',
      description: 'Trigger when a reaction is added',
      async setup(_config, _emit) {
        console.log(`[slack] Reaction trigger registered`);
        return () => {};
      },
    }),
  ],

  actions: [
    defineAction({
      name: 'post',
      description: 'Post a message to a Slack channel',
      schema: PostMessageSchema,
      async execute(ctx) {
        const token = getToken(ctx);
        const config = PostMessageSchema.parse(ctx.config);

        ctx.log(`Posting to ${config.channel}`);

        const { data } = await slackApi(token, 'chat.postMessage', {
          channel: config.channel,
          text: config.text,
          blocks: config.blocks,
          thread_ts: config.thread_ts,
          unfurl_links: config.unfurl_links,
          unfurl_media: config.unfurl_media,
        });

        return data;
      },
    }),

    defineAction({
      name: 'update',
      description: 'Update an existing message',
      schema: UpdateMessageSchema,
      async execute(ctx) {
        const token = getToken(ctx);
        const config = UpdateMessageSchema.parse(ctx.config);

        ctx.log(`Updating message in ${config.channel}`);

        const { data } = await slackApi(token, 'chat.update', {
          channel: config.channel,
          ts: config.ts,
          text: config.text,
          blocks: config.blocks,
        });

        return data;
      },
    }),

    defineAction({
      name: 'react',
      description: 'Add a reaction to a message',
      schema: ReactionSchema,
      async execute(ctx) {
        const token = getToken(ctx);
        const config = ReactionSchema.parse(ctx.config);

        ctx.log(`Adding :${config.name}: to message`);

        const { data } = await slackApi(token, 'reactions.add', {
          channel: config.channel,
          timestamp: config.timestamp,
          name: config.name,
        });

        return data;
      },
    }),

    defineAction({
      name: 'upload_file',
      description: 'Upload a file to Slack',
      async execute(ctx) {
        const token = getToken(ctx);
        const channels = ctx.config.channels as string;
        const content = ctx.config.content as string;
        const filename = (ctx.config.filename as string) ?? 'file.txt';
        const title = ctx.config.title as string | undefined;

        ctx.log(`Uploading file to ${channels}`);

        const { data } = await slackApi(token, 'files.upload', {
          channels,
          content,
          filename,
          title,
        });

        return data;
      },
    }),

    defineAction({
      name: 'set_topic',
      description: 'Set channel topic',
      async execute(ctx) {
        const token = getToken(ctx);
        const channel = ctx.config.channel as string;
        const topic = ctx.config.topic as string;

        ctx.log(`Setting topic for ${channel}`);

        const { data } = await slackApi(token, 'conversations.setTopic', {
          channel,
          topic,
        });

        return data;
      },
    }),

    defineAction({
      name: 'lookup_user',
      description: 'Look up user by email',
      async execute(ctx) {
        const token = getToken(ctx);
        const email = ctx.config.email as string;

        const { data } = await slackApi(token, 'users.lookupByEmail', { email });
        return data;
      },
    }),
  ],

  auth: {
    type: 'api_key',
    config: {
      name: 'SLACK_TOKEN',
      header: 'Authorization',
      prefix: 'Bearer ',
    },
  },
});
