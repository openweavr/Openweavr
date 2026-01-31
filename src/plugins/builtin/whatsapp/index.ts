import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';

// Session storage location
const AUTH_DIR = join(homedir(), '.weavr', 'whatsapp-auth');

// Active connection (singleton for now)
let activeSocket: ReturnType<typeof import('@whiskeysockets/baileys').default> | null = null;
let connectionReady = false;
let broadcastFn: ((channel: string, message: { type: string; payload: unknown }) => void) | null = null;
let isReconnecting = false;

// Helper to create and setup a WhatsApp socket
async function createSocket() {
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');
  const qrcode = await import('qrcode-terminal');

  await mkdir(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n[whatsapp] Scan this QR code with WhatsApp:\n');
      qrcode.default.generate(qr, { small: true });
      console.log('\n');

      if (broadcastFn) {
        broadcastFn('*', { type: 'whatsapp:qr', payload: { qr } });
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[whatsapp] Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);
      connectionReady = false;

      if (shouldReconnect && !isReconnecting) {
        isReconnecting = true;
        console.log('[whatsapp] Reconnecting...');
        setTimeout(async () => {
          try {
            activeSocket = await createSocket();
            isReconnecting = false;
          } catch (err) {
            console.error('[whatsapp] Reconnection failed:', err);
            isReconnecting = false;
            if (broadcastFn) {
              broadcastFn('*', { type: 'whatsapp:disconnected', payload: { error: String(err) } });
            }
          }
        }, 1000);
      } else if (!shouldReconnect) {
        if (broadcastFn) {
          broadcastFn('*', { type: 'whatsapp:disconnected', payload: { statusCode } });
        }
      }
    } else if (connection === 'open') {
      console.log('[whatsapp] Connected successfully!');
      connectionReady = true;
      isReconnecting = false;

      if (broadcastFn) {
        broadcastFn('*', { type: 'whatsapp:connected', payload: {} });
      }
    }
  });

  socket.ev.on('creds.update', saveCreds);
  activeSocket = socket;

  return socket;
}

const SendMessageSchema = z.object({
  to: z.string(), // Phone number with country code (e.g., "1234567890") or JID
  text: z.string(),
});

const SendMediaSchema = z.object({
  to: z.string(),
  media: z.string(), // URL or file path
  caption: z.string().optional(),
  mediaType: z.enum(['image', 'video', 'audio', 'document']).default('image'),
});

const GetStatusSchema = z.object({});

// Normalize phone number to WhatsApp JID
function normalizeJid(to: string): string {
  // If already a JID, return as-is
  if (to.includes('@')) return to;

  // Remove any non-digit characters
  const digits = to.replace(/\D/g, '');

  // Add @s.whatsapp.net for individual chats
  return `${digits}@s.whatsapp.net`;
}

