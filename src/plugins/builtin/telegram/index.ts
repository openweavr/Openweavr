import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Helper to get bot token
function getToken(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string {
  const token = (ctx.config.token as string) ?? ctx.env.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('Telegram bot token required. Set TELEGRAM_BOT_TOKEN or pass token in config.');
  }
  return token;
}

// Helper for Telegram API calls
async function telegramApi(token: string, method: string, body?: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${TELEGRAM_API}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json() as { ok: boolean; result?: unknown; description?: string };

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description ?? 'Unknown error'}`);
  }

  return data.result;
}

const SendMessageSchema = z.object({
  chatId: z.union([z.string(), z.number()]),
  text: z.string(),
  parseMode: z.enum(['HTML', 'Markdown', 'MarkdownV2']).optional(),
  replyToMessageId: z.number().optional(),
  disableNotification: z.boolean().optional(),
  token: z.string().optional(),
});

const SendPhotoSchema = z.object({
  chatId: z.union([z.string(), z.number()]),
  photo: z.string(), // URL or file_id
  caption: z.string().optional(),
  parseMode: z.enum(['HTML', 'Markdown', 'MarkdownV2']).optional(),
  replyToMessageId: z.number().optional(),
  token: z.string().optional(),
});

const SendDocumentSchema = z.object({
  chatId: z.union([z.string(), z.number()]),
  document: z.string(), // URL or file_id
  caption: z.string().optional(),
  parseMode: z.enum(['HTML', 'Markdown', 'MarkdownV2']).optional(),
  replyToMessageId: z.number().optional(),
  token: z.string().optional(),
});

const GetUpdatesSchema = z.object({
  offset: z.number().optional(),
  limit: z.number().optional(),
  timeout: z.number().optional(),
  token: z.string().optional(),
});

const WebhookTriggerSchema = z.object({
  path: z.string().default('/telegram'),
  token: z.string().optional(),
  allowedUpdates: z.array(z.string()).optional(),
});

export default definePlugin({
  name: 'telegram',
  version: '1.0.0',
  description: 'Telegram Bot API - send messages and receive updates',

  actions: [
    defineAction({
      name: 'send',
      description: 'Send a text message to a Telegram chat',
      schema: SendMessageSchema,
      async execute(ctx) {
        const config = SendMessageSchema.parse(ctx.config);
        const token = config.token ?? getToken(ctx);

        ctx.log(`Sending message to ${config.chatId}`);

        const result = await telegramApi(token, 'sendMessage', {
          chat_id: config.chatId,
          text: config.text,
          parse_mode: config.parseMode,
          reply_to_message_id: config.replyToMessageId,
          disable_notification: config.disableNotification,
        }) as { message_id: number; chat: { id: number }; date: number };

        return {
          messageId: result.message_id,
          chatId: result.chat.id,
          date: result.date,
          sent: true,
        };
      },
    }),

    defineAction({
      name: 'sendPhoto',
      description: 'Send a photo to a Telegram chat',
      schema: SendPhotoSchema,
      async execute(ctx) {
        const config = SendPhotoSchema.parse(ctx.config);
        const token = config.token ?? getToken(ctx);

        ctx.log(`Sending photo to ${config.chatId}`);

        const result = await telegramApi(token, 'sendPhoto', {
          chat_id: config.chatId,
          photo: config.photo,
          caption: config.caption,
          parse_mode: config.parseMode,
          reply_to_message_id: config.replyToMessageId,
        }) as { message_id: number; chat: { id: number } };

        return {
          messageId: result.message_id,
          chatId: result.chat.id,
          sent: true,
        };
      },
    }),

    defineAction({
      name: 'sendDocument',
      description: 'Send a document/file to a Telegram chat',
      schema: SendDocumentSchema,
      async execute(ctx) {
        const config = SendDocumentSchema.parse(ctx.config);
        const token = config.token ?? getToken(ctx);

        ctx.log(`Sending document to ${config.chatId}`);

        const result = await telegramApi(token, 'sendDocument', {
          chat_id: config.chatId,
          document: config.document,
          caption: config.caption,
          parse_mode: config.parseMode,
          reply_to_message_id: config.replyToMessageId,
        }) as { message_id: number; chat: { id: number } };

        return {
          messageId: result.message_id,
          chatId: result.chat.id,
          sent: true,
        };
      },
    }),

    defineAction({
      name: 'getUpdates',
      description: 'Get recent messages/updates (for polling)',
      schema: GetUpdatesSchema,
      async execute(ctx) {
        const config = GetUpdatesSchema.parse(ctx.config);
        const token = config.token ?? getToken(ctx);

        ctx.log('Fetching updates');

        const result = await telegramApi(token, 'getUpdates', {
          offset: config.offset,
          limit: config.limit ?? 100,
          timeout: config.timeout ?? 0,
        }) as Array<{
          update_id: number;
          message?: {
            message_id: number;
            from: { id: number; first_name: string; username?: string };
            chat: { id: number; type: string };
            date: number;
            text?: string;
          };
        }>;

        return {
          updates: result.map(update => ({
            updateId: update.update_id,
            message: update.message ? {
              messageId: update.message.message_id,
              from: {
                id: update.message.from.id,
                name: update.message.from.first_name,
                username: update.message.from.username,
              },
              chatId: update.message.chat.id,
              chatType: update.message.chat.type,
              text: update.message.text,
              date: update.message.date,
            } : null,
          })),
          count: result.length,
          lastUpdateId: result.length > 0 ? result[result.length - 1].update_id : null,
        };
      },
    }),

    defineAction({
      name: 'getMe',
      description: 'Get information about the bot',
      async execute(ctx) {
        const token = getToken(ctx);

        ctx.log('Getting bot info');

        const result = await telegramApi(token, 'getMe') as {
          id: number;
          first_name: string;
          username: string;
          can_join_groups: boolean;
        };

        return {
          id: result.id,
          name: result.first_name,
          username: result.username,
          canJoinGroups: result.can_join_groups,
        };
      },
    }),

    defineAction({
      name: 'setWebhook',
      description: 'Set webhook URL for receiving updates',
      async execute(ctx) {
        const token = getToken(ctx);
        const url = ctx.config.url as string;
        const secretToken = ctx.config.secretToken as string | undefined;

        if (!url) {
          throw new Error('Webhook URL required');
        }

        ctx.log(`Setting webhook to ${url}`);

        const result = await telegramApi(token, 'setWebhook', {
          url,
          secret_token: secretToken,
          allowed_updates: ['message', 'callback_query'],
        });

        return { success: true, result };
      },
    }),

    defineAction({
      name: 'deleteWebhook',
      description: 'Remove webhook and switch to polling mode',
      async execute(ctx) {
        const token = getToken(ctx);

        ctx.log('Deleting webhook');

        const result = await telegramApi(token, 'deleteWebhook');

        return { success: true, result };
      },
    }),
  ],

  triggers: [
    defineTrigger({
      name: 'message',
      description: 'Trigger on incoming Telegram messages (via webhook)',
      schema: WebhookTriggerSchema,
      async setup(config, _emit) {
        const parsed = WebhookTriggerSchema.parse(config);

        // The webhook is registered with the gateway server
        // Actual webhook handling happens in the gateway
        console.log(`[telegram] Webhook trigger registered at /webhook${parsed.path}`);
        console.log(`[telegram] Configure your bot webhook to point to: <your-server>/webhook${parsed.path}`);

        return () => {
          console.log(`[telegram] Webhook trigger unregistered: ${parsed.path}`);
        };
      },
    }),
  ],
});
