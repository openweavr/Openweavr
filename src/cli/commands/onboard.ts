import * as p from '@clack/prompts';
import chalk from 'chalk';
import { ensureConfigDir, saveConfig, loadConfig, WEAVR_DIR } from '../../config/index.js';
import type { WeavrConfig } from '../../types/index.js';

export async function onboardCommand(): Promise<void> {
  console.clear();

  p.intro(chalk.magenta('🧵 Welcome to Weavr!'));

  const existingConfig = await loadConfig();

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

      aiApiKey: ({ results }) => {
        if (results.aiProvider === 'none' || results.aiProvider === 'ollama') {
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
    config.ai = {
      provider: answers.aiProvider as 'anthropic' | 'openai' | 'ollama',
      apiKey: answers.aiApiKey as string | undefined,
    };
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

  p.outro(
    chalk.green('✓ Setup complete! ') +
      chalk.dim('Run ') +
      chalk.cyan('weavr serve') +
      chalk.dim(' to start the gateway.')
  );
}
