import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from './registry.js';
import { definePlugin, defineAction, defineTrigger } from './types.js';

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('should register a plugin', () => {
    const plugin = definePlugin({
      name: 'test-plugin',
      version: '1.0.0',
    });

    registry.register(plugin);

    expect(registry.getPlugin('test-plugin')).toBe(plugin);
    expect(registry.listPlugins()).toHaveLength(1);
  });

  it('should throw when registering duplicate plugin', () => {
    const plugin = definePlugin({
      name: 'test-plugin',
      version: '1.0.0',
    });

    registry.register(plugin);

    expect(() => registry.register(plugin)).toThrow('already registered');
  });

  it('should register and retrieve actions', () => {
    const action = defineAction({
      name: 'greet',
      execute: async (ctx) => ({ message: `Hello, ${ctx.config.name}` }),
    });

    const plugin = definePlugin({
      name: 'greeting',
      version: '1.0.0',
      actions: [action],
    });

    registry.register(plugin);

    const retrieved = registry.getAction('greeting.greet');
    expect(retrieved).toBe(action);
  });

  it('should register and retrieve triggers', () => {
    const trigger = defineTrigger({
      name: 'webhook',
      setup: async () => () => {},
    });

    const plugin = definePlugin({
      name: 'http',
      version: '1.0.0',
      triggers: [trigger],
    });

    registry.register(plugin);

    const retrieved = registry.getTrigger('http.webhook');
    expect(retrieved).toBe(trigger);
  });

  it('should unregister a plugin', () => {
    const plugin = definePlugin({
      name: 'temp-plugin',
      version: '1.0.0',
      actions: [
        defineAction({
          name: 'temp-action',
          execute: async () => ({}),
        }),
      ],
    });

    registry.register(plugin);
    expect(registry.getPlugin('temp-plugin')).toBeDefined();
    expect(registry.getAction('temp-plugin.temp-action')).toBeDefined();

    registry.unregister('temp-plugin');

    expect(registry.getPlugin('temp-plugin')).toBeUndefined();
    expect(registry.getAction('temp-plugin.temp-action')).toBeUndefined();
  });

  it('should list all actions with plugin info', () => {
    const plugin = definePlugin({
      name: 'multi',
      version: '1.0.0',
      actions: [
        defineAction({ name: 'action1', execute: async () => ({}) }),
        defineAction({ name: 'action2', execute: async () => ({}) }),
      ],
    });

    registry.register(plugin);

    const actions = registry.listActions();
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.plugin === 'multi')).toBe(true);
  });
});
