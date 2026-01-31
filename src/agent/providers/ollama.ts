import type { AIProvider, CompletionOptions, CompletionResult } from './base.js';
import { AIProviderError } from './base.js';

export class OllamaProvider implements AIProvider {
  name = 'ollama';
  private model: string;
  private baseUrl: string;

  constructor(model = 'llama3.2', baseUrl = 'http://localhost:11434') {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: options.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens ?? 4096,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text().catch(() => '');
        throw new AIProviderError(
          `Ollama API error: ${response.status} ${error}`,
          this.name
        );
      }

      const data = (await response.json()) as {
        message: { content: string };
        eval_count?: number;
        prompt_eval_count?: number;
      };

      return {
        content: data.message?.content ?? '',
        usage: data.eval_count
          ? {
              inputTokens: data.prompt_eval_count ?? 0,
              outputTokens: data.eval_count,
            }
          : undefined,
      };
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError(
        `Failed to call Ollama: ${err instanceof Error ? err.message : String(err)}`,
        this.name,
        err instanceof Error ? err : undefined
      );
    }
  }
}
