import { z } from 'zod';

// Workflow Definition Schemas
export const StepConfigSchema = z.record(z.unknown());

export const StepSchema = z.object({
  id: z.string(),
  action: z.string(),
  config: StepConfigSchema.optional(),
  depends_on: z.array(z.string()).optional(),
  needs: z.array(z.string()).optional(), // Alias for depends_on
  retry: z.object({
    attempts: z.number().default(3),
    delay: z.number().default(1000),
  }).optional(),
  timeout: z.number().optional(),
}).transform((step) => ({
  ...step,
  // Merge needs into depends_on for backwards compatibility
  depends_on: step.depends_on ?? step.needs ?? [],
}));

export const TriggerSchema = z.object({
  type: z.string(),
  config: z.record(z.unknown()).optional(),
});

export const WorkflowSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  triggers: z.array(TriggerSchema).optional(),
  steps: z.array(StepSchema),
  env: z.record(z.string()).optional(),
});

export type Step = z.infer<typeof StepSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;

// Execution Types
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepResult {
  id: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
}

export interface WorkflowRun {
  id: string;
  workflowName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  triggerData?: unknown;
  steps: Map<string, StepResult>;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

// Plugin Types
export interface ActionContext {
  workflowName: string;
  runId: string;
  stepId: string;
  config: Record<string, unknown>;
  trigger?: unknown;
  steps: Record<string, unknown>;
  env: Record<string, string>;
  log: (message: string) => void;
}

export interface ActionDefinition {
  name: string;
  description?: string;
  schema?: z.ZodSchema;
  execute: (context: ActionContext) => Promise<unknown>;
}

export interface TriggerDefinition {
  name: string;
  description?: string;
  schema?: z.ZodSchema;
  setup?: (config: Record<string, unknown>, emit: (data: unknown) => void) => Promise<() => void>;
}

export interface AuthProvider {
  type: 'oauth2' | 'api_key' | 'basic';
  config: Record<string, unknown>;
}

export interface PluginHooks {
  onLoad?: () => Promise<void>;
  onUnload?: () => Promise<void>;
}

export interface WeavrPlugin {
  name: string;
  version: string;
  description?: string;
  triggers?: TriggerDefinition[];
  actions?: ActionDefinition[];
  auth?: AuthProvider;
  hooks?: PluginHooks;
}

// Gateway Types
export interface GatewayMessage {
  type: string;
  payload: unknown;
  id?: string;
  timestamp?: number;
}

export interface GatewayClient {
  id: string;
  socket: unknown;
  subscriptions: Set<string>;
}

// OAuth Token Types
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix timestamp in milliseconds
}

// Config Types
export interface WeavrConfig {
  server: {
    port: number;
    host: string;
  };
  workflowsDir: string;
  pluginsDir: string;
  logsDir: string;
  ai?: {
    provider?: 'anthropic' | 'openai' | 'ollama';
    model?: string;
    apiKey?: string;
    // OAuth authentication (for OpenAI with ChatGPT Plus/Team subscriptions)
    authMethod?: 'apikey' | 'oauth';
    oauth?: OAuthTokens;
  };
  webSearch?: {
    provider?: 'brave' | 'tavily';
    apiKey?: string;
  };
}

export const DEFAULT_CONFIG: WeavrConfig = {
  server: {
    port: 3847,
    host: 'localhost',
  },
  workflowsDir: 'workflows',
  pluginsDir: 'plugins',
  logsDir: 'logs',
};
