/**
 * Model Registry
 *
 * Provides a unified catalog of all available LLM models from pi-ai
 * plus CLI-based models (ollama, llm CLI, claude CLI).
 */

import { getProviders, getModels } from '@mariozechner/pi-ai';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  supportsImages: boolean;
  supportsReasoning: boolean;
  cost?: {
    input: number;  // $/million tokens
    output: number;
  };
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  envVar?: string;
  authType: 'api_key' | 'oauth' | 'local' | 'cli' | 'aws' | 'gcloud';
  setupUrl?: string;
  models: ModelInfo[];
}

// Provider metadata
const PROVIDER_META: Record<string, Omit<ProviderInfo, 'models'>> = {
  'anthropic': {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models - excellent for coding, analysis, and creative tasks',
    envVar: 'ANTHROPIC_API_KEY',
    authType: 'api_key',
    setupUrl: 'https://console.anthropic.com/settings/keys',
  },
  'openai': {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models - versatile general-purpose AI',
    envVar: 'OPENAI_API_KEY',
    authType: 'api_key',
    setupUrl: 'https://platform.openai.com/api-keys',
  },
  'google': {
    id: 'google',
    name: 'Google Gemini',
    description: 'Gemini models - fast and multimodal',
    envVar: 'GEMINI_API_KEY',
    authType: 'api_key',
    setupUrl: 'https://aistudio.google.com/app/apikey',
  },
  'groq': {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference for open models',
    envVar: 'GROQ_API_KEY',
    authType: 'api_key',
    setupUrl: 'https://console.groq.com/keys',
  },
  'cerebras': {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'Fast inference on Cerebras hardware',
    envVar: 'CEREBRAS_API_KEY',
    authType: 'api_key',
    setupUrl: 'https://cloud.cerebras.ai/',
  },
  'xai': {
    id: 'xai',
    name: 'xAI',
    description: 'Grok models from xAI',
    envVar: 'XAI_API_KEY',
    authType: 'api_key',
    setupUrl: 'https://console.x.ai/',
  },
  'mistral': {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'European AI with strong multilingual support',
    envVar: 'MISTRAL_API_KEY',
    authType: 'api_key',
    setupUrl: 'https://console.mistral.ai/api-keys/',
  },
  'openrouter': {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access multiple providers through one API',
    envVar: 'OPENROUTER_API_KEY',
    authType: 'api_key',
    setupUrl: 'https://openrouter.ai/keys',
  },
  'azure-openai-responses': {
    id: 'azure-openai-responses',
    name: 'Azure OpenAI',
    description: 'OpenAI models on Azure infrastructure',
    envVar: 'AZURE_OPENAI_API_KEY',
    authType: 'api_key',
    setupUrl: 'https://portal.azure.com/',
  },
  'amazon-bedrock': {
    id: 'amazon-bedrock',
    name: 'Amazon Bedrock',
    description: 'Multiple foundation models on AWS',
    authType: 'aws',
    setupUrl: 'https://console.aws.amazon.com/bedrock/',
  },
  'google-vertex': {
    id: 'google-vertex',
    name: 'Google Vertex AI',
    description: 'Enterprise AI on Google Cloud',
    authType: 'gcloud',
    setupUrl: 'https://console.cloud.google.com/vertex-ai',
  },
  // CLI-based providers
  'ollama': {
    id: 'ollama',
    name: 'Ollama',
    description: 'Run open-source models locally',
    authType: 'local',
    setupUrl: 'https://ollama.ai/',
  },
  'claude-cli': {
    id: 'claude-cli',
    name: 'Claude CLI',
    description: 'Use Claude via the official CLI tool',
    authType: 'cli',
    setupUrl: 'https://claude.ai/download',
  },
  'llm-cli': {
    id: 'llm-cli',
    name: 'LLM CLI',
    description: 'Simon Willison\'s LLM CLI tool',
    authType: 'cli',
    setupUrl: 'https://llm.datasette.io/',
  },
};