export default definePlugin({
  name: 'whatsapp',
  version: '1.0.0',
  description: 'WhatsApp messaging via WhatsApp Web (requires QR code login)',

  actions: [
    defineAction({
      name: 'send',
      description: 'Send a text message via WhatsApp',
      schema: SendMessageSchema,
      async execute(ctx) {
        const config = SendMessageSchema.parse(ctx.config);

        if (!activeSocket || !connectionReady) {
          throw new Error('WhatsApp not connected. Run "weavr whatsapp login" to connect first.');
        }

        const jid = normalizeJid(config.to);
        ctx.log(`Sending WhatsApp message to ${jid}`);

        // Send composing indicator
        await activeSocket.presenceSubscribe(jid);
        await activeSocket.sendPresenceUpdate('composing', jid);

        // Small delay to simulate typing
        await new Promise(resolve => setTimeout(resolve, 500));

        // Send message
        const result = await activeSocket.sendMessage(jid, { text: config.text });

        // Clear composing
        await activeSocket.sendPresenceUpdate('paused', jid);

        return {
          messageId: result?.key?.id,
          to: jid,
          sent: true,
          timestamp: Date.now(),
        };
      },
    }),

    defineAction({
      name: 'sendMedia',
      description: 'Send an image, video, or document via WhatsApp',
      schema: SendMediaSchema,
      async execute(ctx) {
        const config = SendMediaSchema.parse(ctx.config);

        if (!activeSocket || !connectionReady) {
          throw new Error('WhatsApp not connected. Run "weavr whatsapp login" to connect first.');
        }

        const jid = normalizeJid(config.to);
        ctx.log(`Sending WhatsApp ${config.mediaType} to ${jid}`);

        let messageContent: Record<string, unknown>;

        // Build message based on media type
        if (config.mediaType === 'image') {
          messageContent = {
            image: { url: config.media },
            caption: config.caption,
          };
        } else if (config.mediaType === 'video') {
          messageContent = {
            video: { url: config.media },
            caption: config.caption,
          };
        } else if (config.mediaType === 'audio') {
          messageContent = {
            audio: { url: config.media },
            ptt: true, // Voice note
          };
        } else {
          messageContent = {
            document: { url: config.media },
            caption: config.caption,
          };
        }

        const result = await activeSocket.sendMessage(jid, messageContent);

        return {
          messageId: result?.key?.id,
          to: jid,
          mediaType: config.mediaType,
          sent: true,
        };
      },
    }),

    defineAction({
      name: 'status',
      description: 'Get WhatsApp connection status',
      schema: GetStatusSchema,
      async execute(ctx) {
        ctx.log('Checking WhatsApp status');

        return {
          connected: connectionReady,
          hasSocket: activeSocket !== null,
          authDir: AUTH_DIR,
        };
      },
    }),

    defineAction({
      name: 'connect',
      description: 'Initialize WhatsApp connection (will show QR code in terminal if needed)',
      async execute(ctx) {
        ctx.log('Connecting to WhatsApp...');

        // Store broadcast function if provided (from server)
        if (ctx.config._broadcast && typeof ctx.config._broadcast === 'function') {
          broadcastFn = ctx.config._broadcast as typeof broadcastFn;
        }

        if (activeSocket && connectionReady) {
          if (broadcastFn) {
            broadcastFn('*', { type: 'whatsapp:connected', payload: {} });
          }
          return { status: 'already_connected' };
        }

        // Create the socket (handles all connection logic)
        await createSocket();

        // Wait for connection or timeout
        const connected = await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => resolve(false), 120000); // 2 min timeout for reconnection

          const checkConnection = () => {
            if (connectionReady) {
              clearTimeout(timeout);
              resolve(true);
            } else {
              setTimeout(checkConnection, 1000);
            }
          };
          checkConnection();
        });

        return {
          status: connected ? 'connected' : 'timeout',
          message: connected
            ? 'WhatsApp connected successfully'
            : 'Connection timed out. Check if QR was scanned.',
        };
      },
    }),

    defineAction({
      name: 'disconnect',
      description: 'Disconnect from WhatsApp',
      async execute(ctx) {
        ctx.log('Disconnecting from WhatsApp...');

        if (activeSocket) {
          await activeSocket.logout();
          activeSocket = null;
          connectionReady = false;
        }

        return { status: 'disconnected' };
      },
    }),
  ],

  triggers: [
    defineTrigger({
      name: 'message',
      description: 'Trigger on incoming WhatsApp messages',
      async setup(config, emit) {
        console.log('[whatsapp] Message trigger registered');
        console.log('[whatsapp] Note: WhatsApp must be connected for triggers to work');

        // If socket exists, add message handler
        if (activeSocket) {
          activeSocket.ev.on('messages.upsert', async (m) => {
            for (const msg of m.messages) {
              // Skip if it's our own message
              if (msg.key.fromMe) continue;

              const text = msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                '';

              emit({
                type: 'whatsapp.message',
                messageId: msg.key.id,
                from: msg.key.remoteJid,
                text,
                timestamp: msg.messageTimestamp,
                pushName: msg.pushName, // Sender's name
              });
            }
          });
        }

        return () => {
          console.log('[whatsapp] Message trigger unregistered');
        };
      },
    }),
  ],

  hooks: {
    async onUnload() {
      if (activeSocket) {
        console.log('[whatsapp] Cleanup: disconnecting');
        activeSocket.end(undefined);
        activeSocket = null;
        connectionReady = false;
      }
    },
  },
});
