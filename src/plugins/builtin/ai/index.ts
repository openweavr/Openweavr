import { definePlugin, defineAction } from '../../sdk/types.js';
import { z } from 'zod';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Helper to fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 60000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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
  // CLI-based AI options (for users without API keys)
  useCLI?: boolean;
  cliProvider?: 'claude' | 'ollama' | 'llm' | 'auto';
  cliModel?: string;
}

// Cache for config to avoid reading file on every action
let cachedConfig: AIConfig | null = null;
let configLastRead = 0;
const CONFIG_CACHE_MS = 5000; // Re-read config every 5 seconds

function getGlobalAIConfig(): AIConfig {
  const now = Date.now();
  if (cachedConfig && now - configLastRead < CONFIG_CACHE_MS) {
    return cachedConfig;
  }

  try {
    const configPath = join(homedir(), '.weavr', 'config.yaml');
    const content = readFileSync(configPath, 'utf-8');
    const config = parseYaml(content) as { ai?: AIConfig };
    cachedConfig = config.ai ?? {};
    configLastRead = now;
    return cachedConfig;
  } catch {
    cachedConfig = {};
    configLastRead = now;
    return cachedConfig;
  }
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
  // Check if global config uses OpenAI
  if (globalConfig.provider === 'openai' && globalConfig.apiKey) {
    return globalConfig.apiKey;
  }
  return (ctx.config.openaiApiKey as string) ?? ctx.env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
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
          });

          if (!response.ok) {
            const errorText = await response.text();
            ctx.log(`Anthropic API error: ${response.status} - ${errorText}`);
            throw new Error(`Anthropic API error: ${response.status}`);
          }

          const data = await response.json() as { content: Array<{ text: string }> };
          const summary = data.content[0]?.text ?? '';
          ctx.log(`Generated summary: ${summary.substring(0, 100)}...`);
          return { summary };
        } else if (openaiKey) {
          ctx.log('Using OpenAI for summarization');
          const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openaiKey}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_tokens: 512,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
              ],
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            ctx.log(`OpenAI API error: ${response.status} - ${errorText}`);
            throw new Error(`OpenAI API error: ${response.status}`);
          }

          const data = await response.json() as { choices: Array<{ message: { content: string } }> };
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
          });

          const data = await response.json() as { content: Array<{ text: string }> };
          result = data.content[0]?.text ?? '{}';
        } else if (openaiKey) {
          const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openaiKey}`,
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
          });

          const data = await response.json() as { content: Array<{ text: string }> };
          category = data.content[0]?.text?.trim() ?? 'unknown';
        } else if (openaiKey) {
          const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openaiKey}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_tokens: 100,
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          const data = await response.json() as { choices: Array<{ message: { content: string } }> };
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
        const globalConfig = getGlobalAIConfig();

        if (!anthropicKey && !openaiKey) {
          throw new Error('Agent action requires an API key (Anthropic or OpenAI) for tool use capabilities.');
        }

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

        // Tool execution helper
        async function executeTool(toolName: string, input: Record<string, unknown>): Promise<string> {
          ctx.log(`Agent using tool: ${toolName}`);

          switch (toolName) {
            case 'web_search': {
              const query = String(input.query);
              ctx.log(`Searching for: ${query}`);

              // Check for search API keys
              const braveKey = process.env.BRAVE_API_KEY;
              const tavilyKey = process.env.TAVILY_API_KEY;
              const serpApiKey = process.env.SERPAPI_KEY;
              const isMac = process.platform === 'darwin';
              const useBrowserSearch = process.env.USE_BROWSER_SEARCH !== 'false'; // enabled by default on macOS

              try {
                // Option 1: Brave Search API (free tier: 2000 queries/month)
                if (braveKey) {
                  ctx.log('Using Brave Search API');
                  const response = await fetch(
                    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`,
                    {
                      headers: {
                        'Accept': 'application/json',
                        'X-Subscription-Token': braveKey,
                      },
                    }
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
                      ctx.log(`Found ${results.length} Brave search results`);
                      return `Search results for "${query}":\n\n${formatted}`;
                    }
                  }
                }

                // Option 2: Tavily API (designed for AI agents, free tier available)
                if (tavilyKey) {
                  ctx.log('Using Tavily Search API');
                  const response = await fetch('https://api.tavily.com/search', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      api_key: tavilyKey,
                      query,
                      search_depth: 'basic',
                      max_results: 8,
                    }),
                  });

                  if (response.ok) {
                    const data = await response.json() as {
                      results?: Array<{ title: string; url: string; content: string }>;
                    };
                    const results = data.results ?? [];
                    if (results.length > 0) {
                      const formatted = results.map((r, i) =>
                        `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content.slice(0, 300)}...\n`
                      ).join('\n');
                      ctx.log(`Found ${results.length} Tavily search results`);
                      return `Search results for "${query}":\n\n${formatted}`;
                    }
                  }
                }

                // Option 3: SerpAPI (if configured)
                if (serpApiKey) {
                  ctx.log('Using SerpAPI');
                  const response = await fetch(
                    `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=10`
                  );

                  if (response.ok) {
                    const data = await response.json() as {
                      organic_results?: Array<{ title: string; link: string; snippet: string }>;
                    };
                    const results = data.organic_results ?? [];
                    if (results.length > 0) {
                      const formatted = results.slice(0, 8).map((r, i) =>
                        `${i + 1}. ${r.title}\n   URL: ${r.link}\n   ${r.snippet}\n`
                      ).join('\n');
                      ctx.log(`Found ${results.length} SerpAPI search results`);
                      return `Search results for "${query}":\n\n${formatted}`;
                    }
                  }
                }

                // Option 4: macOS Safari-based search (uses local browser)
                if (isMac && useBrowserSearch) {
                  ctx.log('Using macOS Safari for web search');
                  try {
                    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

                    // AppleScript to open Safari, perform search, and extract results
                    const appleScript = `
                      tell application "Safari"
                        -- Open in a new window to avoid disrupting user's browsing
                        make new document with properties {URL:"${searchUrl}"}
                        set searchWindow to front window

                        -- Wait for page to load (up to 10 seconds)
                        set maxWait to 10
                        set waited to 0
                        repeat while waited < maxWait
                          delay 0.5
                          set waited to waited + 0.5
                          try
                            set readyState to do JavaScript "document.readyState" in current tab of searchWindow
                            if readyState is "complete" then exit repeat
                          end try
                        end repeat

                        -- Extract search results using JavaScript
                        set resultText to do JavaScript "
                          (function() {
                            const results = [];
                            // Google search results
                            const items = document.querySelectorAll('div.g');
                            items.forEach((item, i) => {
                              if (i >= 8) return;
                              const titleEl = item.querySelector('h3');
                              const linkEl = item.querySelector('a');
                              const snippetEl = item.querySelector('div[data-sncf], div.VwiC3b, span.aCOpRe');
                              if (titleEl && linkEl) {
                                const title = titleEl.innerText || '';
                                const url = linkEl.href || '';
                                const snippet = snippetEl ? snippetEl.innerText : '';
                                results.push((i+1) + '. ' + title + '\\\\nURL: ' + url + '\\\\n' + snippet + '\\\\n');
                              }
                            });
                            return results.join('\\\\n');
                          })()
                        " in current tab of searchWindow

                        -- Close the search window
                        close searchWindow

                        return resultText
                      end tell
                    `;

                    const { stdout } = await execAsync(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, {
                      timeout: 20000,
                    });

                    const results = stdout.trim().replace(/\\\\n/g, '\n');
                    if (results && results.length > 10) {
                      ctx.log(`Safari search returned ${results.length} characters`);
                      return `Search results for "${query}":\n\n${results}`;
                    }
                  } catch (err) {
                    ctx.log(`Safari search error: ${String(err)}`);
                    // Fall through to other methods
                  }
                }

                // Fallback: DuckDuckGo Instant Answer API (limited but no CAPTCHA)
                ctx.log('Using DuckDuckGo Instant Answer API (limited)');
                const instantUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
                const instantResponse = await fetch(instantUrl);
                const instantData = await instantResponse.json() as {
                  Abstract?: string;
                  AbstractText?: string;
                  AbstractURL?: string;
                  RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
                };

                const instantResults: string[] = [];
                if (instantData.AbstractText) {
                  instantResults.push(`Summary: ${instantData.AbstractText}`);
                  if (instantData.AbstractURL) {
                    instantResults.push(`Source: ${instantData.AbstractURL}`);
                  }
                }
                if (instantData.RelatedTopics?.length) {
                  instantResults.push('\nRelated:');
                  for (const topic of instantData.RelatedTopics.slice(0, 5)) {
                    if (topic.Text && topic.FirstURL) {
                      instantResults.push(`- ${topic.Text}\n  URL: ${topic.FirstURL}`);
                    }
                  }
                }

                if (instantResults.length > 0) {
                  return instantResults.join('\n');
                }

                // No search API configured and DuckDuckGo returned nothing
                return `No search API configured. To enable web search, set one of these environment variables:
- BRAVE_API_KEY (get free key at https://brave.com/search/api/)
- TAVILY_API_KEY (get free key at https://tavily.com/)
- SERPAPI_KEY (get key at https://serpapi.com/)

Alternatively, use web_fetch with specific URLs like:
- https://finance.yahoo.com for financial data
- https://www.reuters.com for news
- https://www.bloomberg.com for market analysis`;

              } catch (err) {
                ctx.log(`Search error: ${String(err)}`);
                return `Search failed: ${String(err)}. Try using web_fetch with a specific URL instead.`;
              }
            }

            case 'web_fetch': {
              const url = String(input.url);
              ctx.log(`Fetching URL: ${url}`);
              try {
                const response = await fetch(url, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Weavr-Agent/1.0)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                  },
                });

                if (!response.ok) {
                  return `Fetch failed: HTTP ${response.status} ${response.statusText}`;
                }

                const contentType = response.headers.get('content-type') || '';
                const text = await response.text();

                // If it's HTML, extract readable content
                if (contentType.includes('text/html')) {
                  // Remove script and style tags
                  let content = text
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
                    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
                    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

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

                  const result = `Title: ${title}\nURL: ${url}\n\nContent:\n${mainContent}`;
                  ctx.log(`Fetched ${result.length} characters from ${url}`);
                  return result.slice(0, 12000) + (result.length > 12000 ? '\n\n...(truncated)' : '');
                }

                // For non-HTML content, return as-is
                ctx.log(`Fetched ${text.length} characters (${contentType})`);
                return text.slice(0, 12000) + (text.length > 12000 ? '\n...(truncated)' : '');
              } catch (err) {
                ctx.log(`Fetch error: ${String(err)}`);
                return `Fetch failed: ${String(err)}`;
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

            default:
              return `Unknown tool: ${toolName}`;
          }
        }

        // Agentic loop
        const defaultSystem = `You are an AI agent that accomplishes tasks by using tools and reasoning step by step.
When you have completed the task, provide your final answer.
Be thorough but efficient. Use tools when needed to gather information or take actions.`;

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
                system: systemPrompt ?? defaultSystem,
                tools: availableTools,
                messages,
              }),
            }, 120000);

            if (!response.ok) {
              const err = await response.json().catch(() => ({})) as { error?: { message?: string } };
              throw new Error(`Anthropic API error: ${err.error?.message ?? response.statusText}`);
            }

            responseData = await response.json() as Record<string, unknown>;
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
                const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: result,
                });
              }

              messages.push({ role: 'user', content: toolResults as unknown as string });
            } else {
              // No tool calls means the agent is done
              finalResult = textResponse;
              break;
            }
          } else if (openaiKey) {
            // OpenAI with function calling
            const openaiMessages = messages.map(m => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            }));

            response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiKey}`,
              },
              body: JSON.stringify({
                model: globalConfig.model ?? 'gpt-4o',
                max_tokens: 4096,
                messages: [
                  { role: 'system', content: systemPrompt ?? defaultSystem },
                  ...openaiMessages,
                ],
                tools: availableTools.map(t => ({
                  type: 'function',
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.input_schema,
                  },
                })),
              }),
            }, 120000);

            if (!response.ok) {
              const err = await response.json().catch(() => ({})) as { error?: { message?: string } };
              throw new Error(`OpenAI API error: ${err.error?.message ?? response.statusText}`);
            }

            responseData = await response.json() as Record<string, unknown>;
            const choice = (responseData.choices as Array<{
              message: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
              finish_reason: string;
            }>)?.[0];

            if (choice?.message?.tool_calls) {
              // Execute tool calls
              const toolCalls = choice.message.tool_calls;
              messages.push({ role: 'assistant', content: choice.message.content ?? '' });

              for (const toolCall of toolCalls) {
                const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
                const result = await executeTool(toolCall.function.name, toolInput);
                messages.push({
                  role: 'user',
                  content: `[Tool Result: ${toolCall.function.name}]\n${result}`,
                });
              }
            } else {
              // No tool calls, agent is done
              finalResult = choice?.message?.content ?? '';
              break;
            }
          }
        }

        ctx.log(`Agent completed in ${iteration} iterations`);

        return {
          result: finalResult,
          iterations: iteration,
          success: true,
        };
      },
    }),
  ],
});
