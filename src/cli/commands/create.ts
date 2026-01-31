import * as p from '@clack/prompts';
import chalk from 'chalk';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKFLOWS_DIR, ensureConfigDir } from '../../config/index.js';

export async function createCommand(): Promise<void> {
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
  );

  const s = p.spinner();
  s.start('Creating workflow file...');

  await ensureConfigDir();

  // Build workflow YAML
  let yaml = `name: ${answers.name}\n`;

  if (answers.description) {
    yaml += `description: ${answers.description}\n`;
  }

  yaml += '\n';

  // Add trigger
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

  // Add example steps
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
