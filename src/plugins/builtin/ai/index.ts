import { definePlugin, defineAction } from '../../sdk/types.js';
import { z } from 'zod';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getGlobalMCPManager } from '../../loader.js';
import { refreshAccessToken, isTokenExpired, type OAuthTokens } from '../../../auth/openai-oauth.js';
const execAsync = promisify(exec);

// Token usage tracking
interface UsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  lastUpdated: string;
}

let usageStats: UsageStats = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalRequests: 0,
  lastUpdated: new Date().toISOString(),
};

// Export for API access
export function getUsageStats(): UsageStats {
  return { ...usageStats };
}

// Export AI config for stats endpoint
export { type AIConfig };
export { getGlobalAIConfig };

// Helper to track usage from API responses (exported for use by other modules)
export function trackUsage(inputTokens: number, outputTokens: number): void {
  usageStats.totalInputTokens += inputTokens;
  usageStats.totalOutputTokens += outputTokens;
  usageStats.totalRequests += 1;
  usageStats.lastUpdated = new Date().toISOString();
}

// Helper to sleep for a given duration
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse retry-after from error message or headers
function parseRetryAfter(response: Response, errorBody?: string): number {
  // Check Retry-After header first
  const retryAfterHeader = response.headers.get('retry-after');
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }

  // Try to parse from error message (OpenAI format: "Please try again in 938ms")
  if (errorBody) {
    const msMatch = errorBody.match(/try again in (\d+)ms/i);
    if (msMatch) return parseInt(msMatch[1], 10);

    const secMatch = errorBody.match(/try again in (\d+(?:\.\d+)?)\s*(?:s|sec|seconds)/i);
    if (secMatch) return parseFloat(secMatch[1]) * 1000;
  }

  return 0;
}

