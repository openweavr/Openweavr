import type { WeavrPlugin, ActionDefinition, TriggerDefinition } from './types.js';

export class PluginRegistry {
  private plugins: Map<string, WeavrPlugin> = new Map();
  private actions: Map<string, ActionDefinition> = new Map();
  private triggers: Map<string, TriggerDefinition> = new Map();

  register(plugin: WeavrPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    this.plugins.set(plugin.name, plugin);

    for (const action of plugin.actions ?? []) {
      const fullName = `${plugin.name}.${action.name}`;
      this.actions.set(fullName, action);
    }

    for (const trigger of plugin.triggers ?? []) {
      const fullName = `${plugin.name}.${trigger.name}`;
      this.triggers.set(fullName, trigger);
    }
  }

  unregister(pluginName: string): void {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return;

    for (const action of plugin.actions ?? []) {
      this.actions.delete(`${pluginName}.${action.name}`);
    }

    for (const trigger of plugin.triggers ?? []) {
      this.triggers.delete(`${pluginName}.${trigger.name}`);
    }

    this.plugins.delete(pluginName);
  }

  getPlugin(name: string): WeavrPlugin | undefined {
    return this.plugins.get(name);
  }

  getAction(name: string): ActionDefinition | undefined {
    return this.actions.get(name);
  }

  getTrigger(name: string): TriggerDefinition | undefined {
    return this.triggers.get(name);
  }

  listPlugins(): WeavrPlugin[] {
    return Array.from(this.plugins.values());
  }

  listActions(): { plugin: string; action: ActionDefinition }[] {
    const result: { plugin: string; action: ActionDefinition }[] = [];
    for (const [fullName, action] of this.actions) {
      const [plugin] = fullName.split('.');
      result.push({ plugin, action });
    }
    return result;
  }

  listTriggers(): { plugin: string; trigger: TriggerDefinition }[] {
    const result: { plugin: string; trigger: TriggerDefinition }[] = [];
    for (const [fullName, trigger] of this.triggers) {
      const [plugin] = fullName.split('.');
      result.push({ plugin, trigger });
    }
    return result;
  }
}

export const globalRegistry = new PluginRegistry();
