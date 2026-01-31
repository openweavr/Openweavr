import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';

const HttpRequestSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  timeout: z.number().default(30000),
});

const WebhookConfigSchema = z.object({
  path: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  secret: z.string().optional(),
});

export default definePlugin({
  name: 'http',
  version: '1.0.0',
  description: 'HTTP requests and webhook triggers',

  actions: [
    defineAction({
      name: 'request',
      description: 'Make an HTTP request',
      schema: HttpRequestSchema,
      async execute(ctx) {
        const config = HttpRequestSchema.parse(ctx.config);

        ctx.log(`${config.method} ${config.url}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout);

        try {
          const response = await fetch(config.url, {
            method: config.method,
            headers: {
              'Content-Type': 'application/json',
              ...config.headers,
            },
            body: config.body ? JSON.stringify(config.body) : undefined,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          const contentType = response.headers.get('content-type') ?? '';
          let data: unknown;

          if (contentType.includes('application/json')) {
            data = await response.json();
          } else {
            data = await response.text();
          }

          return {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers),
            data,
            ok: response.ok,
          };
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            throw new Error(`Request timed out after ${config.timeout}ms`);
          }
          throw err;
        }
      },
    }),

    defineAction({
      name: 'get',
      description: 'Make a GET request (shorthand)',
      async execute(ctx) {
        const url = ctx.config.url as string;
        const headers = (ctx.config.headers as Record<string, string>) ?? {};

        ctx.log(`GET ${url}`);

        const response = await fetch(url, { headers });
        const contentType = response.headers.get('content-type') ?? '';

        let data: unknown;
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return { status: response.status, data, ok: response.ok };
      },
    }),

    defineAction({
      name: 'post',
      description: 'Make a POST request (shorthand)',
      async execute(ctx) {
        const url = ctx.config.url as string;
        const body = ctx.config.body;
        const headers = (ctx.config.headers as Record<string, string>) ?? {};

        ctx.log(`POST ${url}`);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body ? JSON.stringify(body) : undefined,
        });

        const contentType = response.headers.get('content-type') ?? '';
        let data: unknown;
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return { status: response.status, data, ok: response.ok };
      },
    }),
  ],

  triggers: [
    defineTrigger({
      name: 'webhook',
      description: 'Trigger workflow on incoming webhook',
      schema: WebhookConfigSchema,
      async setup(config, _emit) {
        const parsed = WebhookConfigSchema.parse(config);

        // The webhook is registered with the gateway server
        // This returns a cleanup function
        console.log(`[http] Webhook registered at /webhook${parsed.path}`);

        return () => {
          console.log(`[http] Webhook unregistered: ${parsed.path}`);
        };
      },
    }),
  ],
});
