export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AIProvider {
  name: string;
  complete(options: CompletionOptions): Promise<CompletionResult>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}
