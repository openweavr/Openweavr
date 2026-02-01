import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';
import { WebSocket } from 'ws';

// Slack Socket Mode connection state
let socketConnection: WebSocket | null = null;
let socketUrl: string | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;

// Message handlers for all active triggers
interface SlackMessageEvent {
  type: string;
  channel?: string;
  channelName?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

type MessageHandler = (event: SlackMessageEvent) => void;
const messageHandlers: MessageHandler[] = [];

// Reaction handlers
interface SlackReactionEvent {
  type: string;
  user: string;
  reaction: string;
  item: {
    type: string;
    channel: string;
    ts: string;
  };
  event_ts: string;
}

type ReactionHandler = (event: SlackReactionEvent) => void;
const reactionHandlers: ReactionHandler[] = [];

/**
 * Get the app-level token for Socket Mode
 */
function getAppToken(): string | undefined {
  return process.env.SLACK_APP_TOKEN;
}

/**
 * Connect to Slack using Socket Mode
 */
async function connectSocketMode(appToken: string): Promise<void> {
  if (socketConnection && socketConnection.readyState === WebSocket.OPEN) {
    console.log('[slack] Socket Mode already connected');
    return;
  }

  console.log('[slack] Connecting to Slack Socket Mode...');

  // Get WebSocket URL from Slack
  const response = await fetch('https://slack.com/api/apps.connections.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${appToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const data = await response.json() as { ok: boolean; url?: string; error?: string };

  if (!data.ok || !data.url) {
    throw new Error(`Failed to get Socket Mode URL: ${data.error ?? 'unknown error'}`);
  }

  socketUrl = data.url;

  return new Promise((resolve, reject) => {
    socketConnection = new WebSocket(socketUrl!);

    socketConnection.on('open', () => {
      console.log('[slack] Socket Mode connected');
      reconnectAttempts = 0;
      resolve();
    });

    socketConnection.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          envelope_id?: string;
          payload?: {
            event?: SlackMessageEvent | SlackReactionEvent;
            type?: string;
          };
          num_connections?: number;
        };

        // Acknowledge the envelope if present
        if (msg.envelope_id) {
          socketConnection?.send(JSON.stringify({ envelope_id: msg.envelope_id }));
        }

        // Handle different message types
        if (msg.type === 'hello') {
          console.log(`[slack] Socket Mode ready (connections: ${msg.num_connections ?? 1})`);
        } else if (msg.type === 'disconnect') {
          console.log('[slack] Received disconnect message, will reconnect...');
        } else if (msg.type === 'events_api' && msg.payload?.event) {
          const event = msg.payload.event;

          // Route to appropriate handlers
          if (event.type === 'message' && !('subtype' in event && event.subtype)) {
            messageHandlers.forEach(handler => {
              try {
                handler(event as SlackMessageEvent);
              } catch (err) {
                console.error('[slack] Message handler error:', err);
              }
            });
          } else if (event.type === 'reaction_added') {
            reactionHandlers.forEach(handler => {
              try {
                handler(event as SlackReactionEvent);
              } catch (err) {
                console.error('[slack] Reaction handler error:', err);
              }
            });
          }
        }
      } catch (err) {
        console.error('[slack] Failed to parse Socket Mode message:', err);
      }
    });

    socketConnection.on('close', (code, reason) => {
      console.log(`[slack] Socket Mode disconnected (code: ${code}, reason: ${reason})`);
      socketConnection = null;

      // Attempt to reconnect if we have handlers
      if (messageHandlers.length > 0 || reactionHandlers.length > 0) {
        attemptReconnect(appToken);
      }
    });

    socketConnection.on('error', (err) => {
      console.error('[slack] Socket Mode error:', err);
      if (socketConnection?.readyState !== WebSocket.OPEN) {
        reject(err);
      }
    });
  });
}

/**
 * Attempt to reconnect to Socket Mode
 */
