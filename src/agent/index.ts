export * from './providers/index.js';
export { WorkflowGenerator, type WorkflowGeneratorOptions } from './workflow-gen.js';

import type { AIProvider } from './providers/index.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { OllamaProvider } from './providers/ollama.js';
import type { WeavrConfig } from '../types/index.js';

export function createProvider(config: WeavrConfig): AIProvider | null {
  if (!config.ai?.provider) {
    return null;
  }

  switch (config.ai.provider) {
    case 'anthropic':
      if (!config.ai.apiKey) {
        throw new Error('Anthropic API key required');
      }
      return new AnthropicProvider(config.ai.apiKey, config.ai.model);

    case 'openai':
      if (!config.ai.apiKey) {
        throw new Error('OpenAI API key required');
      }
      return new OpenAIProvider(config.ai.apiKey, config.ai.model);

    case 'ollama':
      return new OllamaProvider(config.ai.model);

    default:
      return null;
  }
}
