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
  .action(onboardCommand);

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
  .action(createCommand);

program
  .command('ask <prompt...>')
  .description('Generate a workflow from natural language')
  .action(async (promptParts: string[]) => {
    const prompt = promptParts.join(' ');
    await askCommand(prompt);
  });

program.parse();
