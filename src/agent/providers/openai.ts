import type { AIProvider, CompletionOptions, CompletionResult } from './base.js';
import { AIProviderError } from './base.js';

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model = 'gpt-4o', baseUrl = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: options.maxTokens ?? 4096,
          temperature: options.temperature ?? 0.7,
          messages: options.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new AIProviderError(
          `OpenAI API error: ${response.status} ${JSON.stringify(error)}`,
          this.name
        );
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number };
      };

      return {
        content: data.choices[0]?.message?.content ?? '',
        usage: {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        },
      };
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError(
        `Failed to call OpenAI: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err instanceof Error ? err : undefined
      );
    }
  }
}
