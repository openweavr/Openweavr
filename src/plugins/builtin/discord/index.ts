import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';

const SendMessageSchema = z.object({
  webhookUrl: z.string().url().optional(),
  content: z.string().optional(),
  username: z.string().optional(),
  avatar_url: z.string().url().optional(),
  embeds: z.array(z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    color: z.number().optional(),
    url: z.string().url().optional(),
    fields: z.array(z.object({
      name: z.string(),
      value: z.string(),
      inline: z.boolean().optional(),
    })).optional(),
    footer: z.object({
      text: z.string(),
      icon_url: z.string().optional(),
    }).optional(),
    timestamp: z.string().optional(),
  })).optional(),
});

function getWebhookUrl(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string {
  const url = (ctx.config.webhookUrl as string) ?? ctx.env.DISCORD_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    throw new Error('Discord webhook URL required. Set DISCORD_WEBHOOK_URL env or pass webhookUrl in config.');
  }
  return url;
}

export default definePlugin({
  name: 'discord',
  version: '1.0.0',
  description: 'Discord integration via webhooks',

  actions: [
    defineAction({
      name: 'send',
      description: 'Send a message to Discord via webhook',
      schema: SendMessageSchema,
      async execute(ctx) {
        const webhookUrl = getWebhookUrl(ctx);
        const config = SendMessageSchema.parse(ctx.config);

        ctx.log(`Sending Discord message`);

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: config.content,
            username: config.username,
            avatar_url: config.avatar_url,
            embeds: config.embeds,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Discord API error: ${response.status} ${error}`);
        }

        return { success: true, status: response.status };
      },
    }),

    defineAction({
      name: 'embed',
      description: 'Send a rich embed message to Discord',
      async execute(ctx) {
        const webhookUrl = getWebhookUrl(ctx);
        const title = ctx.config.title as string;
        const description = ctx.config.description as string;
        const color = (ctx.config.color as number) ?? 0x5865F2; // Discord blurple
        const fields = ctx.config.fields as Array<{ name: string; value: string; inline?: boolean }> | undefined;
        const footer = ctx.config.footer as string | undefined;
        const url = ctx.config.url as string | undefined;

        ctx.log(`Sending Discord embed: ${title}`);

        const embed: Record<string, unknown> = {
          title,
          description,
          color,
          timestamp: new Date().toISOString(),
        };

        if (fields) embed.fields = fields;
        if (footer) embed.footer = { text: footer };
        if (url) embed.url = url;

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed] }),
        });

        if (!response.ok) {
          throw new Error(`Discord API error: ${response.status}`);
        }

        return { success: true };
      },
    }),
  ],

  triggers: [
    defineTrigger({
      name: 'webhook',
      description: 'Trigger on Discord webhook (via interaction endpoint)',
      async setup(_config, _emit) {
        console.log('[discord] Webhook trigger registered');
        return () => {};
      },
    }),
  ],
});
