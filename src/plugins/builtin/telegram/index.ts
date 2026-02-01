import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Get bot token from global Weavr config
function getGlobalBotToken(): string | undefined {
  try {
    const configPath = join(homedir(), '.weavr', 'config.yaml');
    if (!existsSync(configPath)) return undefined;
    const content = readFileSync(configPath, 'utf-8');
    const config = parseYaml(content) as { messaging?: { telegram?: { botToken?: string } } };
    return config?.messaging?.telegram?.botToken;
  } catch {
    return undefined;
  }
}

// Long-polling state
let pollingActive = false;
let lastUpdateId = 0;
let pollingAbortController: AbortController | null = null;

// Message handlers for all active triggers
interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    is_bot: boolean;
  };
  chat: {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
    username?: string;
  };
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

type MessageHandler = (update: TelegramUpdate) => void;
const messageHandlers: MessageHandler[] = [];

/**
 * Start long-polling for Telegram updates
 */
async function startPolling(token: string): Promise<void> {
  if (pollingActive) {
    console.log('[telegram] Long-polling already active');
    return;
  }

  pollingActive = true;
  pollingAbortController = new AbortController();
  console.log('[telegram] Starting long-polling for updates...');

  // Delete any existing webhook to enable polling
  try {
    await fetch(`${TELEGRAM_API}${token}/deleteWebhook`, {
      method: 'POST',
    });
  } catch {
    console.log('[telegram] Could not delete webhook (may not exist)');
  }

  // Start the polling loop
  pollLoop(token);
}

/**
 * The main polling loop
 */
async function pollLoop(token: string): Promise<void> {
  while (pollingActive) {
    try {
      const response = await fetch(
        `${TELEGRAM_API}${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["message","edited_message","channel_post"]`,
        {
          signal: pollingAbortController?.signal,
        }
      );

      if (!response.ok) {
        console.error(`[telegram] Polling error: ${response.status} ${response.statusText}`);
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      const data = await response.json() as { ok: boolean; result?: TelegramUpdate[] };

      if (!data.ok || !data.result) {
        console.error('[telegram] Invalid response from getUpdates');
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      // Process each update
      for (const update of data.result) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);

        // Notify all handlers
        messageHandlers.forEach(handler => {
          try {
            handler(update);
          } catch (err) {
            console.error('[telegram] Handler error:', err);
          }
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.log('[telegram] Polling stopped');
        break;
      }
      console.error('[telegram] Polling error:', err);
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

/**
 * Stop long-polling
 */
function stopPolling(): void {
  console.log('[telegram] Stopping long-polling...');
  pollingActive = false;
  pollingAbortController?.abort();
  pollingAbortController = null;
}

/**
 * Check if polling should stop (no handlers)
 */
function checkStopPolling(): void {
  if (messageHandlers.length === 0) {
    stopPolling();
  }
}

// Helper to get bot token
function getToken(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string {
  const token = (ctx.config.token as string)
    ?? ctx.env.TELEGRAM_BOT_TOKEN
    ?? process.env.TELEGRAM_BOT_TOKEN
    ?? getGlobalBotToken();
  if (!token) {
    throw new Error('Telegram bot token required. Set TELEGRAM_BOT_TOKEN or configure in Settings.');
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
      description: 'Trigger on incoming Telegram messages (via long-polling - no public URL needed)',
      schema: z.object({
        chatId: z.union([z.string(), z.number()]).optional().describe('Specific chat ID to filter messages'),
        pattern: z.string().optional().describe('Regex pattern to match in message text'),
        chatType: z.enum(['private', 'group', 'supergroup', 'channel']).optional().describe('Filter by chat type'),
      }),
      async setup(config, emit) {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          console.log('[telegram] TELEGRAM_BOT_TOKEN not set - message trigger will not receive events');
          console.log('[telegram] To enable: Create a bot via @BotFather and set TELEGRAM_BOT_TOKEN');
          return () => {};
        }

        const typedConfig = config as { chatId?: string | number; pattern?: string; chatType?: string };

        // Start long-polling if not already active
        try {
          await startPolling(token);
        } catch (err) {
          console.error('[telegram] Failed to start polling:', err);
          return () => {};
        }

        // Create handler for this trigger
        const handler: MessageHandler = (update) => {
          const message = update.message || update.edited_message || update.channel_post;
          if (!message) return;

          // Filter by chat type if specified
          if (typedConfig.chatType && message.chat.type !== typedConfig.chatType) {
            return;
          }

          // Emit the event - filtering will be done by TriggerManager
          emit({
            type: 'telegram.message',
            messageId: message.message_id,
            from: message.from ? {
              id: message.from.id,
              name: `${message.from.first_name}${message.from.last_name ? ' ' + message.from.last_name : ''}`,
              username: message.from.username,
              isBot: message.from.is_bot,
            } : undefined,
            chat: {
              id: message.chat.id,
              type: message.chat.type,
              title: message.chat.title,
              username: message.chat.username,
            },
            chatId: message.chat.id,
            text: message.text ?? '',
            timestamp: message.date,
            replyTo: message.reply_to_message?.message_id,
            isEdited: !!update.edited_message,
            isChannelPost: !!update.channel_post,
          });
        };

        messageHandlers.push(handler);
        console.log(`[telegram] Message trigger active${typedConfig.chatId ? ` for chat ${typedConfig.chatId}` : ''}`);

        // Return cleanup function
        return () => {
          const index = messageHandlers.indexOf(handler);
          if (index >= 0) {
            messageHandlers.splice(index, 1);
          }
          checkStopPolling();
          console.log('[telegram] Message trigger deactivated');
        };
      },
    }),

    defineTrigger({
      name: 'webhook',
      description: 'Trigger on incoming Telegram messages (via webhook - requires public URL)',
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
