import * as p from '@clack/prompts';
import chalk from 'chalk';
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureConfigDir, saveConfig, loadConfig, WEAVR_DIR } from '../../config/index.js';
import type { WeavrConfig } from '../../types/index.js';
import {
  generatePKCE,
  buildAuthorizationURL,
  exchangeCodeForTokens,
  getCallbackUrl,
  getOAuthCallbackPort,
} from '../../auth/openai-oauth.js';
import { isInteractive } from '../utils/tty.js';

const execAsync = promisify(exec);

interface OnboardOptions {
  port?: string;
  host?: string;
  aiProvider?: 'none' | 'anthropic' | 'openai' | 'ollama';
  openaiAuth?: 'oauth' | 'apikey';
  openaiAuthMethod?: 'oauth' | 'apikey';
  apiKey?: string;
  braveApiKey?: string;
  skipWebSearch?: boolean;
  nonInteractive?: boolean;
}

// Open URL in browser (cross-platform)
async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  await execAsync(command);
}

export async function onboardCommand(options: OnboardOptions = {}): Promise<void> {
  const existingConfig = await loadConfig();
  const interactive = !options.nonInteractive && isInteractive();

  if (!interactive) {
    await runNonInteractiveOnboard(existingConfig, options);
    return;
  }

  console.clear();

  p.intro(chalk.magenta('🧵 Welcome to Weavr!'));

  // Ask if user prefers CLI or Web UI onboarding
  const onboardMethod = await p.select({
    message: 'How would you like to configure Weavr?',
    options: [
      { value: 'cli', label: 'Continue in terminal', hint: 'Quick setup right here' },
      { value: 'web', label: 'Open web interface', hint: 'Visual setup at localhost:3847' },
    ],
  });

  if (p.isCancel(onboardMethod)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  if (onboardMethod === 'web') {
    const webSpinner = p.spinner();
    webSpinner.start('Starting server...');

    // Start server in background
    const { spawn } = await import('node:child_process');
    const serverProcess = spawn('node', [process.argv[1].replace(/onboard.*$/, 'serve')], {
      detached: true,
      stdio: 'ignore',
    });
    serverProcess.unref();

    // Wait a moment for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const port = existingConfig.server.port || 3847;
    const url = `http://localhost:${port}/settings`;

    webSpinner.stop('Server started!');

    p.note(
      [
        chalk.dim('Opening your browser to:'),
        chalk.cyan(url),
        '',
        chalk.dim('Configure your AI providers in the Settings page.'),
      ].join('\n'),
      'Web Setup'
    );

    await openBrowser(url);

    p.outro(
      chalk.green('✓ Server running! ') +
        chalk.dim('Complete setup in your browser.')
    );
    return;
  }

  const answers = await p.group(
    {
      port: () =>
        p.text({
          message: 'Gateway server port',
          placeholder: '3847',
          initialValue: String(existingConfig.server.port),
          validate: (value) => {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1 || num > 65535) {
              return 'Please enter a valid port number (1-65535)';
            }
          },
        }),

      aiProvider: () =>
        p.select({
          message: 'AI provider for workflow generation',
          options: [
            { value: 'none', label: 'None (skip for now)' },
            { value: 'anthropic', label: 'Anthropic (Claude)' },
            { value: 'openai', label: 'OpenAI (GPT)' },
            { value: 'ollama', label: 'Ollama (local models)' },
          ],
        }),

      openaiAuthMethod: ({ results }) => {
        if (results.aiProvider !== 'openai') {
          return Promise.resolve(undefined);
        }
        return p.select({
          message: 'How would you like to authenticate with OpenAI?',
          options: [
            { value: 'oauth', label: 'Sign in with OpenAI - Recommended' },
            { value: 'apikey', label: 'API Key (separate API billing)' },
          ],
        });
      },

      aiApiKey: ({ results }) => {
        if (results.aiProvider === 'none' || results.aiProvider === 'ollama') {
          return Promise.resolve(undefined);
        }
        // Skip if OpenAI with OAuth
        if (results.aiProvider === 'openai' && results.openaiAuthMethod === 'oauth') {
          return Promise.resolve(undefined);
        }
        return p.password({
          message: `Enter your ${results.aiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`,
          validate: (value) => {
            if (!value || value.length < 10) {
              return 'Please enter a valid API key';
            }
          },
        });
      },

      setupWebSearch: () =>
        p.confirm({
          message: 'Set up web search for AI agents? (requires Brave Search API key - free tier available)',
          initialValue: true,
        }),

      braveApiKey: ({ results }) => {
        if (!results.setupWebSearch) {
          return Promise.resolve(undefined);
        }
        p.note(
          [
            chalk.dim('Get a free API key at: ') + chalk.cyan('https://brave.com/search/api/'),
            chalk.dim('Choose the "Data for Search" plan (2000 free queries/month)'),
          ].join('\n'),
          'Brave Search API'
        );
        return p.password({
          message: 'Enter your Brave Search API key (or press Enter to skip)',
          validate: (value) => {
            if (value && value.length > 0 && value.length < 10) {
              return 'Please enter a valid API key or leave empty to skip';
            }
          },
        });
      },
    },
    {
      onCancel: () => {
        p.cancel('Setup cancelled');
        process.exit(0);
      },
    }
  );

  // Handle OpenAI OAuth flow if selected
  let oauthTokens: { accessToken: string; refreshToken?: string; expiresAt?: number } | undefined;

  if (answers.aiProvider === 'openai' && answers.openaiAuthMethod === 'oauth') {
    const oauthSpinner = p.spinner();
    oauthSpinner.start('Starting OAuth authentication...');

    try {
      // Generate PKCE challenge
      const pkce = generatePKCE();
      const oauthPort = getOAuthCallbackPort();
      const redirectUri = getCallbackUrl();

      // Create a temporary server to receive the OAuth callback
      const callbackPromise = new Promise<{ code: string; state: string }>((resolve, reject) => {
        const server = createServer((req, res) => {
          const url = new URL(req.url || '', `http://localhost:${oauthPort}`);

          if (url.pathname === '/auth/callback') {
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');

            if (error) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>OAuth Error</title></head>
                <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff;">
                  <div style="text-align: center; padding: 40px;">
                    <h1 style="color: #ef4444;">Authentication Failed</h1>
                    <p style="color: #999;">${url.searchParams.get('error_description') || error}</p>
                    <p style="margin-top: 20px;">You can close this window.</p>
                  </div>
                </body>
                </html>
              `);
              server.close();
              reject(new Error(url.searchParams.get('error_description') || error));
              return;
            }

            if (code && state) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>OAuth Success</title></head>
                <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff;">
                  <div style="text-align: center; padding: 40px;">
                    <h1 style="color: #22c55e;">✓ Connected to OpenAI</h1>
                    <p style="color: #999;">You can close this window and return to the terminal.</p>
                  </div>
                </body>
                </html>
              `);
              server.close();
              resolve({ code, state });
            } else {
              res.writeHead(400);
              res.end('Missing code or state');
            }
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        });

        server.listen(oauthPort, '127.0.0.1', () => {
          // Server ready
        });

        // Timeout after 2 minutes
        setTimeout(() => {
          server.close();
          reject(new Error('OAuth timeout: No response received within 2 minutes'));
        }, 2 * 60 * 1000);
      });

      // Build and open authorization URL
      const authUrl = buildAuthorizationURL(pkce, redirectUri);
      oauthSpinner.stop('Opening browser for OpenAI sign-in...');

      p.note(
        [
          chalk.dim('A browser window will open for you to sign in to OpenAI.'),
          chalk.dim('After signing in, you will be redirected back to complete the setup.'),
        ].join('\n'),
        'OpenAI OAuth'
      );

      await openBrowser(authUrl);

      const waitSpinner = p.spinner();
      waitSpinner.start('Waiting for authentication...');

      // Wait for callback
      const { code, state } = await callbackPromise;

      // Validate state
      if (state !== pkce.state) {
        waitSpinner.stop('Authentication failed');
        throw new Error('OAuth state mismatch - possible CSRF attack');
      }

      waitSpinner.message('Exchanging code for tokens...');

      // Exchange code for tokens
      oauthTokens = await exchangeCodeForTokens(code, pkce.codeVerifier, redirectUri);

      waitSpinner.stop(chalk.green('✓') + ' Connected to OpenAI');
    } catch (err) {
      oauthSpinner.stop(chalk.red('✗') + ' OAuth authentication failed');
      p.log.error(String(err));
      p.cancel('Setup cancelled due to OAuth failure');
      process.exit(1);
    }
  }

  const s = p.spinner();
  s.start('Creating configuration...');

  await ensureConfigDir();

  const config: WeavrConfig = {
    ...existingConfig,
    server: {
      ...existingConfig.server,
      port: parseInt(answers.port as string, 10),
    },
  };

  if (answers.aiProvider && answers.aiProvider !== 'none') {
    if (answers.aiProvider === 'openai' && answers.openaiAuthMethod === 'oauth' && oauthTokens) {
      // OAuth-based OpenAI configuration
      config.ai = {
        provider: 'openai',
        authMethod: 'oauth',
        oauth: oauthTokens,
      };
    } else {
      // API key-based configuration
      config.ai = {
        provider: answers.aiProvider as 'anthropic' | 'openai' | 'ollama',
        apiKey: answers.aiApiKey as string | undefined,
        authMethod: 'apikey',
      };
    }
  }

  // Add web search config if Brave API key was provided
  if (answers.braveApiKey) {
    config.webSearch = {
      provider: 'brave',
      apiKey: answers.braveApiKey as string,
    };
  }

  await saveConfig(config);

  s.stop('Configuration saved!');

  const noteLines = [
    `${chalk.dim('Config:')} ${WEAVR_DIR}/config.yaml`,
    `${chalk.dim('Workflows:')} ${WEAVR_DIR}/workflows/`,
    `${chalk.dim('Plugins:')} ${WEAVR_DIR}/plugins/`,
  ];

  if (!answers.braveApiKey && answers.setupWebSearch) {
    noteLines.push('');
    noteLines.push(chalk.yellow('⚠ Web search not configured. Set BRAVE_API_KEY env var or run onboard again.'));
  }

  p.note(noteLines.join('\n'), 'Your Weavr home');

  // Start the server and open the UI
  const serverSpinner = p.spinner();
  serverSpinner.start('Starting Weavr server...');

  const { spawn } = await import('node:child_process');
  const serverProcess = spawn('node', [process.argv[1].replace(/onboard.*$/, 'serve')], {
    detached: true,
    stdio: 'ignore',
  });
  serverProcess.unref();

  // Wait for server to be ready
  const port = config.server.port || 3847;
  const maxAttempts = 20;
  let ready = false;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server not ready yet
    }
  }

  if (ready) {
    serverSpinner.stop('Server started!');
    const url = `http://localhost:${port}`;

    p.note(
      [
        chalk.dim('Weavr is running at:'),
        chalk.cyan(url),
        '',
        chalk.dim('Opening in your browser...'),
      ].join('\n'),
      'Ready!'
    );

    await openBrowser(url);

    p.outro(
      chalk.green('✓ Setup complete! ') +
        chalk.dim('Weavr is running in the background.')
    );
  } else {
    serverSpinner.stop('Server may still be starting...');
    p.outro(
      chalk.green('✓ Setup complete! ') +
        chalk.dim('Run ') +
        chalk.cyan('weavr serve') +
        chalk.dim(' if the server didn\'t start.')
    );
  }
}

