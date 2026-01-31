import { definePlugin, defineAction } from '../../sdk/types.js';
import { z } from 'zod';

const CompletionSchema = z.object({
  prompt: z.string(),
  system: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

function getAnthropicKey(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string | undefined {
  return (ctx.config.anthropicApiKey as string) ?? ctx.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
}

function getOpenAIKey(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string | undefined {
  return (ctx.config.openaiApiKey as string) ?? ctx.env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
}

export default definePlugin({
  name: 'ai',
  version: '1.0.0',
  description: 'AI/LLM actions for text generation and processing',

  actions: [
    defineAction({
      name: 'complete',
      description: 'Generate text completion using an AI model',
      schema: CompletionSchema,
      async execute(ctx) {
        const config = CompletionSchema.parse(ctx.config);
        const anthropicKey = getAnthropicKey(ctx);
        const openaiKey = getOpenAIKey(ctx);

        if (anthropicKey) {
          ctx.log('Using Anthropic for completion');
          const model = config.model ?? 'claude-sonnet-4-20250514';

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model,
              max_tokens: config.maxTokens ?? 1024,
              system: config.system,
              messages: [{ role: 'user', content: config.prompt }],
            }),
          });

          if (!response.ok) {
            throw new Error(`Anthropic API error: ${response.status}`);
          }

          const data = await response.json() as { content: Array<{ text: string }> };
          return {
            text: data.content[0]?.text ?? '',
            model,
            provider: 'anthropic',
          };
        } else if (openaiKey) {
          ctx.log('Using OpenAI for completion');
          const model = config.model ?? 'gpt-4o';

          const messages = [];
          if (config.system) {
            messages.push({ role: 'system', content: config.system });
          }
          messages.push({ role: 'user', content: config.prompt });

          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openaiKey}`,
            },
            body: JSON.stringify({
              model,
              max_tokens: config.maxTokens ?? 1024,
              temperature: config.temperature ?? 0.7,
              messages,
            }),
          });

          if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status}`);
          }

          const data = await response.json() as { choices: Array<{ message: { content: string } }> };
          return {
            text: data.choices[0]?.message?.content ?? '',
            model,
            provider: 'openai',
          };
        } else {
          throw new Error('No AI API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
        }
      },
    }),

    defineAction({
      name: 'summarize',
      description: 'Summarize text using AI',
      async execute(ctx) {
        const text = ctx.config.text as string;
        const maxLength = (ctx.config.maxLength as number) ?? 200;
        const style = (ctx.config.style as string) ?? 'concise';

        const prompt = `Summarize the following text in a ${style} manner. Keep the summary under ${maxLength} words.

Text:
${text}

Summary:`;

        // Reuse the complete action internally
        ctx.config.prompt = prompt;
        ctx.config.system = 'You are a helpful assistant that summarizes text clearly and accurately.';

        const anthropicKey = getAnthropicKey(ctx);
        const openaiKey = getOpenAIKey(ctx);

        if (!anthropicKey && !openaiKey) {
          throw new Error('No AI API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
        }

        // Make the API call
        const apiKey = anthropicKey ?? openaiKey!;
        const isAnthropic = Boolean(anthropicKey);

        if (isAnthropic) {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 512,
              system: 'You are a helpful assistant that summarizes text clearly and accurately.',
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          const data = await response.json() as { content: Array<{ text: string }> };
          return { summary: data.content[0]?.text ?? '' };
        } else {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_tokens: 512,
              messages: [
                { role: 'system', content: 'You are a helpful assistant that summarizes text clearly and accurately.' },
                { role: 'user', content: prompt },
              ],
            }),
          });

          const data = await response.json() as { choices: Array<{ message: { content: string } }> };
          return { summary: data.choices[0]?.message?.content ?? '' };
        }
      },
    }),

    defineAction({
      name: 'extract',
      description: 'Extract structured data from text using AI',
      async execute(ctx) {
        const text = ctx.config.text as string;
        const schema = ctx.config.schema as Record<string, string>;

        const schemaDescription = Object.entries(schema)
          .map(([key, desc]) => `- ${key}: ${desc}`)
          .join('\n');

        const prompt = `Extract the following information from the text and return as JSON:

Fields to extract:
${schemaDescription}

Text:
${text}

Return ONLY valid JSON, no other text.`;

        const anthropicKey = getAnthropicKey(ctx);
        const openaiKey = getOpenAIKey(ctx);

        if (!anthropicKey && !openaiKey) {
          throw new Error('No AI API key found.');
        }

        const apiKey = anthropicKey ?? openaiKey!;
        const isAnthropic = Boolean(anthropicKey);

        let result: string;

        if (isAnthropic) {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 1024,
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          const data = await response.json() as { content: Array<{ text: string }> };
          result = data.content[0]?.text ?? '{}';
        } else {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_tokens: 1024,
              response_format: { type: 'json_object' },
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          const data = await response.json() as { choices: Array<{ message: { content: string } }> };
          result = data.choices[0]?.message?.content ?? '{}';
        }

        try {
          return JSON.parse(result);
        } catch {
          return { raw: result };
        }
      },
    }),

    defineAction({
      name: 'classify',
      description: 'Classify text into categories using AI',
      async execute(ctx) {
        const text = ctx.config.text as string;
        const categories = ctx.config.categories as string[];

        const prompt = `Classify the following text into one of these categories: ${categories.join(', ')}

Text: ${text}

Return ONLY the category name, nothing else.`;

        const anthropicKey = getAnthropicKey(ctx);
        const openaiKey = getOpenAIKey(ctx);

        if (!anthropicKey && !openaiKey) {
          throw new Error('No AI API key found.');
        }

        const apiKey = anthropicKey ?? openaiKey!;
        const isAnthropic = Boolean(anthropicKey);

        let category: string;

        if (isAnthropic) {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 100,
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          const data = await response.json() as { content: Array<{ text: string }> };
          category = data.content[0]?.text?.trim() ?? 'unknown';
        } else {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_tokens: 100,
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          const data = await response.json() as { choices: Array<{ message: { content: string } }> };
          category = data.choices[0]?.message?.content?.trim() ?? 'unknown';
        }

        return {
          category,
          confidence: categories.includes(category) ? 'high' : 'low',
        };
      },
    }),
  ],
});