function attemptReconnect(appToken: string): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('[slack] Max reconnect attempts reached');
    return;
  }

  reconnectAttempts++;
  console.log(`[slack] Reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

  setTimeout(async () => {
    try {
      await connectSocketMode(appToken);
    } catch (err) {
      console.error('[slack] Reconnection failed:', err);
      attemptReconnect(appToken);
    }
  }, RECONNECT_DELAY_MS);
}

/**
 * Disconnect from Socket Mode
 */
function disconnectSocketMode(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (socketConnection) {
    socketConnection.close();
    socketConnection = null;
  }

  socketUrl = null;
  reconnectAttempts = 0;
}

/**
 * Check if Socket Mode should be disconnected (no handlers)
 */
function checkDisconnect(): void {
  if (messageHandlers.length === 0 && reactionHandlers.length === 0) {
    console.log('[slack] No more handlers, disconnecting Socket Mode...');
    disconnectSocketMode();
  }
}

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
      schema: z.object({
        channel: z.string().optional().describe('Channel ID or name (with #) to filter messages'),
        pattern: z.string().optional().describe('Regex pattern to match in message text'),
        ignoreBot: z.boolean().default(true).describe('Whether to ignore messages from bots'),
      }),
      async setup(config, emit) {
        const appToken = getAppToken();
        if (!appToken) {
          console.log('[slack] SLACK_APP_TOKEN not set - message trigger will not receive events');
          console.log('[slack] To enable: Create a Slack app with Socket Mode and set SLACK_APP_TOKEN');
          return () => {};
        }

        const typedConfig = config as { channel?: string; pattern?: string; ignoreBot?: boolean };

        // Connect to Socket Mode if not already connected
        try {
          await connectSocketMode(appToken);
        } catch (err) {
          console.error('[slack] Failed to connect Socket Mode:', err);
          return () => {};
        }

        // Create handler for this trigger
        const handler: MessageHandler = (event) => {
          // Skip bot messages if configured
          if (typedConfig.ignoreBot !== false && event.bot_id) {
            return;
          }

          // Emit the event - filtering will be done by TriggerManager
          emit({
            type: 'slack.message',
            channel: event.channel,
            channelName: event.channelName,
            user: event.user,
            text: event.text ?? '',
            ts: event.ts,
            threadTs: event.thread_ts,
            isBot: !!event.bot_id,
            botId: event.bot_id,
          });
        };

        messageHandlers.push(handler);
        console.log(`[slack] Message trigger active for ${typedConfig.channel ?? 'all channels'}`);

        // Return cleanup function
        return () => {
          const index = messageHandlers.indexOf(handler);
          if (index >= 0) {
            messageHandlers.splice(index, 1);
          }
          checkDisconnect();
          console.log('[slack] Message trigger deactivated');
        };
      },
    }),

    defineTrigger({
      name: 'slash_command',
      description: 'Trigger on slash command',
      async setup(config, _emit) {
        const command = (config as { command?: string }).command;
        console.log(`[slack] Slash command trigger registered: ${command ?? '/command'}`);
        console.log('[slack] Note: Slash commands require a Request URL configured in Slack app settings');
        return () => {};
      },
    }),

    defineTrigger({
      name: 'reaction_added',
      description: 'Trigger when a reaction is added',
      schema: z.object({
        reaction: z.string().optional().describe('Specific reaction name to filter (without colons)'),
        channel: z.string().optional().describe('Channel ID to filter reactions'),
      }),
      async setup(config, emit) {
        const appToken = getAppToken();
        if (!appToken) {
          console.log('[slack] SLACK_APP_TOKEN not set - reaction trigger will not receive events');
          return () => {};
        }

        const typedConfig = config as { reaction?: string; channel?: string };

        // Connect to Socket Mode if not already connected
        try {
          await connectSocketMode(appToken);
        } catch (err) {
          console.error('[slack] Failed to connect Socket Mode:', err);
          return () => {};
        }

        // Create handler for this trigger
        const handler: ReactionHandler = (event) => {
          // Filter by reaction name if specified
          if (typedConfig.reaction && event.reaction !== typedConfig.reaction) {
            return;
          }

          // Filter by channel if specified
          if (typedConfig.channel && event.item.channel !== typedConfig.channel) {
            return;
          }

          emit({
            type: 'slack.reaction_added',
            user: event.user,
            reaction: event.reaction,
            channel: event.item.channel,
            messageTs: event.item.ts,
            eventTs: event.event_ts,
          });
        };

        reactionHandlers.push(handler);
        console.log(`[slack] Reaction trigger active${typedConfig.reaction ? ` for :${typedConfig.reaction}:` : ''}`);

        // Return cleanup function
        return () => {
          const index = reactionHandlers.indexOf(handler);
          if (index >= 0) {
            reactionHandlers.splice(index, 1);
          }
          checkDisconnect();
          console.log('[slack] Reaction trigger deactivated');
        };
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
