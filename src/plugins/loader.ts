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
import whatsappPlugin, { setWhatsAppBroadcast } from './builtin/whatsapp/index.js';
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
let initialized = false;

// Global broadcast function for plugins to use
let globalBroadcast: ((channel: string, message: { type: string; payload: unknown }) => void) | null = null;

export function setGlobalBroadcast(fn: (channel: string, message: { type: string; payload: unknown }) => void): void {
  globalBroadcast = fn;
  // Also set it for WhatsApp plugin
  setWhatsAppBroadcast(fn);
}

export function getGlobalBroadcast(): ((channel: string, message: { type: string; payload: unknown }) => void) | null {
  return globalBroadcast;
}

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

// Initialize all plugins by calling their onLoad hooks
// This should be called after the gateway server starts and broadcast is available
export async function initializePlugins(
  broadcast: (channel: string, message: { type: string; payload: unknown }) => void
): Promise<void> {
  if (initialized) return;

  // Set the global broadcast function
  setGlobalBroadcast(broadcast);

  console.log('[plugins] Initializing plugins...');

  // Broadcast that initialization is starting
  broadcast('*', { type: 'plugins:initializing', payload: { plugins: builtinPlugins.map(p => p.name) } });

  const results: Array<{ name: string; status: 'success' | 'failed' | 'skipped'; error?: string }> = [];

  for (const plugin of builtinPlugins) {
    if (plugin.hooks?.onLoad) {
      try {
        console.log(`[plugins] Initializing ${plugin.name}...`);
        broadcast('*', { type: 'plugin:initializing', payload: { name: plugin.name } });

        await plugin.hooks.onLoad();

        console.log(`[plugins] ${plugin.name} initialized successfully`);
        broadcast('*', { type: 'plugin:initialized', payload: { name: plugin.name, status: 'success' } });
        results.push({ name: plugin.name, status: 'success' });
      } catch (err) {
        const errorMsg = String(err);
        console.error(`[plugins] Failed to initialize ${plugin.name}:`, err);
        broadcast('*', { type: 'plugin:initialized', payload: { name: plugin.name, status: 'failed', error: errorMsg } });
        results.push({ name: plugin.name, status: 'failed', error: errorMsg });
      }
    } else {
      results.push({ name: plugin.name, status: 'skipped' });
    }
  }

  initialized = true;

  // Broadcast that initialization is complete
  broadcast('*', { type: 'plugins:initialized', payload: { results } });
  console.log('[plugins] All plugins initialized');
}

export function getLoadedPluginCount(): number {
  return globalRegistry.listPlugins().length;
}

export function isPluginsInitialized(): boolean {
  return initialized;
}