async function runNonInteractiveOnboard(
  existingConfig: WeavrConfig,
  options: OnboardOptions
): Promise<void> {
  const portValue = options.port ?? String(existingConfig.server.port);
  const port = parseInt(portValue, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    console.error(chalk.red(`Invalid port: ${portValue}`));
    process.exit(1);
  }

  const config: WeavrConfig = {
    ...existingConfig,
    server: {
      ...existingConfig.server,
      port,
      host: options.host ?? existingConfig.server.host,
    },
  };

  const provider = options.aiProvider ?? existingConfig.ai?.provider ?? 'none';
  const authMethod = options.openaiAuth ?? options.openaiAuthMethod ?? existingConfig.ai?.authMethod ?? 'apikey';
  const model = existingConfig.ai?.model;

  if (provider === 'none') {
    delete config.ai;
  } else if (provider === 'ollama') {
    config.ai = { provider: 'ollama', model };
  } else if (provider === 'openai') {
    if (authMethod === 'oauth') {
      console.error(chalk.red('OpenAI OAuth requires an interactive TTY session.'));
      console.error(chalk.dim('Re-run without --non-interactive or use --openai-auth apikey.'));
      process.exit(1);
    }
    const apiKey = options.apiKey ?? existingConfig.ai?.apiKey ?? process.env.OPENAI_API_KEY;
    config.ai = { provider: 'openai', apiKey, authMethod: 'apikey', model };
    if (!apiKey) {
      console.warn(chalk.yellow('⚠ OpenAI API key missing. Set --api-key or OPENAI_API_KEY.'));
    }
  } else if (provider === 'anthropic') {
    const apiKey = options.apiKey ?? existingConfig.ai?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    config.ai = { provider: 'anthropic', apiKey, authMethod: 'apikey', model };
    if (!apiKey) {
      console.warn(chalk.yellow('⚠ Anthropic API key missing. Set --api-key or ANTHROPIC_API_KEY.'));
    }
  }

  if (options.skipWebSearch) {
    delete config.webSearch;
  } else if (options.braveApiKey) {
    config.webSearch = {
      provider: 'brave',
      apiKey: options.braveApiKey,
    };
  }

  await ensureConfigDir();
  await saveConfig(config);

  console.log(chalk.green('✓ Configuration saved'));
  console.log(chalk.dim(`Config: ${WEAVR_DIR}/config.yaml`));
  console.log(chalk.dim(`Workflows: ${WEAVR_DIR}/workflows/`));
  console.log(chalk.dim(`Plugins: ${WEAVR_DIR}/plugins/`));
}
