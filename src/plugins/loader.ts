import { globalRegistry } from './sdk/registry.js';

// Import all built-in plugins
import httpPlugin from './builtin/http/index.js';
import cronPlugin from './builtin/cron/index.js';
import githubPlugin from './builtin/github/index.js';
import slackPlugin from './builtin/slack/index.js';
import discordPlugin from './builtin/discord/index.js';
import linearPlugin from './builtin/linear/index.js';
import notionPlugin from './builtin/notion/index.js';
import emailPlugin from './builtin/email/index.js';
import aiPlugin from './builtin/ai/index.js';
import jsonPlugin from './builtin/json/index.js';

// Local/system plugins
import filesystemPlugin from './builtin/filesystem/index.js';
import shellPlugin from './builtin/shell/index.js';
import notificationPlugin from './builtin/notification/index.js';
import clipboardPlugin from './builtin/clipboard/index.js';

// Messaging plugins
import telegramPlugin from './builtin/telegram/index.js';
import whatsappPlugin from './builtin/whatsapp/index.js';
import imessagePlugin from './builtin/imessage/index.js';

const builtinPlugins = [
  httpPlugin,
  cronPlugin,
  githubPlugin,
  slackPlugin,
  discordPlugin,
  linearPlugin,
  notionPlugin,
  emailPlugin,
  aiPlugin,
  jsonPlugin,
  // Local/system plugins
  filesystemPlugin,
  shellPlugin,
  notificationPlugin,
  clipboardPlugin,
  // Messaging plugins
  telegramPlugin,
  whatsappPlugin,
  imessagePlugin,
];

let loaded = false;

export function loadBuiltinPlugins(): void {
  if (loaded) return;

  for (const plugin of builtinPlugins) {
    try {
      globalRegistry.register(plugin);
    } catch (err) {
      console.error(`Failed to load plugin ${plugin.name}:`, err);
    }
  }

  loaded = true;
}

export function getLoadedPluginCount(): number {
  return globalRegistry.listPlugins().length;
}
