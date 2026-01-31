import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { GatewayClient, GatewayMessage, WeavrConfig } from '../types/index.js';

export interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  broadcast(channel: string, message: GatewayMessage): void;
  getClients(): GatewayClient[];
}

export function createGatewayServer(config: WeavrConfig): GatewayServer {
  const app = new Hono();
  const clients = new Map<string, GatewayClient>();

  let httpServer: ReturnType<typeof serve> | null = null;
  let wss: WebSocketServer | null = null;

  // Health check endpoint
  app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

  // API routes
  app.get('/api/workflows', (c) => {
    return c.json({ workflows: [] });
  });

  app.get('/api/workflows/:name', (c) => {
    const name = c.req.param('name');
    return c.json({ name, steps: [] });
  });

  app.post('/api/workflows/:name/run', async (c) => {
    const name = c.req.param('name');
    const body = await c.req.json().catch(() => ({}));
    const runId = randomUUID();

    broadcast('runs', {
      type: 'workflow.started',
      payload: { runId, workflow: name, trigger: body },
    });

    return c.json({ runId, status: 'started' });
  });

  app.get('/api/runs', (c) => {
    return c.json({ runs: [] });
  });

  app.get('/api/runs/:id', (c) => {
    const id = c.req.param('id');
    return c.json({ id, status: 'unknown' });
  });

  app.get('/api/plugins', (c) => {
    return c.json({ plugins: [] });
  });

  // Webhook receiver
  app.post('/webhook/:source', async (c) => {
    const source = c.req.param('source');
    const body = await c.req.json().catch(() => ({}));
    const headers = Object.fromEntries(c.req.raw.headers);

    broadcast('webhooks', {
      type: 'webhook.received',
      payload: { source, body, headers },
    });

    return c.json({ received: true });
  });

  function broadcast(channel: string, message: GatewayMessage): void {
    const fullMessage: GatewayMessage = {
      ...message,
      id: message.id ?? randomUUID(),
      timestamp: message.timestamp ?? Date.now(),
    };

    const data = JSON.stringify(fullMessage);

    for (const client of clients.values()) {
      if (client.subscriptions.has(channel) || client.subscriptions.has('*')) {
        const socket = client.socket as WebSocket;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      }
    }
  }

  function handleConnection(socket: WebSocket): void {
    const clientId = randomUUID();
    const client: GatewayClient = {
      id: clientId,
      socket,
      subscriptions: new Set(['*']),
    };

    clients.set(clientId, client);

    socket.send(JSON.stringify({
      type: 'connected',
      payload: { clientId },
      timestamp: Date.now(),
    }));

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as GatewayMessage;
        handleMessage(client, message);
      } catch {
        socket.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid JSON' },
        }));
      }
    });

    socket.on('close', () => {
      clients.delete(clientId);
    });

    socket.on('error', (err) => {
      console.error(`WebSocket error for client ${clientId}:`, err.message);
      clients.delete(clientId);
    });
  }

  function handleMessage(client: GatewayClient, message: GatewayMessage): void {
    const socket = client.socket as WebSocket;

    switch (message.type) {
      case 'subscribe': {
        const channels = (message.payload as { channels?: string[] })?.channels ?? [];
        for (const channel of channels) {
          client.subscriptions.add(channel);
        }
        socket.send(JSON.stringify({
          type: 'subscribed',
          payload: { channels: Array.from(client.subscriptions) },
        }));
        break;
      }

      case 'unsubscribe': {
        const channels = (message.payload as { channels?: string[] })?.channels ?? [];
        for (const channel of channels) {
          client.subscriptions.delete(channel);
        }
        socket.send(JSON.stringify({
          type: 'unsubscribed',
          payload: { channels: Array.from(client.subscriptions) },
        }));
        break;
      }

      case 'ping': {
        socket.send(JSON.stringify({
          type: 'pong',
          payload: {},
          timestamp: Date.now(),
        }));
        break;
      }

      default: {
        socket.send(JSON.stringify({
          type: 'error',
          payload: { message: `Unknown message type: ${message.type}` },
        }));
      }
    }
  }

  return {
    async start() {
      const { port, host } = config.server;

      httpServer = serve({
        fetch: app.fetch,
        port,
        hostname: host,
      });

      const address = httpServer.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;

      wss = new WebSocketServer({ server: httpServer as Server });
      wss.on('connection', handleConnection);

      console.log(`Gateway server running at http://${host}:${actualPort}`);
      console.log(`WebSocket available at ws://${host}:${actualPort}`);
    },

    async stop() {
      for (const client of clients.values()) {
        const socket = client.socket as WebSocket;
        socket.close();
      }
      clients.clear();

      wss?.close();
      httpServer?.close();
    },

    broadcast,

    getClients() {
      return Array.from(clients.values());
    },
  };
}
