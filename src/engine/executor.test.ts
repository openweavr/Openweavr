import { describe, it, expect } from 'vitest';
import { WorkflowExecutor } from './executor.js';
import { PluginRegistry } from '../plugins/sdk/registry.js';
import type { Workflow } from '../types/index.js';

describe('WorkflowExecutor', () => {
  it('should execute a simple workflow', async () => {
    const registry = new PluginRegistry();
    const executor = new WorkflowExecutor({ registry });

    const workflow: Workflow = {
      name: 'test-workflow',
      steps: [
        {
          id: 'step1',
          action: 'log',
          config: { message: 'Hello, test!' },
        },
      ],
    };

    const run = await executor.execute(workflow);

    expect(run.status).toBe('completed');
    expect(run.workflowName).toBe('test-workflow');
    expect(run.steps.get('step1')?.status).toBe('completed');
  });

  it('should execute steps in dependency order', async () => {
    const registry = new PluginRegistry();
    const executionOrder: string[] = [];

    const executor = new WorkflowExecutor({
      registry,
      onStepComplete: (_runId, stepId) => {
        executionOrder.push(stepId);
      },
    });

    const workflow: Workflow = {
      name: 'dependency-test',
      steps: [
        {
          id: 'step1',
          action: 'log',
          config: { message: 'First' },
        },
        {
          id: 'step2',
          action: 'log',
          config: { message: 'Second' },
          depends_on: ['step1'],
        },
        {
          id: 'step3',
          action: 'log',
          config: { message: 'Third' },
          depends_on: ['step2'],
        },
      ],
    };

    const run = await executor.execute(workflow);

    expect(run.status).toBe('completed');
    expect(executionOrder).toEqual(['step1', 'step2', 'step3']);
  });

  it('should interpolate template variables', async () => {
    const registry = new PluginRegistry();
    const executor = new WorkflowExecutor({ registry });

    const workflow: Workflow = {
      name: 'template-test',
      steps: [
        {
          id: 'transform',
          action: 'transform',
          config: { template: 'Hello, {{ env.NAME }}!' },
        },
      ],
      env: { NAME: 'World' },
    };

    const run = await executor.execute(workflow);

    expect(run.status).toBe('completed');
    expect(run.steps.get('transform')?.output).toBe('Hello, World!');
  });

  it('should handle trigger data', async () => {
    const registry = new PluginRegistry();
    const executor = new WorkflowExecutor({ registry });

    const workflow: Workflow = {
      name: 'trigger-test',
      steps: [
        {
          id: 'transform',
          action: 'transform',
          config: { template: 'Event: {{ trigger.type }}' },
        },
      ],
    };

    const run = await executor.execute(workflow, { type: 'webhook' });

    expect(run.status).toBe('completed');
    expect(run.steps.get('transform')?.output).toBe('Event: webhook');
  });
});
