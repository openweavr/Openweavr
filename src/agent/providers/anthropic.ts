import type { AIProvider, CompletionOptions, CompletionResult } from './base.js';
import { AIProviderError } from './base.js';

export class AnthropicProvider implements AIProvider {
  name = 'anthropic';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const systemMessage = options.messages.find((m) => m.role === 'system');
    const otherMessages = options.messages.filter((m) => m.role !== 'system');

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: options.maxTokens ?? 4096,
          system: systemMessage?.content,
          messages: otherMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new AIProviderError(
          `Anthropic API error: ${response.status} ${JSON.stringify(error)}`,
          this.name
        );
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };

      const textContent = data.content.find((c) => c.type === 'text');

      return {
        content: textContent?.text ?? '',
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        },
      };
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError(
        `Failed to call Anthropic: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err instanceof Error ? err : undefined
      );
    }
  }
}
