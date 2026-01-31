import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WeavrPlugin } from './types.js';
import { PluginRegistry } from './registry.js';

export class PluginLoader {
  constructor(private registry: PluginRegistry) {}

  async loadFromDirectory(dir: string): Promise<WeavrPlugin[]> {
    const loaded: WeavrPlugin[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = join(dir, entry.name, 'index.js');
          try {
            const plugin = await this.loadPlugin(pluginPath);
            if (plugin) {
              loaded.push(plugin);
            }
          } catch (err) {
            console.warn(`Failed to load plugin from ${pluginPath}:`, err);
          }
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
          const pluginPath = join(dir, entry.name);
          try {
            const plugin = await this.loadPlugin(pluginPath);
            if (plugin) {
              loaded.push(plugin);
            }
          } catch (err) {
            console.warn(`Failed to load plugin from ${pluginPath}:`, err);
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    return loaded;
  }

  async loadPlugin(path: string): Promise<WeavrPlugin | null> {
    const url = pathToFileURL(path).href;
    const module = await import(url);

    const plugin: WeavrPlugin = module.default ?? module.plugin ?? module;

    if (!plugin.name || !plugin.version) {
      console.warn(`Invalid plugin at ${path}: missing name or version`);
      return null;
    }

    this.registry.register(plugin);

    if (plugin.hooks?.onLoad) {
      await plugin.hooks.onLoad();
    }

    return plugin;
  }

  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.registry.getPlugin(name);
    if (plugin?.hooks?.onUnload) {
      await plugin.hooks.onUnload();
    }
    this.registry.unregister(name);
  }
}
