import type {
  WeavrPlugin,
  ActionDefinition,
  TriggerDefinition,
  ActionContext,
  AuthProvider,
  PluginHooks,
} from '../../types/index.js';

export type {
  WeavrPlugin,
  ActionDefinition,
  TriggerDefinition,
  ActionContext,
  AuthProvider,
  PluginHooks,
};

export interface PluginBuilder {
  name: string;
  version: string;
  description?: string;
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  auth?: AuthProvider;
  hooks?: PluginHooks;
}

export function definePlugin(config: {
  name: string;
  version: string;
  description?: string;
  triggers?: TriggerDefinition[];
  actions?: ActionDefinition[];
  auth?: AuthProvider;
  hooks?: PluginHooks;
}): WeavrPlugin {
  return {
    name: config.name,
    version: config.version,
    description: config.description,
    triggers: config.triggers ?? [],
    actions: config.actions ?? [],
    auth: config.auth,
    hooks: config.hooks,
  };
}

export function defineAction(config: ActionDefinition): ActionDefinition {
  return config;
}

export function defineTrigger(config: TriggerDefinition): TriggerDefinition {
  return config;
}
