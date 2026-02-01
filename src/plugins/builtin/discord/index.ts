import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';
import { WebSocket } from 'ws';

// Discord Gateway connection state
let gatewayConnection: WebSocket | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let lastSequence: number | null = null;
let sessionId: string | null = null;
let resumeGatewayUrl: string | null = null;
let isReconnecting = false;

// Discord Gateway opcodes
const GatewayOpcodes = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  PresenceUpdate: 3,
  VoiceStateUpdate: 4,
  Resume: 6,
  Reconnect: 7,
  RequestGuildMembers: 8,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
};

// Message handlers for all active triggers
interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: {
    id: string;
    username: string;
    discriminator: string;
    bot?: boolean;
  };
  content: string;
  timestamp: string;
  edited_timestamp?: string;
  tts: boolean;
  mention_everyone: boolean;
  mentions: Array<{ id: string; username: string }>;
  referenced_message?: DiscordMessage;
}

type MessageHandler = (message: DiscordMessage) => void;
const messageHandlers: MessageHandler[] = [];

/**
 * Get bot token from environment
 */
function getBotToken(): string | undefined {
  return process.env.DISCORD_BOT_TOKEN;
}

/**
 * Get the Discord Gateway URL
 */
async function getGatewayUrl(token: string): Promise<string> {
  const response = await fetch('https://discord.com/api/v10/gateway/bot', {
    headers: {
      'Authorization': `Bot ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get Gateway URL: ${response.status} ${error}`);
  }

  const data = await response.json() as { url: string };
  return data.url;
}

/**
 * Send a heartbeat to Discord
 */
function sendHeartbeat(): void {
  if (gatewayConnection?.readyState === WebSocket.OPEN) {
    gatewayConnection.send(JSON.stringify({
      op: GatewayOpcodes.Heartbeat,
      d: lastSequence,
    }));
  }
}

/**
 * Send identify payload to Discord
 */
function sendIdentify(token: string): void {
  if (gatewayConnection?.readyState === WebSocket.OPEN) {
    gatewayConnection.send(JSON.stringify({
      op: GatewayOpcodes.Identify,
      d: {
        token,
        intents: (1 << 9) | (1 << 15), // GUILD_MESSAGES | MESSAGE_CONTENT
        properties: {
          os: 'linux',
          browser: 'weavr',
          device: 'weavr',
        },
      },
    }));
  }
}

/**
 * Send resume payload to Discord
 */
function sendResume(token: string): void {
  if (gatewayConnection?.readyState === WebSocket.OPEN && sessionId) {
    gatewayConnection.send(JSON.stringify({
      op: GatewayOpcodes.Resume,
      d: {
        token,
        session_id: sessionId,
        seq: lastSequence,
      },
    }));
  }
}

/**
 * Connect to Discord Gateway
 */
async function connectGateway(token: string): Promise<void> {
  if (gatewayConnection && gatewayConnection.readyState === WebSocket.OPEN) {
    console.log('[discord] Gateway already connected');
    return;
  }

  if (isReconnecting) {
    console.log('[discord] Already reconnecting...');
    return;
  }

  console.log('[discord] Connecting to Discord Gateway...');

  // Get gateway URL
  const gatewayUrl = resumeGatewayUrl || await getGatewayUrl(token);

  return new Promise((resolve, reject) => {
    gatewayConnection = new WebSocket(`${gatewayUrl}?v=10&encoding=json`);

    gatewayConnection.on('open', () => {
      console.log('[discord] Gateway connection opened');
    });

    gatewayConnection.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          op: number;
          d: unknown;
          s: number | null;
          t: string | null;
        };

        // Update sequence number
        if (msg.s !== null) {
          lastSequence = msg.s;
        }

        switch (msg.op) {
          case GatewayOpcodes.Hello: {
            const helloData = msg.d as { heartbeat_interval: number };
            const heartbeatMs = helloData.heartbeat_interval;

            // Start heartbeat
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
            }
            heartbeatInterval = setInterval(sendHeartbeat, heartbeatMs);

            // Send initial heartbeat
            sendHeartbeat();

            // Identify or resume
            if (sessionId && lastSequence !== null) {
              console.log('[discord] Resuming session...');
              sendResume(token);
            } else {
              sendIdentify(token);
            }
            break;
          }

          case GatewayOpcodes.HeartbeatAck:
            // Heartbeat acknowledged
            break;

          case GatewayOpcodes.Dispatch: {
            if (msg.t === 'READY') {
              const readyData = msg.d as { session_id: string; resume_gateway_url: string };
              sessionId = readyData.session_id;
              resumeGatewayUrl = readyData.resume_gateway_url;
              console.log('[discord] Gateway ready');
              isReconnecting = false;
              resolve();
            } else if (msg.t === 'RESUMED') {
              console.log('[discord] Session resumed');
              isReconnecting = false;
              resolve();
            } else if (msg.t === 'MESSAGE_CREATE') {
              const message = msg.d as DiscordMessage;

              // Notify all handlers
              messageHandlers.forEach(handler => {
                try {
                  handler(message);
                } catch (err) {
                  console.error('[discord] Handler error:', err);
                }
              });
            }
            break;
          }

          case GatewayOpcodes.Reconnect:
            console.log('[discord] Received reconnect request');
            gatewayConnection?.close(4000, 'Reconnect requested');
            break;

          case GatewayOpcodes.InvalidSession: {
            const canResume = msg.d as boolean;
            console.log(`[discord] Invalid session (resumable: ${canResume})`);
            if (!canResume) {
              sessionId = null;
              lastSequence = null;
            }
            // Wait and reconnect
            setTimeout(() => {
              if (canResume) {
                sendResume(token);
              } else {
                sendIdentify(token);
              }
            }, 1000 + Math.random() * 5000);
            break;
          }

          case GatewayOpcodes.Heartbeat:
            // Server requested heartbeat
            sendHeartbeat();
            break;
        }
      } catch (err) {
        console.error('[discord] Failed to parse Gateway message:', err);
      }
    });

    gatewayConnection.on('close', (code, reason) => {
      console.log(`[discord] Gateway closed (code: ${code}, reason: ${reason})`);

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      gatewayConnection = null;

      // Attempt to reconnect if we have handlers
      if (messageHandlers.length > 0 && !isReconnecting) {
        isReconnecting = true;
        console.log('[discord] Scheduling reconnection...');
        setTimeout(async () => {
          try {
            await connectGateway(token);
          } catch (err) {
            console.error('[discord] Reconnection failed:', err);
            isReconnecting = false;
          }
        }, 5000);
      }
    });

    gatewayConnection.on('error', (err) => {
      console.error('[discord] Gateway error:', err);
      if (gatewayConnection?.readyState !== WebSocket.OPEN) {
        reject(err);
      }
    });
  });
}

