import { globalRegistry } from './sdk/registry.js';
import { MCPManager } from '../mcp/index.js';

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

// Global MCP manager - initialized on startup, shared with agents
let globalMCPManager: MCPManager | null = null;

// Default MCP servers that should always be available
// Note: Users can add MCP servers in ~/.weavr/config.yaml
// The web search is handled by built-in DuckDuckGo fallback (no MCP needed)
const DEFAULT_MCP_SERVERS: Array<{ name: string; config: { command: string; args: string[]; timeout?: number } }> = [
  // No default MCP servers - web search uses built-in DuckDuckGo fallback
  // Users can add their own MCP servers in config
];

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

  console.log('[plugins] Initializing plugins and MCP servers...');

  // Initialize MCP servers first (so they're ready for plugins/agents)
  try {
    await initializeMCPServers(broadcast, console.log);
  } catch (err) {
    console.error('[plugins] MCP initialization failed:', err);
  }

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

// Get the global MCP manager (for use by agents)
export function getGlobalMCPManager(): MCPManager | null {
  return globalMCPManager;
}

// Initialize MCP servers on startup
async function initializeMCPServers(
  broadcast: (channel: string, message: { type: string; payload: unknown }) => void,
  log: (msg: string) => void
): Promise<void> {
  log('[mcp] Initializing MCP servers...');
  broadcast('*', { type: 'mcp:initializing', payload: {} });

  globalMCPManager = new MCPManager(log);

  // First load user-configured servers from config
  try {
    await globalMCPManager.loadFromConfig();
  } catch (err) {
    log(`[mcp] Failed to load config: ${String(err)}`);
  }

  // Check which default servers are already configured
  const existingServers = globalMCPManager.getServers();
  const existingTools = existingServers.size > 0
    ? await globalMCPManager.getAllTools()
    : [];

  // Start default MCP servers if not already configured
  for (const defaultServer of DEFAULT_MCP_SERVERS) {
    // Check if we already have a server providing similar tools
    const hasSearchTool = existingTools.some(t =>
      t.name.includes('search') || t.name.includes('web')
    );

    if (defaultServer.name === 'web-search' && hasSearchTool) {
      log(`[mcp] Skipping ${defaultServer.name} - already have search tools configured`);
      continue;
    }

    if (existingServers.has(defaultServer.name)) {
      log(`[mcp] Skipping ${defaultServer.name} - already configured`);
      continue;
    }

    log(`[mcp] Starting default MCP server: ${defaultServer.name}...`);
    broadcast('*', { type: 'mcp:server:starting', payload: { name: defaultServer.name } });

    try {
      await globalMCPManager.connectServer(defaultServer.name, defaultServer.config);
      log(`[mcp] ${defaultServer.name} connected successfully`);
      broadcast('*', { type: 'mcp:server:connected', payload: { name: defaultServer.name } });
    } catch (err) {
      log(`[mcp] Failed to start ${defaultServer.name}: ${String(err)}`);
      broadcast('*', { type: 'mcp:server:failed', payload: { name: defaultServer.name, error: String(err) } });
    }
  }

  const serverCount = globalMCPManager.getServers().size;
  const allTools = serverCount > 0 ? await globalMCPManager.getAllTools() : [];

  log(`[mcp] Initialization complete: ${serverCount} server(s), ${allTools.length} tool(s) available`);
  broadcast('*', {
    type: 'mcp:initialized',
    payload: {
      servers: serverCount,
      tools: allTools.map(t => ({ name: t.name, server: t.server })),
    }
  });
}
