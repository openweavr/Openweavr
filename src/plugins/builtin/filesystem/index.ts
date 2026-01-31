import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';
import { readFile, writeFile, readdir, rename, copyFile, unlink, stat, mkdir } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

// File watchers registry for cleanup
const activeWatchers = new Map<string, { close: () => void }>();

const ReadSchema = z.object({
  path: z.string(),
  encoding: z.enum(['utf-8', 'base64', 'binary']).default('utf-8'),
  parse: z.enum(['text', 'json', 'yaml', 'auto']).default('auto'),
});

const WriteSchema = z.object({
  path: z.string(),
  content: z.string(),
  mode: z.enum(['write', 'append']).default('write'),
  createDirs: z.boolean().default(true),
});

const ListSchema = z.object({
  path: z.string(),
  pattern: z.string().optional(),
  recursive: z.boolean().default(false),
});

const MoveSchema = z.object({
  from: z.string(),
  to: z.string(),
});

const CopySchema = z.object({
  from: z.string(),
  to: z.string(),
});

const DeleteSchema = z.object({
  path: z.string(),
});

const ExistsSchema = z.object({
  path: z.string(),
});

const WatchSchema = z.object({
  path: z.string(),
  events: z.array(z.enum(['add', 'change', 'unlink'])).default(['add', 'change']),
  pattern: z.string().optional(),
  ignoreInitial: z.boolean().default(true),
});

