import { definePlugin, defineAction } from '../../sdk/types.js';
import { z } from 'zod';

const ShowSchema = z.object({
  title: z.string(),
  message: z.string(),
  subtitle: z.string().optional(),
  sound: z.boolean().default(true),
  icon: z.string().optional(),
  timeout: z.number().optional(),
});

export default definePlugin({
  name: 'notification',
  version: '1.0.0',
  description: 'System notifications',

  actions: [
    defineAction({
      name: 'show',
      description: 'Show a system notification',
      schema: ShowSchema,
      async execute(ctx) {
        const config = ShowSchema.parse(ctx.config);
        ctx.log(`Notification: ${config.title}`);

        // Dynamic import to avoid issues if not installed
        const notifier = await import('node-notifier');

        return new Promise((resolve) => {
          notifier.default.notify(
            {
              title: config.title,
              message: config.message,
              subtitle: config.subtitle,
              sound: config.sound,
              icon: config.icon,
              timeout: config.timeout,
              wait: false,
            },
            (err: Error | null, response: string) => {
              if (err) {
                resolve({
                  success: false,
                  error: String(err),
                  title: config.title,
                });
              } else {
                resolve({
                  success: true,
                  title: config.title,
                  response: response,
                });
              }
            }
          );
        });
      },
    }),

    defineAction({
      name: 'success',
      description: 'Show a success notification',
      async execute(ctx) {
        const title = (ctx.config.title as string) ?? 'Success';
        const message = (ctx.config.message as string) ?? 'Operation completed successfully';
        ctx.log(`Success notification: ${title}`);

        const notifier = await import('node-notifier');

        return new Promise((resolve) => {
          notifier.default.notify(
            {
              title: `✅ ${title}`,
              message,
              sound: true,
            },
            (err: Error | null) => {
              resolve({ success: !err, title, message });
            }
          );
        });
      },
    }),

    defineAction({
      name: 'error',
      description: 'Show an error notification',
      async execute(ctx) {
        const title = (ctx.config.title as string) ?? 'Error';
        const message = (ctx.config.message as string) ?? 'An error occurred';
        ctx.log(`Error notification: ${title}`);

        const notifier = await import('node-notifier');

        return new Promise((resolve) => {
          notifier.default.notify(
            {
              title: `❌ ${title}`,
              message,
              sound: 'Basso',
            },
            (err: Error | null) => {
              resolve({ success: !err, title, message });
            }
          );
        });
      },
    }),
  ],
});