// Helper to fetch with timeout and retry on rate limits
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 60000,
  maxRetries = 3,
  logFn?: (msg: string) => void
): Promise<Response> {
  let lastError: Error | null = null;
  let baseDelay = 1000; // Start with 1 second

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      // Check for rate limit errors (429) or server errors (5xx)
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        const errorBody = await response.text();

        if (attempt < maxRetries) {
          // Calculate delay: use retry-after if available, otherwise exponential backoff
          let delay = parseRetryAfter(response, errorBody);
          if (delay === 0) {
            delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000; // Exponential backoff with jitter
          }

          const reason = response.status === 429 ? 'rate limited' : `server error ${response.status}`;
          logFn?.(`API ${reason}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);

          await sleep(delay);
          continue;
        }

        // Max retries exceeded, throw with context
        throw new Error(`API error after ${maxRetries} retries: ${response.status} - ${errorBody.slice(0, 200)}`);
      }

      return response;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err as Error;

      // Don't retry on abort (timeout) or non-retryable errors
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }

      // Retry on network errors
      if (attempt < maxRetries && (err as Error).message?.includes('fetch')) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        logFn?.(`Network error, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }

  throw lastError ?? new Error('Request failed after retries');
}

// CLI-based AI execution
interface CLIResult {
  text: string;
  provider: string;
  model: string;
}

async function executeClaudeCLI(prompt: string, system?: string): Promise<CLIResult> {
  // Write prompt to temp file to handle special characters
  const tempFile = join(tmpdir(), `weavr-prompt-${Date.now()}.txt`);
  try {
    writeFileSync(tempFile, prompt, 'utf-8');

    // Use claude CLI with --print flag for non-interactive mode
    let command = `cat "${tempFile}" | claude --print`;
    if (system) {
      command = `cat "${tempFile}" | claude --print --system "${system.replace(/"/g, '\\"')}"`;
    }

    const { stdout } = await execAsync(command, {
      timeout: 120000, // 2 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    return {
      text: stdout.trim(),
      provider: 'claude-cli',
      model: 'claude',
    };
  } finally {
    try { unlinkSync(tempFile); } catch { /* ignore */ }
  }
}

async function executeOllama(prompt: string, model = 'llama3.2', system?: string): Promise<CLIResult> {
  const tempFile = join(tmpdir(), `weavr-prompt-${Date.now()}.txt`);
  try {
    writeFileSync(tempFile, prompt, 'utf-8');

    let command = `cat "${tempFile}" | ollama run ${model}`;
    if (system) {
      // Ollama supports system prompt via --system flag
      command = `cat "${tempFile}" | ollama run ${model} --system "${system.replace(/"/g, '\\"')}"`;
    }

    const { stdout } = await execAsync(command, {
      timeout: 180000, // 3 minute timeout for local models
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      text: stdout.trim(),
      provider: 'ollama',
      model,
    };
  } finally {
    try { unlinkSync(tempFile); } catch { /* ignore */ }
  }
}

async function executeLLMCLI(prompt: string, model?: string, system?: string): Promise<CLIResult> {
  const tempFile = join(tmpdir(), `weavr-prompt-${Date.now()}.txt`);
  try {
    writeFileSync(tempFile, prompt, 'utf-8');

    // llm CLI by Simon Willison
    let command = `cat "${tempFile}" | llm`;
    if (model) {
      command += ` -m ${model}`;
    }
    if (system) {
      command += ` -s "${system.replace(/"/g, '\\"')}"`;
    }

    const { stdout } = await execAsync(command, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      text: stdout.trim(),
      provider: 'llm-cli',
      model: model ?? 'default',
    };
  } finally {
    try { unlinkSync(tempFile); } catch { /* ignore */ }
  }
}

// Check which CLI tools are available
async function checkCLIAvailability(): Promise<{ claude: boolean; ollama: boolean; llm: boolean }> {
  const checks = await Promise.allSettled([
    execAsync('which claude'),
    execAsync('which ollama'),
    execAsync('which llm'),
  ]);

  return {
    claude: checks[0].status === 'fulfilled',
    ollama: checks[1].status === 'fulfilled',
    llm: checks[2].status === 'fulfilled',
  };
}

async function executeCLI(prompt: string, config: AIConfig, system?: string): Promise<CLIResult> {
  const cliProvider = config.cliProvider ?? 'auto';
  const cliModel = config.cliModel;

  if (cliProvider === 'claude') {
    return executeClaudeCLI(prompt, system);
  } else if (cliProvider === 'ollama') {
    return executeOllama(prompt, cliModel ?? 'llama3.2', system);
  } else if (cliProvider === 'llm') {
    return executeLLMCLI(prompt, cliModel, system);
  }

  // Auto-detect available CLI
  const available = await checkCLIAvailability();

  if (available.claude) {
    return executeClaudeCLI(prompt, system);
  } else if (available.ollama) {
    return executeOllama(prompt, cliModel ?? 'llama3.2', system);
  } else if (available.llm) {
    return executeLLMCLI(prompt, cliModel, system);
  }

  throw new Error('No CLI AI tool available. Install claude, ollama, or llm CLI.');
}

const CompletionSchema = z.object({
  prompt: z.string(),
  system: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

interface AIConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  // OAuth authentication (sign in with OpenAI account)
  authMethod?: 'apikey' | 'oauth';
  oauth?: OAuthTokens;
  // CLI-based AI options (for users without API keys)
  useCLI?: boolean;
  cliProvider?: 'claude' | 'ollama' | 'llm' | 'auto';
  cliModel?: string;
}

interface WebSearchConfig {
  provider?: 'brave' | 'tavily';
  apiKey?: string;
}

interface GlobalConfig {
  ai: AIConfig;
  webSearch: WebSearchConfig;
}

// Cache for config to avoid reading file on every action
let cachedConfig: GlobalConfig | null = null;
let configLastRead = 0;
const CONFIG_CACHE_MS = 5000; // Re-read config every 5 seconds

function getGlobalConfig(): GlobalConfig {
  const now = Date.now();
  if (cachedConfig && now - configLastRead < CONFIG_CACHE_MS) {
    return cachedConfig;
  }

  try {
    const configPath = join(homedir(), '.weavr', 'config.yaml');
    const content = readFileSync(configPath, 'utf-8');
    const config = parseYaml(content) as { ai?: AIConfig; webSearch?: WebSearchConfig };
    cachedConfig = {
      ai: config.ai ?? {},
      webSearch: config.webSearch ?? {},
    };
    configLastRead = now;
    return cachedConfig;
  } catch {
    cachedConfig = { ai: {}, webSearch: {} };
    configLastRead = now;
    return cachedConfig;
  }
}

function getGlobalAIConfig(): AIConfig {
  return getGlobalConfig().ai;
}

function getWebSearchApiKey(): { brave?: string; tavily?: string } {
  const config = getGlobalConfig().webSearch;
  // Config takes precedence, then environment variables
  return {
    brave: config.apiKey && config.provider === 'brave' ? config.apiKey : process.env.BRAVE_API_KEY,
    tavily: config.apiKey && config.provider === 'tavily' ? config.apiKey : process.env.TAVILY_API_KEY,
  };
}

function getAnthropicKey(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string | undefined {
  const globalConfig = getGlobalAIConfig();
  // Check if global config uses Anthropic
  if (globalConfig.provider === 'anthropic' && globalConfig.apiKey) {
    return globalConfig.apiKey;
  }
  return (ctx.config.anthropicApiKey as string) ?? ctx.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
}

function getOpenAIKey(ctx: { env: Record<string, string>; config: Record<string, unknown> }): string | undefined {
  const globalConfig = getGlobalAIConfig();
  // Check if global config has an API key (regardless of authMethod - user might have both OAuth and API key)
  if (globalConfig.provider === 'openai' && globalConfig.apiKey) {
    return globalConfig.apiKey;
  }
  return (ctx.config.openaiApiKey as string) ?? ctx.env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
}

// Get OpenAI OAuth access token, refreshing if expired
async function getOpenAIOAuthToken(logFn?: (msg: string) => void): Promise<string | undefined> {
  const globalConfig = getGlobalAIConfig();

  if (globalConfig.provider !== 'openai' || globalConfig.authMethod !== 'oauth' || !globalConfig.oauth) {
    return undefined;
  }

  const tokens = globalConfig.oauth;

  // Check if token is expired and needs refresh
  if (isTokenExpired(tokens)) {
    if (!tokens.refreshToken) {
      logFn?.('OAuth access token expired and no refresh token available');
      return undefined;
    }

    logFn?.('OAuth access token expired, refreshing...');

    try {
      const newTokens = await refreshAccessToken(tokens.refreshToken);

      // Update the config file with new tokens
      const configPath = join(homedir(), '.weavr', 'config.yaml');
      const content = readFileSync(configPath, 'utf-8');
      const config = parseYaml(content) as { ai?: AIConfig };

      if (config.ai) {
        config.ai.oauth = newTokens;
        writeFileSync(configPath, stringifyYaml(config), 'utf-8');

        // Invalidate cache so next read gets fresh tokens
        cachedConfig = null;
      }

      logFn?.('OAuth token refreshed successfully');
      return newTokens.accessToken;
    } catch (err) {
      logFn?.(`Failed to refresh OAuth token: ${String(err)}`);
      return undefined;
    }
  }

  return tokens.accessToken;
}

function getConfiguredModel(): string | undefined {
  const globalConfig = getGlobalAIConfig();
  return globalConfig.model;
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
        const oauthToken = await getOpenAIOAuthToken(ctx.log);

        if (anthropicKey) {
          ctx.log('Using Anthropic for completion');
          const model = config.model ?? getConfiguredModel() ?? 'claude-sonnet-4-20250514';

          const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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
          }, 60000, 3, ctx.log);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Anthropic API error: ${response.status} - ${errorText.slice(0, 200)}`);
          }

          const data = await response.json() as { content: Array<{ text: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
          // Track usage
          if (data.usage) {
            trackUsage(data.usage.input_tokens ?? 0, data.usage.output_tokens ?? 0);
          }
          return {
            text: data.content[0]?.text ?? '',
            model,
            provider: 'anthropic',
          };
        } else if (oauthToken || openaiKey) {
          const authToken = oauthToken ?? openaiKey;
          ctx.log(oauthToken ? 'Using OpenAI with OAuth for completion' : 'Using OpenAI for completion');
          const model = config.model ?? getConfiguredModel() ?? 'gpt-4o';

          const messages = [];
          if (config.system) {
            messages.push({ role: 'system', content: config.system });
          }
          messages.push({ role: 'user', content: config.prompt });

          const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              model,
              max_tokens: config.maxTokens ?? 1024,
              temperature: config.temperature ?? 0.7,
              messages,
            }),
          }, 60000, 3, ctx.log);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error: ${response.status} - ${errorText.slice(0, 200)}`);
          }

          const data = await response.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
          // Track usage
          if (data.usage) {
            trackUsage(data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0);
          }
          return {
            text: data.choices[0]?.message?.content ?? '',
            model,
            provider: oauthToken ? 'openai-oauth' : 'openai',
          };
        } else {
          // Fallback to CLI-based AI
          const globalConfig = getGlobalAIConfig();
          if (globalConfig.useCLI) {
            ctx.log('Using CLI-based AI (no API key configured)');
            const result = await executeCLI(config.prompt, globalConfig, config.system);
            return result;
          }
          throw new Error('No AI API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or enable CLI mode in config.');
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
        const oauthToken = await getOpenAIOAuthToken(ctx.log);
        const globalConfig = getGlobalAIConfig();
        const systemPrompt = 'You are a helpful assistant that summarizes text clearly and accurately.';

        if (anthropicKey) {
          ctx.log('Using Anthropic for summarization');
          const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 512,
              system: systemPrompt,
              messages: [{ role: 'user', content: prompt }],
            }),
          }, 60000, 3, ctx.log);

          if (!response.ok) {
            const errorText = await response.text();
            ctx.log(`Anthropic API error: ${response.status} - ${errorText}`);
            throw new Error(`Anthropic API error: ${response.status} - ${errorText.slice(0, 200)}`);
          }

          const data = await response.json() as { content: Array<{ text: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
          // Track usage
          if (data.usage) {
            trackUsage(data.usage.input_tokens ?? 0, data.usage.output_tokens ?? 0);
          }
          const summary = data.content[0]?.text ?? '';
          ctx.log(`Generated summary: ${summary.substring(0, 100)}...`);
          return { summary };
        } else if (oauthToken || openaiKey) {
          const authToken = oauthToken ?? openaiKey;
          ctx.log(oauthToken ? 'Using OpenAI with OAuth for summarization' : 'Using OpenAI for summarization');
          const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_tokens: 512,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
              ],
            }),
          }, 60000, 3, ctx.log);

          if (!response.ok) {
            const errorText = await response.text();
            ctx.log(`OpenAI API error: ${response.status} - ${errorText}`);
            throw new Error(`OpenAI API error: ${response.status} - ${errorText.slice(0, 200)}`);
          }

          const data = await response.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
          // Track usage
          if (data.usage) {
            trackUsage(data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0);
          }
          const summary = data.choices[0]?.message?.content ?? '';
          ctx.log(`Generated summary: ${summary.substring(0, 100)}...`);
          return { summary };
        } else if (globalConfig.useCLI) {
          // Fallback to CLI-based AI
          ctx.log('Using CLI-based AI for summarization');
          const result = await executeCLI(prompt, globalConfig, systemPrompt);
          return { summary: result.text };
        } else {
          throw new Error('No AI API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or enable CLI mode.');
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
        const oauthToken = await getOpenAIOAuthToken(ctx.log);
        const globalConfig = getGlobalAIConfig();

        let result: string;

        if (anthropicKey) {
          const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 1024,
              messages: [{ role: 'user', content: prompt }],
            }),
          }, 60000, 3, ctx.log);

          const data = await response.json() as { content: Array<{ text: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
          // Track usage
          if (data.usage) {
            trackUsage(data.usage.input_tokens ?? 0, data.usage.output_tokens ?? 0);
          }
          result = data.content[0]?.text ?? '{}';
        } else if (oauthToken || openaiKey) {
          const authToken = oauthToken ?? openaiKey;
          const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_tokens: 1024,
              response_format: { type: 'json_object' },
              messages: [{ role: 'user', content: prompt }],
            }),
          }, 60000, 3, ctx.log);

          const data = await response.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
          // Track usage
          if (data.usage) {
            trackUsage(data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0);
          }
          result = data.choices[0]?.message?.content ?? '{}';
        } else if (globalConfig.useCLI) {
          ctx.log('Using CLI-based AI for extraction');
          const cliResult = await executeCLI(prompt, globalConfig);
          result = cliResult.text;
        } else {
          throw new Error('No AI API key found. Enable CLI mode or set API key.');
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
        const oauthToken = await getOpenAIOAuthToken(ctx.log);
        const globalConfig = getGlobalAIConfig();

        let category: string;

        if (anthropicKey) {
          const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 100,
              messages: [{ role: 'user', content: prompt }],
            }),
          }, 60000, 3, ctx.log);

          const data = await response.json() as { content: Array<{ text: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
          // Track usage
          if (data.usage) {
            trackUsage(data.usage.input_tokens ?? 0, data.usage.output_tokens ?? 0);
          }
          category = data.content[0]?.text?.trim() ?? 'unknown';
        } else if (oauthToken || openaiKey) {
          const authToken = oauthToken ?? openaiKey;
          const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_tokens: 100,
              messages: [{ role: 'user', content: prompt }],
            }),
          }, 60000, 3, ctx.log);

          const data = await response.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
          // Track usage
          if (data.usage) {
            trackUsage(data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0);
          }
          category = data.choices[0]?.message?.content?.trim() ?? 'unknown';
        } else if (globalConfig.useCLI) {
          ctx.log('Using CLI-based AI for classification');
          const result = await executeCLI(prompt, globalConfig);
          category = result.text.trim();
        } else {
          throw new Error('No AI API key found. Enable CLI mode or set API key.');
        }

        return {
          category,
          confidence: categories.includes(category) ? 'high' : 'low',
        };
      },
    }),

    defineAction({
      name: 'agent',
      description: 'Run a free-flowing AI agent that can use tools to accomplish a task',
      async execute(ctx) {
        const task = ctx.config.task as string;
        const tools = (ctx.config.tools as string[] | undefined) ?? ['web_search', 'web_fetch', 'shell'];
        const maxIterations = (ctx.config.maxIterations as number) ?? 10;
        const systemPrompt = ctx.config.system as string | undefined;

        const anthropicKey = getAnthropicKey(ctx);
        const openaiKey = getOpenAIKey(ctx);
        const oauthToken = await getOpenAIOAuthToken(ctx.log);
        const globalConfig = getGlobalAIConfig();
        const useCodexAPI = oauthToken && !openaiKey && !anthropicKey;

        if (!anthropicKey && !openaiKey && !oauthToken) {
          throw new Error('Agent action requires an API key (Anthropic or OpenAI) or OAuth authentication.');
        }

        // Use global MCP manager (initialized on server startup)
        // web-search-mcp and other default servers are already running
        const mcpManager = getGlobalMCPManager();
        if (mcpManager && mcpManager.getServers().size > 0) {
          ctx.log(`Using ${mcpManager.getServers().size} MCP server(s) from global manager`);
        } else {
          ctx.log('No MCP servers available (they may still be starting)');
        }

        // Track failed tools for intelligent replanning
        const failedTools: Map<string, { count: number; lastError: string }> = new Map();

        // Build available tools based on configuration
        const availableTools: Array<{
          name: string;
          description: string;
          input_schema: Record<string, unknown>;
        }> = [];

        if (tools.includes('web_search')) {
          availableTools.push({
            name: 'web_search',
            description: 'Search the web for information',
            input_schema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'The search query' },
              },
              required: ['query'],
            },
          });
        }

        if (tools.includes('web_fetch')) {
          availableTools.push({
            name: 'web_fetch',
            description: 'Fetch content from a URL',
            input_schema: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'The URL to fetch' },
              },
              required: ['url'],
            },
          });
        }

        if (tools.includes('shell')) {
          availableTools.push({
            name: 'shell_exec',
            description: 'Execute a shell command (use with caution)',
            input_schema: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'The shell command to execute' },
              },
              required: ['command'],
            },
          });
        }

        if (tools.includes('filesystem')) {
          availableTools.push({
            name: 'read_file',
            description: 'Read contents of a file',
            input_schema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Path to the file' },
              },
              required: ['path'],
            },
          });
          availableTools.push({
            name: 'write_file',
            description: 'Write content to a file',
            input_schema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Path to the file' },
                content: { type: 'string', description: 'Content to write' },
              },
              required: ['path', 'content'],
            },
          });
        }

        // Add MCP tools to available tools (they get routed through executeTool)
        if (mcpManager && mcpManager.getServers().size > 0) {
          try {
            const mcpTools = await mcpManager.getAllTools();
            for (const tool of mcpTools) {
              // Skip if we already have a tool with this name (prefer built-in)
              if (availableTools.some(t => t.name === tool.name)) {
                continue;
              }
              availableTools.push({
                name: tool.name,
                description: tool.description ?? `MCP tool from ${tool.server}`,
                input_schema: tool.inputSchema as unknown as Record<string, unknown>,
              });
              ctx.log(`Added MCP tool: ${tool.name}`);
            }
          } catch (mcpErr) {
            ctx.log(`Failed to load MCP tools: ${String(mcpErr)}`);
          }
        }

        // Tool result validation helper
        function validateToolResult(_toolName: string, result: string): { valid: boolean; feedback: string } {
          // Check for explicit failure markers
          if (result.startsWith('[SEARCH FAILED]') || result.startsWith('[FETCH FAILED]') ||
              result.startsWith('[FETCH ERROR]') || result.startsWith('[SEARCH ERROR]')) {
            return { valid: false, feedback: result };
          }

          // Check for too-short results that indicate failure
          if (result.length < 50 && !result.includes('successfully')) {
            return {
              valid: false,
              feedback: `${result}\n\n[VALIDATION: Result too short. Try an alternative approach.]`,
            };
          }

          // Check for common error patterns
          const errorPatterns = [
            /no results found/i,
            /could not find/i,
            /access denied/i,
            /403 forbidden/i,
            /404 not found/i,
            /rate limit/i,
            /timeout/i,
          ];

          for (const pattern of errorPatterns) {
            if (pattern.test(result)) {
              return {
                valid: false,
                feedback: `${result}\n\n[VALIDATION: Result indicates an error. Try an alternative approach.]`,
              };
            }
          }

          return { valid: true, feedback: result };
        }

        // Tool execution helper with failure tracking
        async function executeTool(toolName: string, input: Record<string, unknown>): Promise<string> {
          ctx.log(`Agent using tool: ${toolName}`);

          switch (toolName) {
            case 'web_search': {
              const query = String(input.query);
              ctx.log(`Searching for: ${query}`);

              try {
                // PRIMARY: Use MCP web-search-mcp (default, no API keys required)
                // web-search-mcp is automatically started if not already configured
                if (mcpManager && mcpManager.getServers().size > 0) {
                  const mcpTools = await mcpManager.getAllTools();
                  // Look for web search tools from MCP (web-search-mcp provides these)
                  const searchTool = mcpTools.find(t =>
                    t.name === 'web_search' ||
                    t.name === 'search' ||
                    t.name.includes('search')
                  );

                  if (searchTool) {
                    ctx.log(`Using MCP web search: ${searchTool.name}`);
                    const result = await mcpManager.callTool(searchTool.name, { query });

                    if (!result.isError && result.content.length > 0) {
                      const text = result.content.map(c => c.text ?? '').join('\n');
                      if (text.length > 20) {
                        ctx.log(`MCP search returned ${text.length} characters`);
                        return `Search results for "${query}":\n\n${text}`;
                      }
                    }
                    ctx.log('MCP search returned empty results');
                  }
                }

                // Primary: Brave Search API (from config or BRAVE_API_KEY env var)
                const searchKeys = getWebSearchApiKey();
                const braveKey = searchKeys.brave;
                const tavilyKey = searchKeys.tavily;

                if (braveKey) {
                  ctx.log('Using Brave Search API');
                  try {
                    const response = await fetchWithTimeout(
                      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`,
                      {
                        headers: {
                          'Accept': 'application/json',
                          'X-Subscription-Token': braveKey,
                        },
                      },
                      15000, 2, ctx.log
                    );

                    if (response.ok) {
                      const data = await response.json() as {
                        web?: { results?: Array<{ title: string; url: string; description: string }> };
                      };
                      const results = data.web?.results ?? [];
                      if (results.length > 0) {
                        const formatted = results.slice(0, 8).map((r, i) =>
                          `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.description}\n`
                        ).join('\n');
                        ctx.log(`Brave Search found ${results.length} results`);
                        return `Search results for "${query}":\n\n${formatted}`;
                      }
                      ctx.log('Brave Search returned no results');
                    } else {
                      const errText = await response.text();
                      ctx.log(`Brave Search API error: ${response.status} - ${errText.slice(0, 200)}`);
                    }
                  } catch (braveErr) {
                    ctx.log(`Brave Search error: ${String(braveErr)}`);
                  }
                }

                // Fallback: Tavily Search API (requires TAVILY_API_KEY)
                if (tavilyKey) {
                  ctx.log('Fallback: Using Tavily Search API');
                  try {
                    const response = await fetchWithTimeout('https://api.tavily.com/search', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        api_key: tavilyKey,
                        query,
                        search_depth: 'basic',
                        max_results: 8,
                      }),
                    }, 15000, 2, ctx.log);

                    if (response.ok) {
                      const data = await response.json() as {
                        results?: Array<{ title: string; url: string; content: string }>;
                      };
                      const results = data.results ?? [];
                      if (results.length > 0) {
                        const formatted = results.map((r, i) =>
                          `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content.slice(0, 300)}...\n`
                        ).join('\n');
                        ctx.log(`Tavily Search found ${results.length} results`);
                        return `Search results for "${query}":\n\n${formatted}`;
                      }
                      ctx.log('Tavily Search returned no results');
                    }
                  } catch (tavilyErr) {
                    ctx.log(`Tavily Search error: ${String(tavilyErr)}`);
                  }
                }

                // No API keys configured - return helpful setup instructions
                if (!braveKey && !tavilyKey) {
                  return JSON.stringify({
                    error: 'missing_search_api_key',
                    message: 'web_search requires a search API key. Get a free Brave Search API key (2000 queries/month).',
                    setup: {
                      option1: 'Configure in Settings page (recommended)',
                      option2: 'Run "weavr onboard" to set up via CLI',
                      option3: 'Set BRAVE_API_KEY environment variable',
                      brave: {
                        url: 'https://brave.com/search/api/',
                        plan: 'Data for Search (free tier: 2000 queries/month)',
                      },
                      tavily: {
                        url: 'https://tavily.com/',
                        plan: 'Free tier: 1000 queries/month',
                        env: 'TAVILY_API_KEY',
                      },
                    },
                    workaround: 'Use web_fetch with specific URLs instead (e.g., https://finance.yahoo.com for financial data)',
                  }, null, 2);
                }

                // API keys configured but search failed
                return `[SEARCH FAILED] Search returned no results for "${query}".

Try web_fetch with specific URLs:
- https://finance.yahoo.com/quote/AAPL for stock prices
- https://www.reuters.com for news
- https://en.wikipedia.org/wiki/${encodeURIComponent(query.replace(/ /g, '_'))} for general info`;

              } catch (err) {
                ctx.log(`Search error: ${String(err)}`);
                return `[SEARCH ERROR] ${String(err)}. Try web_fetch with a specific URL instead.`;
              }
            }

            case 'web_fetch': {
              const url = String(input.url);
              ctx.log(`Fetching URL: ${url}`);

              // Use fetchWithTimeout with retry logic
              try {
                const response = await fetchWithTimeout(url, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                  },
                }, 30000, 3, ctx.log);

                if (!response.ok) {
                  return `[FETCH FAILED] HTTP ${response.status} ${response.statusText}. Try a different URL or source.`;
                }

                const contentType = response.headers.get('content-type') || '';
                const text = await response.text();

                // Validate response - check if we got meaningful content
                if (text.length < 100) {
                  return `[FETCH WARNING] Response too short (${text.length} chars). The page may require JavaScript or authentication.`;
                }

                // If it's HTML, extract readable content
                if (contentType.includes('text/html')) {
                  // Remove script and style tags
                  let content = text
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
                    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
                    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
                    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');

                  // Extract title
                  const titleMatch = content.match(/<title[^>]*>([^<]*)<\/title>/i);
                  const title = titleMatch ? titleMatch[1].trim() : 'No title';

                  // Extract main content (article, main, or body)
                  let mainContent = '';
                  const articleMatch = content.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
                  const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

                  if (articleMatch) {
                    mainContent = articleMatch[1];
                  } else if (mainMatch) {
                    mainContent = mainMatch[1];
                  } else {
                    // Fall back to body
                    const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                    mainContent = bodyMatch ? bodyMatch[1] : content;
                  }

                  // Strip HTML tags and clean up
                  mainContent = mainContent
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#x27;/g, "'")
                    .replace(/&#39;/g, "'")
                    .replace(/\s+/g, ' ')
                    .trim();

                  // Validate extracted content
                  if (mainContent.length < 50) {
                    return `[FETCH WARNING] Extracted content too short. Page may be JavaScript-rendered or require authentication.\nRaw title: ${title}\nTry fetching a different URL.`;
                  }

                  const result = `Title: ${title}\nURL: ${url}\n\nContent:\n${mainContent}`;
                  ctx.log(`Fetched ${result.length} characters from ${url}`);
                  return result.slice(0, 12000) + (result.length > 12000 ? '\n\n...(truncated)' : '');
                }

                // For non-HTML content (JSON, XML, plain text), return as-is
                ctx.log(`Fetched ${text.length} characters (${contentType})`);
                return text.slice(0, 12000) + (text.length > 12000 ? '\n...(truncated)' : '');
              } catch (err) {
                ctx.log(`Fetch error: ${String(err)}`);
                return `[FETCH ERROR] ${String(err)}. Suggestions:
- Check if the URL is correct
- Try an alternative source
- Some sites block automated requests`;
              }
            }

            case 'shell_exec': {
              try {
                const { stdout, stderr } = await execAsync(String(input.command), {
                  timeout: 30000,
                  maxBuffer: 1024 * 1024,
                });
                return stdout || stderr || '(no output)';
              } catch (err) {
                return `Command failed: ${String(err)}`;
              }
            }

            case 'read_file': {
              try {
                return readFileSync(String(input.path), 'utf-8');
              } catch (err) {
                return `Read failed: ${String(err)}`;
              }
            }

            case 'write_file': {
              try {
                writeFileSync(String(input.path), String(input.content), 'utf-8');
                return `File written successfully: ${input.path}`;
              } catch (err) {
                return `Write failed: ${String(err)}`;
              }
            }

            default: {
              // Try MCP tools as fallback
              if (mcpManager && mcpManager.getServers().size > 0) {
                try {
                  const result = await mcpManager.callTool(toolName, input);
                  if (result.isError) {
                    return `[MCP ERROR] ${result.content.map(c => c.text ?? '').join('\n')}`;
                  }
                  const text = result.content.map(c => c.text ?? '').join('\n');
                  return text || '(empty result)';
                } catch (mcpErr) {
                  ctx.log(`MCP tool ${toolName} failed: ${String(mcpErr)}`);
                }
              }
              return `Unknown tool: ${toolName}`;
            }
          }
        }

        // Agentic loop with enhanced system prompt for strategic planning and efficiency
        const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        // Date context is ALWAYS prepended to any system prompt (custom or default)
        const dateContext = `## Current Date
Today is ${currentDate}. Always use this date as your reference for "current", "today", "now", or "latest" queries. Do NOT use outdated dates from your training data.

`;
        const defaultSystem = `You are an autonomous AI agent that accomplishes tasks through careful planning and strategic tool use.

## Your Approach (Follow This Order)

### 1. PLAN FIRST (Before ANY tool call)
Before making your first tool call, create a brief plan:
- What is the user asking for?
- What information do I need to gather?
- Which tools will I use and in what order?
- Can I batch multiple searches into fewer calls?

### 2. GATHER STRATEGICALLY
When using tools:
- Batch related queries when possible (search for multiple things at once)
- Prefer web_search first, then web_fetch for specific URLs
- If a tool fails, try alternatives immediately in the same turn
- Don't make a new iteration just to try one more search

### 3. REFLECT BEFORE CONTINUING
After each tool result, briefly assess:
- Did I get what I needed?
- Do I have enough to answer, or do I need more?
- What's the most efficient next step?

### 4. SYNTHESIZE EARLY
Once you have sufficient information (even if not perfect), synthesize your answer. Don't over-research.

## Tool Selection Guide
- **web_search**: Use first for discovery. Batch multiple queries if related.
- **web_fetch**: Use for specific known URLs. Combine with search results.
- **shell_exec**: Use for local commands. Check permissions first.
- **read_file/write_file**: Use for local file operations.

## Efficiency Rules
- Aim to complete in 2-3 iterations, not 5+
- If first search fails, try web_fetch with known URLs immediately (same turn)
- Don't repeat failed approaches - adapt quickly
- When you have 70%+ of needed info, start synthesizing

## Failure Recovery
If a tool returns [FAILED] or [ERROR]:
- Try an alternative approach in the SAME response
- Known reliable sources: finance.yahoo.com, reuters.com, wikipedia.org
- Don't waste an iteration on a single retry

## Output Requirements
- Cite your sources
- Be concise but complete
- If information is unavailable, explain what you tried`;

        // Always prepend date context to whatever system prompt is used
        const finalSystemPrompt = dateContext + (systemPrompt ?? defaultSystem);

        const messages: Array<{ role: 'user' | 'assistant'; content: string | Array<{ type: string; text?: string; tool_use_id?: string; name?: string; input?: unknown; id?: string }> }> = [
          { role: 'user', content: task },
        ];

        let iteration = 0;
        let finalResult = '';

        while (iteration < maxIterations) {
          iteration++;
          ctx.log(`Agent iteration ${iteration}/${maxIterations}`);

          let response: Response;
          let responseData: Record<string, unknown>;

          if (anthropicKey) {
            response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: globalConfig.model ?? 'claude-sonnet-4-20250514',
                max_tokens: 4096,
                system: finalSystemPrompt,
                tools: availableTools,
                messages,
              }),
            }, 120000, 3, ctx.log);

            if (!response.ok) {
              const errText = await response.text();
              throw new Error(`Anthropic API error: ${errText.slice(0, 200)}`);
            }

            responseData = await response.json() as Record<string, unknown>;

            // Track usage for Anthropic agent calls
            const usage = responseData.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            if (usage) {
              trackUsage(usage.input_tokens ?? 0, usage.output_tokens ?? 0);
            }

            const content = responseData.content as Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }>;

            // Process response
            const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
            let textResponse = '';

            for (const block of content) {
              if (block.type === 'text') {
                textResponse += block.text;
              } else if (block.type === 'tool_use') {
                toolUses.push({
                  id: block.id!,
                  name: block.name!,
                  input: block.input!,
                });
              }
            }

            // If there are tool calls, execute them
            if (toolUses.length > 0) {
              messages.push({ role: 'assistant', content });

              const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
              for (const toolUse of toolUses) {
                const rawResult = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);

                // Validate and potentially annotate the result
                const validation = validateToolResult(toolUse.name, rawResult);
                if (!validation.valid) {
                  // Track the failure
                  const existing = failedTools.get(toolUse.name) ?? { count: 0, lastError: '' };
                  failedTools.set(toolUse.name, {
                    count: existing.count + 1,
                    lastError: rawResult.slice(0, 200),
                  });
                  ctx.log(`Tool ${toolUse.name} failed (attempt ${existing.count + 1})`);
                }

                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: validation.feedback,
                });
              }

              messages.push({ role: 'user', content: toolResults as unknown as string });
            } else {
              // No tool calls means the agent is done
              finalResult = textResponse;
              break;
            }
          } else if (useCodexAPI) {
            // ChatGPT Backend API (Codex) for OAuth users
            ctx.log('Using ChatGPT Backend API (Codex) with OAuth');

            // Build conversation for Codex
            const codexInput: Array<{ type: string; role?: string; content?: string }> = [];

            // Add previous messages
            for (const m of messages) {
              if (typeof m.content === 'string') {
                codexInput.push({ type: 'message', role: m.role, content: m.content });
              }
            }

            // Codex API with streaming
            const codexResponse = await fetch('https://chatgpt.com/backend-api/codex/responses', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${oauthToken}`,
              },
              body: JSON.stringify({
                model: globalConfig.model ?? 'gpt-4o',
                instructions: finalSystemPrompt,
                input: codexInput,
                stream: true,
                store: false,
              }),
            });

            if (!codexResponse.ok) {
              const errText = await codexResponse.text();
              throw new Error(`ChatGPT API error: ${errText.slice(0, 300)}`);
            }

            // Handle streaming response
            const reader = codexResponse.body?.getReader();
            if (!reader) {
              throw new Error('No response body from ChatGPT API');
            }

            const decoder = new TextDecoder();
            let buffer = '';
            let fullResponse = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                if (!line.trim() || !line.startsWith('data: ')) continue;
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const event = JSON.parse(data);
                  if (event.type === 'response.output_text.delta') {
                    fullResponse += event.delta ?? '';
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }

            // For Codex, we don't have tool calling support, so the response is final
            // The model should complete the task in one shot with the given instructions
            if (fullResponse) {
              finalResult = fullResponse;
            }
            break; // Exit loop - Codex doesn't support multi-turn tool calling

          } else if (oauthToken || openaiKey) {
            // OpenAI with function calling - use separate message tracking for proper format
            // OpenAI requires: assistant message with tool_calls, then tool messages with tool_call_id
            const authToken = openaiKey!; // Only use API key here, OAuth is handled above
            type OpenAIMessage =
              | { role: 'system'; content: string }
              | { role: 'user'; content: string }
              | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
              | { role: 'tool'; tool_call_id: string; content: string };

            const openaiMessages: OpenAIMessage[] = [
              { role: 'system', content: finalSystemPrompt },
            ];

            // Convert internal messages to OpenAI format
            for (const m of messages) {
              if (typeof m.content === 'string') {
                openaiMessages.push({ role: m.role, content: m.content });
              } else if (Array.isArray(m.content)) {
                // This is either an assistant message with tool calls or tool results
                // Check if it contains tool_use (assistant) or tool_result (user with tool results)
                const hasToolUse = m.content.some((b: { type: string }) => b.type === 'tool_use');
                const hasToolResult = m.content.some((b: { type: string }) => b.type === 'tool_result');

                if (hasToolUse && m.role === 'assistant') {
                  // Convert Anthropic tool_use to OpenAI tool_calls
                  const textContent = m.content.find((b: { type: string }) => b.type === 'text') as { text?: string } | undefined;
                  const toolUses = m.content.filter((b: { type: string }) => b.type === 'tool_use') as Array<{ id: string; name: string; input: unknown }>;

                  openaiMessages.push({
                    role: 'assistant',
                    content: textContent?.text ?? null,
                    tool_calls: toolUses.map(tu => ({
                      id: tu.id,
                      type: 'function' as const,
                      function: {
                        name: tu.name,
                        arguments: JSON.stringify(tu.input),
                      },
                    })),
                  });
                } else if (hasToolResult) {
                  // Convert Anthropic tool_result to OpenAI tool messages
                  // The internal storage uses { type: 'tool_result', tool_use_id: string, content: string }
                  type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string };
                  const toolResults = m.content.filter((b): b is ToolResultBlock => b.type === 'tool_result');
                  for (const tr of toolResults) {
                    openaiMessages.push({
                      role: 'tool',
                      tool_call_id: tr.tool_use_id,
                      content: tr.content,
                    });
                  }
                }
              }
            }

            response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
              },
              body: JSON.stringify({
                model: globalConfig.model ?? 'gpt-4o',
                max_tokens: 4096,
                messages: openaiMessages,
                tools: availableTools.map(t => ({
                  type: 'function',
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.input_schema,
                  },
                })),
              }),
            }, 120000, 3, ctx.log);

            if (!response.ok) {
              const errText = await response.text();
              throw new Error(`OpenAI API error: ${errText.slice(0, 200)}`);
            }

            responseData = await response.json() as Record<string, unknown>;

            // Track usage for OpenAI agent calls
            const openaiUsage = responseData.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
            if (openaiUsage) {
              trackUsage(openaiUsage.prompt_tokens ?? 0, openaiUsage.completion_tokens ?? 0);
            }

            const choice = (responseData.choices as Array<{
              message: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
              finish_reason: string;
            }>)?.[0];

            if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
              // Execute tool calls - store in Anthropic format for internal consistency
              const toolCalls = choice.message.tool_calls;

              // Build assistant content with tool uses (Anthropic format for internal storage)
              const assistantContent: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> = [];
              if (choice.message.content) {
                assistantContent.push({ type: 'text', text: choice.message.content });
              }
              for (const tc of toolCalls) {
                assistantContent.push({
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function.name,
                  input: JSON.parse(tc.function.arguments),
                });
              }
              messages.push({ role: 'assistant', content: assistantContent });

              // Execute tools and build results with validation
              const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
              for (const toolCall of toolCalls) {
                const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
                const rawResult = await executeTool(toolCall.function.name, toolInput);

                // Validate and potentially annotate the result
                const validation = validateToolResult(toolCall.function.name, rawResult);
                if (!validation.valid) {
                  // Track the failure
                  const existing = failedTools.get(toolCall.function.name) ?? { count: 0, lastError: '' };
                  failedTools.set(toolCall.function.name, {
                    count: existing.count + 1,
                    lastError: rawResult.slice(0, 200),
                  });
                  ctx.log(`Tool ${toolCall.function.name} failed (attempt ${existing.count + 1})`);
                }

                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolCall.id,
                  content: validation.feedback,
                });
              }

              // Store tool results (will be converted to proper format on next iteration)
              messages.push({ role: 'user', content: toolResults as unknown as string });
            } else {
              // No tool calls, agent is done
              finalResult = choice?.message?.content ?? '';
              break;
            }
          }
        }

        // Note: MCP connections are managed globally and stay alive between agent runs

        ctx.log(`Agent completed in ${iteration} iterations`);

        // Log any persistent failures
        if (failedTools.size > 0) {
          const failures = Array.from(failedTools.entries())
            .map(([tool, info]) => `${tool}: ${info.count} failures`)
            .join(', ');
          ctx.log(`Tool failures during execution: ${failures}`);
        }

        return {
          result: finalResult,
          iterations: iteration,
          success: true,
        };
      },
    }),
  ],
});
