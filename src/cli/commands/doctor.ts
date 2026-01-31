import chalk from 'chalk';
import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import {
  WEAVR_DIR,
  CONFIG_FILE,
  WORKFLOWS_DIR,
  PLUGINS_DIR,
  LOGS_DIR,
  loadConfig,
} from '../../config/index.js';

interface Check {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export async function doctorCommand(): Promise<void> {
  console.log(chalk.cyan('\n🩺 Weavr Doctor\n'));
  console.log(chalk.dim('Running diagnostics...\n'));

  const checks: Check[] = [];

  // Check Node.js version
  const nodeVersion = process.versions.node;
  const nodeMajor = parseInt(nodeVersion.split('.')[0], 10);
  checks.push({
    name: 'Node.js version',
    status: nodeMajor >= 22 ? 'pass' : nodeMajor >= 18 ? 'warn' : 'fail',
    message:
      nodeMajor >= 22
        ? `v${nodeVersion} (recommended)`
        : nodeMajor >= 18
          ? `v${nodeVersion} (works, but v22+ recommended)`
          : `v${nodeVersion} (v22+ required)`,
  });

  // Check config directory
  checks.push(await checkPath('Config directory', WEAVR_DIR));

  // Check config file
  checks.push(await checkPath('Config file', CONFIG_FILE));

  // Check workflows directory
  const workflowsCheck = await checkPath('Workflows directory', WORKFLOWS_DIR);
  checks.push(workflowsCheck);

  // Check for workflows
  if (workflowsCheck.status === 'pass') {
    try {
      const files = await readdir(WORKFLOWS_DIR);
      const workflows = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
      checks.push({
        name: 'Workflows found',
        status: workflows.length > 0 ? 'pass' : 'warn',
        message:
          workflows.length > 0
            ? `${workflows.length} workflow(s) configured`
            : 'No workflows yet (run `weavr create` to add one)',
      });
    } catch {
      checks.push({
        name: 'Workflows found',
        status: 'warn',
        message: 'Could not read workflows directory',
      });
    }
  }

  // Check plugins directory
  const pluginsCheck = await checkPath('Plugins directory', PLUGINS_DIR);
  checks.push(pluginsCheck);

  // Check for plugins
  if (pluginsCheck.status === 'pass') {
    try {
      const files = await readdir(PLUGINS_DIR);
      checks.push({
        name: 'Plugins found',
        status: files.length > 0 ? 'pass' : 'warn',
        message:
          files.length > 0
            ? `${files.length} plugin(s) installed`
            : 'No plugins installed (builtin plugins always available)',
      });
    } catch {
      checks.push({
        name: 'Plugins found',
        status: 'warn',
        message: 'Could not read plugins directory',
      });
    }
  }

  // Check logs directory
  checks.push(await checkPath('Logs directory', LOGS_DIR));

  // Check AI configuration
  try {
    const config = await loadConfig();
    if (config.ai?.provider) {
      const hasKey = Boolean(config.ai.apiKey) || config.ai.provider === 'ollama';
      checks.push({
        name: 'AI provider',
        status: hasKey ? 'pass' : 'warn',
        message: hasKey
          ? `${config.ai.provider} configured`
          : `${config.ai.provider} configured but missing API key`,
      });
    } else {
      checks.push({
        name: 'AI provider',
        status: 'warn',
        message: 'Not configured (optional, run `weavr onboard` to set up)',
      });
    }
  } catch {
    checks.push({
      name: 'AI provider',
      status: 'warn',
      message: 'Could not read config',
    });
  }

  // Print results
  for (const check of checks) {
    const icon =
      check.status === 'pass'
        ? chalk.green('✓')
        : check.status === 'warn'
          ? chalk.yellow('⚠')
          : chalk.red('✗');

    const statusColor =
      check.status === 'pass'
        ? chalk.green
        : check.status === 'warn'
          ? chalk.yellow
          : chalk.red;

    console.log(`  ${icon} ${chalk.bold(check.name)}`);
    console.log(`    ${statusColor(check.message)}\n`);
  }

  // Summary
  const passed = checks.filter((c) => c.status === 'pass').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  const failed = checks.filter((c) => c.status === 'fail').length;

  console.log(chalk.dim('─'.repeat(40)));

  if (failed > 0) {
    console.log(chalk.red(`\n✗ ${failed} issue(s) need attention\n`));
    console.log(chalk.dim('Run `weavr onboard` to fix configuration issues\n'));
    process.exit(1);
  } else if (warned > 0) {
    console.log(chalk.yellow(`\n⚠ ${warned} warning(s), ${passed} passed\n`));
    console.log(chalk.dim('Weavr should work, but some features may be limited\n'));
  } else {
    console.log(chalk.green(`\n✓ All ${passed} checks passed!\n`));
    console.log(chalk.dim('Weavr is ready. Run `weavr serve` to start.\n'));
  }
}

async function checkPath(name: string, path: string): Promise<Check> {
  try {
    await access(path, constants.R_OK);
    return {
      name,
      status: 'pass',
      message: path,
    };
  } catch {
    return {
      name,
      status: 'warn',
      message: `Not found: ${path}`,
    };
  }
}
