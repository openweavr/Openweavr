import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKFLOWS_DIR } from '../../config/index.js';
import { WorkflowExecutor } from '../../engine/executor.js';
import { parser } from '../../engine/parser.js';
import { globalRegistry } from '../../plugins/sdk/registry.js';
import { loadBuiltinPlugins } from '../../plugins/loader.js';

interface RunOptions {
  data?: string;
}

export async function runCommand(workflowName: string, options: RunOptions): Promise<void> {
  // Load built-in plugins
  loadBuiltinPlugins();

  console.log(chalk.cyan(`\n▶ Running workflow: ${chalk.bold(workflowName)}\n`));

  // Load workflow file
  const workflowPath = join(WORKFLOWS_DIR, `${workflowName}.yaml`);

  let content: string;
  try {
    content = await readFile(workflowPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(chalk.red(`✗ Workflow not found: ${workflowPath}`));
      console.log(chalk.dim('\nAvailable workflows:'));
      console.log(chalk.dim('  Run `weavr list` to see all workflows\n'));
      process.exit(1);
    }
    throw err;
  }

  // Parse workflow
  let workflow;
  try {
    workflow = parser.parse(content);
  } catch (err) {
    console.log(chalk.red('✗ Invalid workflow file:'));
    console.log(chalk.dim(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  // Parse trigger data
  let triggerData: unknown;
  if (options.data) {
    try {
      triggerData = JSON.parse(options.data);
    } catch {
      console.log(chalk.red('✗ Invalid JSON in --data option'));
      process.exit(1);
    }
  }

  // Create executor
  const executor = new WorkflowExecutor({
    registry: globalRegistry,
    onStepStart: (_runId, stepId) => {
      console.log(chalk.dim(`  ⏳ ${stepId}...`));
    },
    onStepComplete: (_runId, stepId, result) => {
      if (result.status === 'completed') {
        console.log(chalk.green(`  ✓ ${stepId}`) + chalk.dim(` (${result.duration}ms)`));
      } else if (result.status === 'failed') {
        console.log(chalk.red(`  ✗ ${stepId}: ${result.error}`));
      }
    },
  });

  // Execute workflow
  const startTime = Date.now();

  try {
    const run = await executor.execute(workflow, triggerData);
    const duration = Date.now() - startTime;

    console.log('');

    if (run.status === 'completed') {
      console.log(chalk.green(`✓ Workflow completed`) + chalk.dim(` in ${duration}ms`));
      console.log(chalk.dim(`  Run ID: ${run.id}\n`));
    } else {
      console.log(chalk.red(`✗ Workflow failed: ${run.error}`));
      console.log(chalk.dim(`  Run ID: ${run.id}\n`));
      process.exit(1);
    }
  } catch (err) {
    console.log(chalk.red(`\n✗ Execution error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
}
