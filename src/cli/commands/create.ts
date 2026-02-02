import * as p from '@clack/prompts';
import chalk from 'chalk';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKFLOWS_DIR, ensureConfigDir } from '../../config/index.js';
import { isInteractive } from '../utils/tty.js';

interface CreateOptions {
  name?: string;
  description?: string;
  trigger?: 'webhook' | 'cron' | 'manual' | 'github';
  cron?: string;
  githubEvent?: string;
  nonInteractive?: boolean;
}

interface CreateAnswers {
  name: string;
  description?: string;
  triggerType: 'webhook' | 'cron' | 'manual' | 'github';
  cronSchedule?: string;
  githubEvent?: string;
}

export async function createCommand(options: CreateOptions = {}): Promise<void> {
  const interactive = !options.nonInteractive && isInteractive();

  if (!interactive) {
    await runNonInteractiveCreate(options);
    return;
  }

  console.clear();

  p.intro(chalk.magenta('🧵 Create a new workflow'));

  const answers = await p.group(
    {
      name: () =>
        p.text({
          message: 'Workflow name',
          placeholder: 'my-workflow',
          validate: (value) => {
            if (!value) return 'Name is required';
            if (!/^[a-z0-9-]+$/.test(value)) {
              return 'Name must be lowercase letters, numbers, and hyphens only';
            }
          },
        }),

      description: () =>
        p.text({
          message: 'Description (optional)',
          placeholder: 'What does this workflow do?',
        }),

      triggerType: () =>
        p.select({
          message: 'Trigger type',
          options: [
            { value: 'webhook', label: 'Webhook (HTTP POST)' },
            { value: 'cron', label: 'Schedule (cron)' },
            { value: 'manual', label: 'Manual only' },
            { value: 'github', label: 'GitHub event' },
          ],
        }),

      cronSchedule: ({ results }) => {
        if (results.triggerType !== 'cron') {
          return Promise.resolve(undefined);
        }
        return p.text({
          message: 'Cron schedule',
          placeholder: '0 9 * * *',
          initialValue: '0 9 * * *',
          validate: (value) => {
            const parts = value.trim().split(/\s+/);
            if (parts.length < 5) {
              return 'Enter a valid cron expression (e.g., "0 9 * * *" for 9am daily)';
            }
          },
        });
      },

      githubEvent: ({ results }) => {
        if (results.triggerType !== 'github') {
          return Promise.resolve(undefined);
        }
        return p.select({
          message: 'GitHub event type',
          options: [
            { value: 'push', label: 'Push to branch' },
            { value: 'pull_request', label: 'Pull request opened/updated' },
            { value: 'issue.opened', label: 'Issue opened' },
            { value: 'issue.labeled', label: 'Issue labeled' },
          ],
        });
      },
    },
    {
      onCancel: () => {
        p.cancel('Workflow creation cancelled');
        process.exit(0);
      },
    }
  ) as CreateAnswers;

  const s = p.spinner();
  s.start('Creating workflow file...');

  await ensureConfigDir();

  const yaml = buildWorkflowYaml({
    name: answers.name,
    description: answers.description,
    triggerType: answers.triggerType as CreateAnswers['triggerType'],
    cronSchedule: answers.cronSchedule,
    githubEvent: answers.githubEvent,
  });

  // Write file
  const filePath = join(WORKFLOWS_DIR, `${answers.name}.yaml`);
  await writeFile(filePath, yaml, 'utf-8');

  s.stop('Workflow created!');

  p.note(
    [
      chalk.dim('File: ') + filePath,
      '',
      chalk.dim('Run it:'),
      `  ${chalk.cyan(`weavr run ${answers.name}`)}`,
      '',
      chalk.dim('Edit it:'),
      `  ${chalk.cyan(`$EDITOR ${filePath}`)}`,
    ].join('\n'),
    'Next steps'
  );

  p.outro(chalk.green('✓ Workflow created successfully!'));
}

async function runNonInteractiveCreate(options: CreateOptions): Promise<void> {
  const name = options.name;
  if (!name) {
    console.error(chalk.red('Missing required --name for non-interactive create.'));
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error(chalk.red('Name must be lowercase letters, numbers, and hyphens only.'));
    process.exit(1);
  }

  const triggerType = options.trigger ?? 'manual';
  const cronSchedule = options.cron ?? '0 9 * * *';
  const githubEvent = options.githubEvent ?? 'push';

  const yaml = buildWorkflowYaml({
    name,
    description: options.description,
    triggerType,
    cronSchedule,
    githubEvent,
  });

  await ensureConfigDir();
  const filePath = join(WORKFLOWS_DIR, `${name}.yaml`);
  await writeFile(filePath, yaml, 'utf-8');

  console.log(chalk.green('✓ Workflow created'));
  console.log(chalk.dim(`File: ${filePath}`));
  console.log(chalk.dim(`Run it: weavr run ${name}`));
}

function buildWorkflowYaml(answers: CreateAnswers): string {
  let yaml = `name: ${answers.name}\n`;

  if (answers.description) {
    yaml += `description: ${answers.description}\n`;
  }

  yaml += '\n';

  if (answers.triggerType !== 'manual') {
    yaml += 'triggers:\n';

    switch (answers.triggerType) {
      case 'webhook':
        yaml += `  - type: http.webhook\n`;
        yaml += `    config:\n`;
        yaml += `      path: /webhook/${answers.name}\n`;
        break;

      case 'cron':
        yaml += `  - type: cron.schedule\n`;
        yaml += `    config:\n`;
        yaml += `      expression: "${answers.cronSchedule}"\n`;
        break;

      case 'github':
        yaml += `  - type: github.${answers.githubEvent}\n`;
        yaml += `    config:\n`;
        yaml += `      repo: your-org/your-repo\n`;
        break;
    }

    yaml += '\n';
  }

  yaml += 'steps:\n';
  yaml += '  - id: log-start\n';
  yaml += '    action: log\n';
  yaml += '    config:\n';
  yaml += `      message: "Workflow ${answers.name} started"\n`;
  yaml += '\n';
  yaml += '  # Add your steps here\n';
  yaml += '  # - id: my-step\n';
  yaml += '  #   action: plugin.action\n';
  yaml += '  #   config:\n';
  yaml += '  #     key: value\n';

  return yaml;
}
