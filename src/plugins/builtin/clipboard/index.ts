import { definePlugin, defineAction } from '../../sdk/types.js';
import { z } from 'zod';

const WriteSchema = z.object({
  text: z.string(),
});

export default definePlugin({
  name: 'clipboard',
  version: '1.0.0',
  description: 'Clipboard read and write operations',

  actions: [
    defineAction({
      name: 'read',
      description: 'Read text from the clipboard',
      async execute(ctx) {
        ctx.log('Reading clipboard');

        // Dynamic import
        const clipboard = await import('clipboardy');
        const text = await clipboard.default.read();

        return {
          text,
          length: text.length,
        };
      },
    }),

    defineAction({
      name: 'write',
      description: 'Write text to the clipboard',
      schema: WriteSchema,
      async execute(ctx) {
        const config = WriteSchema.parse(ctx.config);
        ctx.log(`Writing ${config.text.length} chars to clipboard`);

        const clipboard = await import('clipboardy');
        await clipboard.default.write(config.text);

        return {
          written: true,
          length: config.text.length,
        };
      },
    }),
  ],
});