export default definePlugin({
  name: 'filesystem',
  version: '1.0.0',
  description: 'File system operations - read, write, watch files and directories',

  actions: [
    defineAction({
      name: 'read',
      description: 'Read file contents',
      schema: ReadSchema,
      async execute(ctx) {
        const config = ReadSchema.parse(ctx.config);
        ctx.log(`Reading file: ${config.path}`);

        const content = await readFile(config.path, config.encoding === 'binary' ? undefined : config.encoding);

        // Auto-detect parse mode
        let parseMode = config.parse;
        if (parseMode === 'auto') {
          const ext = extname(config.path).toLowerCase();
          if (ext === '.json') parseMode = 'json';
          else if (ext === '.yaml' || ext === '.yml') parseMode = 'yaml';
          else parseMode = 'text';
        }

        let data: unknown = content;
        if (parseMode === 'json' && typeof content === 'string') {
          data = JSON.parse(content);
        } else if (parseMode === 'yaml' && typeof content === 'string') {
          data = parseYaml(content);
        }

        const stats = await stat(config.path);
        return {
          content: typeof content === 'string' ? content : content.toString('base64'),
          data,
          path: config.path,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        };
      },
    }),

    defineAction({
      name: 'write',
      description: 'Write or append to a file',
      schema: WriteSchema,
      async execute(ctx) {
        const config = WriteSchema.parse(ctx.config);
        ctx.log(`Writing to file: ${config.path} (mode: ${config.mode})`);
        ctx.log(`Content length: ${config.content?.length ?? 0} chars`);
        if (!config.content || config.content.length === 0) {
          ctx.log('WARNING: Empty content received!');
        }

        // Create directories if needed
        if (config.createDirs) {
          const dir = dirname(config.path);
          await mkdir(dir, { recursive: true });
        }

        if (config.mode === 'append') {
          const existing = existsSync(config.path)
            ? await readFile(config.path, 'utf-8')
            : '';
          await writeFile(config.path, existing + config.content, 'utf-8');
        } else {
          await writeFile(config.path, config.content, 'utf-8');
        }

        const stats = await stat(config.path);
        return {
          path: config.path,
          size: stats.size,
          written: true,
        };
      },
    }),

    defineAction({
      name: 'list',
      description: 'List directory contents',
      schema: ListSchema,
      async execute(ctx) {
        const config = ListSchema.parse(ctx.config);
        ctx.log(`Listing directory: ${config.path}`);

        const entries = await readdir(config.path, { withFileTypes: true });

        const files: Array<{
          name: string;
          path: string;
          type: 'file' | 'directory';
          size?: number;
        }> = [];

        for (const entry of entries) {
          const fullPath = join(config.path, entry.name);

          // Filter by pattern if provided
          if (config.pattern) {
            const regex = new RegExp(config.pattern);
            if (!regex.test(entry.name)) continue;
          }

          if (entry.isFile()) {
            const stats = await stat(fullPath);
            files.push({
              name: entry.name,
              path: fullPath,
              type: 'file',
              size: stats.size,
            });
          } else if (entry.isDirectory()) {
            files.push({
              name: entry.name,
              path: fullPath,
              type: 'directory',
            });
          }
        }

        return {
          path: config.path,
          count: files.length,
          files,
        };
      },
    }),

    defineAction({
      name: 'move',
      description: 'Move or rename a file',
      schema: MoveSchema,
      async execute(ctx) {
        const config = MoveSchema.parse(ctx.config);
        ctx.log(`Moving: ${config.from} → ${config.to}`);

        // Create target directory if needed
        await mkdir(dirname(config.to), { recursive: true });
        await rename(config.from, config.to);

        return {
          from: config.from,
          to: config.to,
          moved: true,
        };
      },
    }),

    defineAction({
      name: 'copy',
      description: 'Copy a file',
      schema: CopySchema,
      async execute(ctx) {
        const config = CopySchema.parse(ctx.config);
        ctx.log(`Copying: ${config.from} → ${config.to}`);

        // Create target directory if needed
        await mkdir(dirname(config.to), { recursive: true });
        await copyFile(config.from, config.to);

        const stats = await stat(config.to);
        return {
          from: config.from,
          to: config.to,
          size: stats.size,
          copied: true,
        };
      },
    }),

    defineAction({
      name: 'delete',
      description: 'Delete a file',
      schema: DeleteSchema,
      async execute(ctx) {
        const config = DeleteSchema.parse(ctx.config);
        ctx.log(`Deleting: ${config.path}`);

        await unlink(config.path);

        return {
          path: config.path,
          deleted: true,
        };
      },
    }),

    defineAction({
      name: 'exists',
      description: 'Check if a file or directory exists',
      schema: ExistsSchema,
      async execute(ctx) {
        const config = ExistsSchema.parse(ctx.config);

        const exists = existsSync(config.path);
        let type: 'file' | 'directory' | 'none' = 'none';
        let size: number | undefined;

        if (exists) {
          const stats = await stat(config.path);
          type = stats.isDirectory() ? 'directory' : 'file';
          size = stats.isFile() ? stats.size : undefined;
        }

        return {
          path: config.path,
          exists,
          type,
          size,
        };
      },
    }),
  ],

  triggers: [
    defineTrigger({
      name: 'watch',
      description: 'Watch for file changes in a directory',
      schema: WatchSchema,
      async setup(config, emit) {
        const parsed = WatchSchema.parse(config);

        // Dynamic import chokidar
        const { watch } = await import('chokidar');

        const watcherId = `${parsed.path}-${Date.now()}`;
        console.log(`[filesystem] Watching: ${parsed.path}`);

        const watcher = watch(parsed.path, {
          persistent: true,
          ignoreInitial: parsed.ignoreInitial,
          awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100,
          },
        });

        // Set up event handlers
        for (const event of parsed.events) {
          watcher.on(event, (path: string) => {
            // Filter by pattern if provided
            if (parsed.pattern) {
              const regex = new RegExp(parsed.pattern);
              if (!regex.test(basename(path))) return;
            }

            console.log(`[filesystem] ${event}: ${path}`);
            emit({
              type: `filesystem.${event}`,
              event,
              path,
              filename: basename(path),
              timestamp: new Date().toISOString(),
            });
          });
        }

        // Store for cleanup
        activeWatchers.set(watcherId, {
          close: () => watcher.close(),
        });

        // Return cleanup function
        return () => {
          console.log(`[filesystem] Stopping watch: ${parsed.path}`);
          watcher.close();
          activeWatchers.delete(watcherId);
        };
      },
    }),
  ],

  hooks: {
    async onUnload() {
      // Clean up all active watchers
      for (const [id, watcher] of activeWatchers) {
        watcher.close();
        console.log(`[filesystem] Cleanup: stopped watcher ${id}`);
      }
      activeWatchers.clear();
    },
  },
});
