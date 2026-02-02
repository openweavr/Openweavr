#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { serveCommand } from './commands/serve.js';
import { onboardCommand } from './commands/onboard.js';
import { doctorCommand } from './commands/doctor.js';
import { runCommand } from './commands/run.js';
import { listCommand } from './commands/list.js';
import { createCommand } from './commands/create.js';
import { askCommand } from './commands/ask.js';

const program = new Command();

const banner = `
${chalk.magenta('╭───────────────────────────────────────╮')}
${chalk.magenta('│')}  ${chalk.bold.white('🧵 Weavr')}                         ${chalk.magenta('│')}
${chalk.magenta('│')}  ${chalk.dim('Weave your dev life together')}         ${chalk.magenta('│')}
${chalk.magenta('╰───────────────────────────────────────╯')}
`;

program
  .name('weavr')
  .description('Self-hosted workflow automation with AI agents')
  .version('0.1.0')
  .addHelpText('before', banner);

program
  .command('serve')
  .description('Start the gateway server')
  .option('-p, --port <port>', 'Port to listen on', '3847')
  .option('-h, --host <host>', 'Host to bind to', 'localhost')
  .action(serveCommand);

program
  .command('onboard')
  .description('Interactive setup wizard')
  .option('--port <port>', 'Gateway server port')
  .option('--host <host>', 'Gateway server host')
  .option('--ai-provider <provider>', 'none | anthropic | openai | ollama')
  .option('--openai-auth <method>', 'oauth | apikey')
  .option('--api-key <key>', 'AI provider API key')
  .option('--brave-api-key <key>', 'Brave Search API key')
  .option('--skip-web-search', 'Skip configuring web search')
  .option('--non-interactive', 'Disable prompts and use flags/defaults')
  .action((options) => onboardCommand(options));

program
  .command('doctor')
  .description('Diagnose configuration issues')
  .action(doctorCommand);

program
  .command('run <workflow>')
  .description('Run a workflow manually')
  .option('-d, --data <json>', 'Trigger data as JSON')
  .action(runCommand);

program
  .command('list')
  .alias('ls')
  .description('List all workflows')
  .action(listCommand);

program
  .command('create')
  .description('Create a new workflow interactively')
  .option('--name <name>', 'Workflow name (for non-interactive)')
  .option('--description <description>', 'Workflow description')
  .option('--trigger <type>', 'webhook | cron | manual | github')
  .option('--cron <expression>', 'Cron expression for cron trigger')
  .option('--github-event <event>', 'GitHub event name for github trigger')
  .option('--non-interactive', 'Disable prompts and use flags/defaults')
  .action((options) => createCommand(options));

program
  .command('ask <prompt...>')
  .description('Generate a workflow from natural language')
  .option('--save', 'Save generated workflow with suggested name')
  .option('--save-as <name>', 'Save generated workflow under a custom name')
  .option('--output <file>', 'Write generated YAML to a file')
  .option('--non-interactive', 'Disable prompts and use flags/defaults')
  .action(async (promptParts: string[], options) => {
    const prompt = promptParts.join(' ');
    await askCommand(prompt, options);
  });

program.parse();