/**
 * Disconnect from Discord Gateway
 */
function disconnectGateway(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (gatewayConnection) {
    gatewayConnection.close(1000, 'Disconnecting');
    gatewayConnection = null;
  }

  sessionId = null;
  lastSequence = null;
  resumeGatewayUrl = null;
  isReconnecting = false;
}

/**
 * Check if Gateway should be disconnected (no handlers)
 */
function checkDisconnect(): void {
  if (messageHandlers.length === 0) {
    console.log('[discord] No more handlers, disconnecting Gateway...');
    disconnectGateway();
  }
}

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
      name: 'message',
      description: 'Trigger on Discord messages (via Gateway - real-time)',
      schema: z.object({
        channelId: z.string().optional().describe('Specific channel ID to filter messages'),
        guildId: z.string().optional().describe('Specific guild/server ID to filter messages'),
        pattern: z.string().optional().describe('Regex pattern to match in message content'),
        ignoreBot: z.boolean().default(true).describe('Whether to ignore messages from bots'),
      }),
      async setup(config, emit) {
        const token = getBotToken();
        if (!token) {
          console.log('[discord] DISCORD_BOT_TOKEN not set - message trigger will not receive events');
          console.log('[discord] To enable: Create a Discord application, add a bot, and set DISCORD_BOT_TOKEN');
          console.log('[discord] Note: Enable MESSAGE CONTENT intent in Discord Developer Portal');
          return () => {};
        }

        const typedConfig = config as { channelId?: string; guildId?: string; pattern?: string; ignoreBot?: boolean };

        // Connect to Gateway if not already connected
        try {
          await connectGateway(token);
        } catch (err) {
          console.error('[discord] Failed to connect Gateway:', err);
          return () => {};
        }

        // Create handler for this trigger
        const handler: MessageHandler = (message) => {
          // Skip bot messages if configured
          if (typedConfig.ignoreBot !== false && message.author.bot) {
            return;
          }

          // Filter by guild if specified
          if (typedConfig.guildId && message.guild_id !== typedConfig.guildId) {
            return;
          }

          // Emit the event - filtering will be done by TriggerManager
          emit({
            type: 'discord.message',
            messageId: message.id,
            channelId: message.channel_id,
            guildId: message.guild_id,
            author: {
              id: message.author.id,
              username: message.author.username,
              discriminator: message.author.discriminator,
              isBot: message.author.bot ?? false,
            },
            content: message.content,
            text: message.content, // Alias for consistency
            timestamp: message.timestamp,
            editedTimestamp: message.edited_timestamp,
            mentions: message.mentions.map(m => ({ id: m.id, username: m.username })),
            replyTo: message.referenced_message?.id,
            isBot: message.author.bot ?? false,
            botId: message.author.bot ? message.author.id : undefined,
          });
        };

        messageHandlers.push(handler);
        console.log(`[discord] Message trigger active${typedConfig.channelId ? ` for channel ${typedConfig.channelId}` : ''}`);

        // Return cleanup function
        return () => {
          const index = messageHandlers.indexOf(handler);
          if (index >= 0) {
            messageHandlers.splice(index, 1);
          }
          checkDisconnect();
          console.log('[discord] Message trigger deactivated');
        };
      },
    }),

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
