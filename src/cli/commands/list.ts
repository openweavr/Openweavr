import chalk from 'chalk';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKFLOWS_DIR, ensureConfigDir } from '../../config/index.js';
import { parser } from '../../engine/parser.js';

export async function listCommand(): Promise<void> {
  await ensureConfigDir();

  console.log(chalk.cyan('\n📋 Workflows\n'));

  let files: string[];
  try {
    files = await readdir(WORKFLOWS_DIR);
  } catch {
    console.log(chalk.dim('  No workflows directory found.'));
    console.log(chalk.dim('  Run `weavr create` to create your first workflow.\n'));
    return;
  }

  const workflowFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

  if (workflowFiles.length === 0) {
    console.log(chalk.dim('  No workflows found.'));
    console.log(chalk.dim('  Run `weavr create` to create your first workflow.\n'));
    return;
  }

  for (const file of workflowFiles) {
    const name = file.replace(/\.(yaml|yml)$/, '');
    const path = join(WORKFLOWS_DIR, file);

    try {
      const content = await readFile(path, 'utf-8');
      const workflow = parser.parse(content);

      console.log(`  ${chalk.bold(name)}`);

      if (workflow.description) {
        console.log(chalk.dim(`    ${workflow.description}`));
      }

      const triggerCount = workflow.triggers?.length ?? 0;
      const stepCount = workflow.steps.length;

      console.log(
        chalk.dim(`    ${triggerCount} trigger(s), ${stepCount} step(s)`)
      );
      console.log('');
    } catch (err) {
      console.log(`  ${chalk.bold(name)}`);
      console.log(chalk.red(`    ⚠ Invalid workflow: ${err instanceof Error ? err.message : 'parse error'}`));
      console.log('');
    }
  }

  console.log(chalk.dim(`${workflowFiles.length} workflow(s) in ${WORKFLOWS_DIR}\n`));
}