// Common Ollama models
const OLLAMA_MODELS: ModelInfo[] = [
  { id: 'llama3.3', name: 'Llama 3.3 70B', provider: 'ollama', contextWindow: 128000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'llama3.2', name: 'Llama 3.2', provider: 'ollama', contextWindow: 128000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'llama3.2:1b', name: 'Llama 3.2 1B', provider: 'ollama', contextWindow: 128000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'llama3.2:3b', name: 'Llama 3.2 3B', provider: 'ollama', contextWindow: 128000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'llama3.1', name: 'Llama 3.1', provider: 'ollama', contextWindow: 128000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'llama3.1:70b', name: 'Llama 3.1 70B', provider: 'ollama', contextWindow: 128000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'mistral', name: 'Mistral 7B', provider: 'ollama', contextWindow: 32000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'mixtral', name: 'Mixtral 8x7B', provider: 'ollama', contextWindow: 32000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'codellama', name: 'Code Llama', provider: 'ollama', contextWindow: 16000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'deepseek-coder-v2', name: 'DeepSeek Coder V2', provider: 'ollama', contextWindow: 128000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder', provider: 'ollama', contextWindow: 32000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'gemma2', name: 'Gemma 2', provider: 'ollama', contextWindow: 8000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  { id: 'phi3', name: 'Phi 3', provider: 'ollama', contextWindow: 4000, maxTokens: 2048, supportsImages: false, supportsReasoning: false },
  { id: 'llava', name: 'LLaVA (Vision)', provider: 'ollama', contextWindow: 4096, maxTokens: 2048, supportsImages: true, supportsReasoning: false },
];

// CLI model entries (placeholder - actual model is selected at runtime)
const CLI_MODELS: Record<string, ModelInfo[]> = {
  'claude-cli': [
    { id: 'claude', name: 'Claude (via CLI)', provider: 'claude-cli', contextWindow: 200000, maxTokens: 8192, supportsImages: false, supportsReasoning: false },
  ],
  'llm-cli': [
    { id: 'default', name: 'Default Model', provider: 'llm-cli', contextWindow: 128000, maxTokens: 4096, supportsImages: false, supportsReasoning: false },
  ],
};

/**
 * Get all available providers with their models
 */
export function getAllProviders(): ProviderInfo[] {
  const providers: ProviderInfo[] = [];

  // Get providers from pi-ai
  try {
    const piAiProviders = getProviders();

    for (const providerId of piAiProviders) {
      const meta = PROVIDER_META[providerId];
      if (!meta) continue; // Skip unknown providers

      const piAiModels = getModels(providerId as any);
      const models: ModelInfo[] = piAiModels.map((m) => ({
        id: m.id,
        name: m.name,
        provider: providerId,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        supportsImages: m.input.includes('image'),
        supportsReasoning: m.reasoning,
        cost: m.cost ? {
          input: m.cost.input,
          output: m.cost.output,
        } : undefined,
      }));

      providers.push({
        ...meta,
        models,
      });
    }
  } catch (err) {
    console.error('Failed to load pi-ai providers:', err);
  }

  // Add Ollama (local)
  const ollamaMeta = PROVIDER_META['ollama'];
  if (ollamaMeta) {
    providers.push({
      ...ollamaMeta,
      models: OLLAMA_MODELS,
    });
  }

  // Add CLI providers
  for (const [cliProvider, models] of Object.entries(CLI_MODELS)) {
    const meta = PROVIDER_META[cliProvider];
    if (meta) {
      providers.push({
        ...meta,
        models,
      });
    }
  }

  return providers;
}

/**
 * Get models for a specific provider
 */
export function getModelsForProvider(providerId: string): ModelInfo[] {
  const providers = getAllProviders();
  const provider = providers.find((p) => p.id === providerId);
  return provider?.models ?? [];
}

/**
 * Get provider metadata
 */
export function getProviderMeta(providerId: string): Omit<ProviderInfo, 'models'> | undefined {
  return PROVIDER_META[providerId];
}

/**
 * Check if we have credentials for a provider (from env vars)
 */
export function hasProviderCredentials(providerId: string): boolean {
  const meta = PROVIDER_META[providerId];
  if (!meta) return false;

  switch (meta.authType) {
    case 'api_key':
      return meta.envVar ? !!process.env[meta.envVar] : false;
    case 'local':
    case 'cli':
      return true; // Always "available" - just need to check if tool is installed
    case 'aws':
      return !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
    case 'gcloud':
      return !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT);
    case 'oauth':
      return true; // OAuth is handled separately
    default:
      return false;
  }
}
