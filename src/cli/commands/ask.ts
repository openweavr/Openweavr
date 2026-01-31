import * as p from '@clack/prompts';
import chalk from 'chalk';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, WORKFLOWS_DIR, ensureConfigDir } from '../../config/index.js';
import { createProvider, WorkflowGenerator, type AIProvider } from '../../agent/index.js';
import { AnthropicProvider } from '../../agent/providers/anthropic.js';
import { OpenAIProvider } from '../../agent/providers/openai.js';

export async function askCommand(prompt: string): Promise<void> {
  console.log(chalk.cyan('\n🤖 Weavr AI\n'));

  const config = await loadConfig();
  let provider = createProvider(config);

  if (!provider) {
    console.log(chalk.yellow('⚠ No AI provider configured.\n'));
    console.log(chalk.dim('Run `weavr onboard` to set up an AI provider, or set one of:'));
    console.log(chalk.dim('  - ANTHROPIC_API_KEY (for Claude)'));
    console.log(chalk.dim('  - OPENAI_API_KEY (for GPT)'));
    console.log(chalk.dim('  - Or use Ollama for local models\n'));

    // Check for environment variables as fallback
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (anthropicKey) {
      console.log(chalk.green('Found ANTHROPIC_API_KEY in environment, using Claude...\n'));
      provider = new AnthropicProvider(anthropicKey);
    } else if (openaiKey) {
      console.log(chalk.green('Found OPENAI_API_KEY in environment, using GPT...\n'));
      provider = new OpenAIProvider(openaiKey);
    } else {
      process.exit(1);
    }
  } else {
    console.log(chalk.dim(`Using ${provider.name} provider\n`));
  }

  await generateWorkflow(provider, prompt);
}

async function generateWorkflow(provider: AIProvider, prompt: string): Promise<void> {
  const s = p.spinner();
  s.start('Generating workflow...');

  try {
    const generator = new WorkflowGenerator({ provider });

    const { workflow, yaml } = await generator.generate(prompt);

    s.stop('Workflow generated!');

    console.log(chalk.dim('─'.repeat(50)));
    console.log('');
    console.log(chalk.bold(`📋 ${workflow.name}`));
    if (workflow.description) {
      console.log(chalk.dim(workflow.description));
    }
    console.log('');
    console.log(chalk.dim('─'.repeat(50)));
    console.log(chalk.cyan(yaml));
    console.log(chalk.dim('─'.repeat(50)));
    console.log('');

    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'save', label: 'Save workflow' },
        { value: 'refine', label: 'Refine with feedback' },
        { value: 'explain', label: 'Explain this workflow' },
        { value: 'discard', label: 'Discard' },
      ],
    });

    if (p.isCancel(action)) {
      p.cancel('Cancelled');
      process.exit(0);
    }

    switch (action) {
      case 'save':
        await saveWorkflow(workflow.name, yaml);
        break;

      case 'refine':
        await refineWorkflow(generator, yaml);
        break;

      case 'explain':
        const explanation = await generator.explain(yaml);
        console.log('\n' + chalk.bold('Explanation:'));
        console.log(explanation + '\n');
        break;

      case 'discard':
        console.log(chalk.dim('\nWorkflow discarded.\n'));
        break;
    }
  } catch (err) {
    s.stop('Failed to generate workflow');
    console.log(chalk.red(`\n✗ Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
}

async function saveWorkflow(name: string, yaml: string): Promise<void> {
  await ensureConfigDir();

  const filename = await p.text({
    message: 'Workflow filename',
    initialValue: name,
    validate: (value) => {
      if (!value) return 'Filename is required';
      if (!/^[a-z0-9-]+$/.test(value)) {
        return 'Use lowercase letters, numbers, and hyphens only';
      }
    },
  });

  if (p.isCancel(filename)) {
    p.cancel('Cancelled');
    return;
  }

  const filePath = join(WORKFLOWS_DIR, `${filename}.yaml`);
  await writeFile(filePath, yaml, 'utf-8');

  console.log(chalk.green(`\n✓ Saved to ${filePath}`));
  console.log(chalk.dim(`\nRun it with: weavr run ${filename}\n`));
}

async function refineWorkflow(
  generator: InstanceType<typeof WorkflowGenerator>,
  currentYaml: string
): Promise<void> {
  const feedback = await p.text({
    message: 'What would you like to change?',
    placeholder: 'e.g., "Add error handling" or "Post to #alerts instead"',
  });

  if (p.isCancel(feedback) || !feedback) {
    return;
  }

  const s = p.spinner();
  s.start('Refining workflow...');

  try {
    const { workflow, yaml } = await generator.refine(currentYaml, feedback);

    s.stop('Workflow refined!');

    console.log(chalk.dim('─'.repeat(50)));
    console.log(chalk.cyan(yaml));
    console.log(chalk.dim('─'.repeat(50)));

    const save = await p.confirm({
      message: 'Save this workflow?',
    });

    if (save) {
      await saveWorkflow(workflow.name, yaml);
    }
  } catch (err) {
    s.stop('Failed to refine workflow');
    console.log(chalk.red(`\n✗ Error: ${err instanceof Error ? err.message : String(err)}\n`));
  }
}
