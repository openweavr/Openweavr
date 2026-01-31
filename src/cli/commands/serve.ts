import chalk from 'chalk';
import { createGatewayServer } from '../../gateway/server.js';
import { loadConfig, ensureConfigDir } from '../../config/index.js';
import { PluginRegistry } from '../../plugins/sdk/registry.js';
import { PluginLoader } from '../../plugins/sdk/loader.js';
import { PLUGINS_DIR } from '../../config/index.js';
import { loadBuiltinPlugins, getLoadedPluginCount } from '../../plugins/loader.js';

interface ServeOptions {
  port: string;
  host: string;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  console.log(chalk.cyan('\n🚀 Starting Weavr gateway...\n'));

  await ensureConfigDir();

  const config = await loadConfig();
  config.server.port = parseInt(options.port, 10);
  config.server.host = options.host;

  // Load built-in plugins
  loadBuiltinPlugins();
  console.log(chalk.green(`✓ Loaded ${getLoadedPluginCount()} built-in plugin(s)`));

  // Load custom plugins from user directory
  const registry = new PluginRegistry();
  const loader = new PluginLoader(registry);

  try {
    const plugins = await loader.loadFromDirectory(PLUGINS_DIR);
    if (plugins.length > 0) {
      console.log(chalk.green(`✓ Loaded ${plugins.length} custom plugin(s)`));
      for (const plugin of plugins) {
        console.log(chalk.dim(`  - ${plugin.name}@${plugin.version}`));
      }
    }
  } catch {
    // No custom plugins - that's fine
  }

  // Start server
  const server = createGatewayServer(config);
  await server.start();

  console.log(chalk.green('\n✓ Gateway is ready\n'));
  console.log(chalk.dim('Press Ctrl+C to stop\n'));

  // Handle shutdown
  const shutdown = async () => {
    console.log(chalk.yellow('\n\nShutting down...'));
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
