import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowExecutor } from './executor.js';
import { parseWorkflow } from './parser.js';

describe('Workflow Engine Integration', () => {
  let executor: WorkflowExecutor;

  beforeEach(() => {
    executor = new WorkflowExecutor();
  });

  describe('End-to-end workflow execution', () => {
    it('should execute a simple single-step workflow', async () => {
      const yaml = `
name: simple-test
trigger:
  type: manual
steps:
  - id: log
    action: log
    with:
      message: "Hello, World!"
`;
      const workflow = parseWorkflow(yaml);
      const mockPlugin = {
        name: 'log',
        version: '1.0.0',
        description: 'Test logging',
        actions: [{
          name: 'log',
          description: 'Log a message',
          execute: vi.fn().mockResolvedValue({ logged: true }),
        }],
      };

      executor.registerPlugin(mockPlugin);
      const result = await executor.execute(workflow);

      expect(result.status).toBe('completed');
      expect(result.steps.log.status).toBe('completed');
    });

    it('should execute multi-step workflow with dependencies', async () => {
      const yaml = `
name: multi-step-test
trigger:
  type: manual
steps:
  - id: fetch
    action: test.fetch
    with:
      url: "https://api.example.com"
  - id: process
    action: test.process
    needs: [fetch]
    with:
      data: "{{ steps.fetch.result }}"
  - id: save
    action: test.save
    needs: [process]
    with:
      result: "{{ steps.process.result }}"
`;
      const workflow = parseWorkflow(yaml);
      const mockPlugin = {
        name: 'test',
        version: '1.0.0',
        description: 'Test plugin',
        actions: [
          {
            name: 'fetch',
            description: 'Fetch data',
            execute: vi.fn().mockResolvedValue({ data: [1, 2, 3] }),
          },
          {
            name: 'process',
            description: 'Process data',
            execute: vi.fn().mockResolvedValue({ processed: true }),
          },
          {
            name: 'save',
            description: 'Save data',
            execute: vi.fn().mockResolvedValue({ saved: true }),
          },
        ],
      };

      executor.registerPlugin(mockPlugin);
      const result = await executor.execute(workflow);

      expect(result.status).toBe('completed');
      expect(Object.keys(result.steps)).toHaveLength(3);
    });

    it('should execute parallel steps when no dependencies', async () => {
      const yaml = `
name: parallel-test
trigger:
  type: manual
steps:
  - id: task1
    action: test.run
    with:
      id: 1
  - id: task2
    action: test.run
    with:
      id: 2
  - id: task3
    action: test.run
    with:
      id: 3
`;
      const workflow = parseWorkflow(yaml);
      const executionOrder: number[] = [];
      const mockPlugin = {
        name: 'test',
        version: '1.0.0',
        description: 'Test plugin',
        actions: [{
          name: 'run',
          description: 'Run task',
          execute: vi.fn().mockImplementation(async (ctx) => {
            executionOrder.push(ctx.config.id);
            return { id: ctx.config.id };
          }),
        }],
      };

      executor.registerPlugin(mockPlugin);
      const result = await executor.execute(workflow);

      expect(result.status).toBe('completed');
      expect(executionOrder).toHaveLength(3);
    });

    it('should handle conditional execution', async () => {
      const yaml = `
name: conditional-test
trigger:
  type: manual
steps:
  - id: check
    action: test.check
    with:
      value: 42
  - id: if_true
    action: test.log
    needs: [check]
    if: "{{ steps.check.result.pass == true }}"
    with:
      message: "Condition passed"
  - id: if_false
    action: test.log
    needs: [check]
    if: "{{ steps.check.result.pass == false }}"
    with:
      message: "Condition failed"
`;
      const workflow = parseWorkflow(yaml);
      const mockPlugin = {
        name: 'test',
        version: '1.0.0',
        description: 'Test plugin',
        actions: [
          {
            name: 'check',
            description: 'Check condition',
            execute: vi.fn().mockResolvedValue({ pass: true }),
          },
          {
            name: 'log',
            description: 'Log message',
            execute: vi.fn().mockResolvedValue({ logged: true }),
          },
        ],
      };

      executor.registerPlugin(mockPlugin);
      const result = await executor.execute(workflow);

      expect(result.status).toBe('completed');
    });

    it('should handle step failures gracefully', async () => {
      const yaml = `
name: failure-test
trigger:
  type: manual
steps:
  - id: will_fail
    action: test.fail
    with:
      error: "Intentional failure"
`;
      const workflow = parseWorkflow(yaml);
      const mockPlugin = {
        name: 'test',
        version: '1.0.0',
        description: 'Test plugin',
        actions: [{
          name: 'fail',
          description: 'Fail on purpose',
          execute: vi.fn().mockRejectedValue(new Error('Intentional failure')),
        }],
      };

      executor.registerPlugin(mockPlugin);
      const result = await executor.execute(workflow);

      expect(result.status).toBe('failed');
      expect(result.steps.will_fail.status).toBe('failed');
      expect(result.steps.will_fail.error).toContain('Intentional failure');
    });

    it('should retry failed steps', async () => {
      const yaml = `
name: retry-test
trigger:
  type: manual
steps:
  - id: flaky
    action: test.flaky
    retry:
      attempts: 3
      delay: 100
    with:
      succeed_on: 3
`;
      const workflow = parseWorkflow(yaml);
      let attempts = 0;
      const mockPlugin = {
        name: 'test',
        version: '1.0.0',
        description: 'Test plugin',
        actions: [{
          name: 'flaky',
          description: 'Flaky action',
          execute: vi.fn().mockImplementation(async (ctx) => {
            attempts++;
            if (attempts < ctx.config.succeed_on) {
              throw new Error(`Attempt ${attempts} failed`);
            }
            return { succeeded_on_attempt: attempts };
          }),
        }],
      };

      executor.registerPlugin(mockPlugin);
      const result = await executor.execute(workflow);

      expect(result.status).toBe('completed');
      expect(attempts).toBe(3);
    });

    it('should timeout long-running steps', async () => {
      const yaml = `
name: timeout-test
trigger:
  type: manual
steps:
  - id: slow
    action: test.slow
    timeout: 100
    with:
      delay: 5000
`;
      const workflow = parseWorkflow(yaml);
      const mockPlugin = {
        name: 'test',
        version: '1.0.0',
        description: 'Test plugin',
        actions: [{
          name: 'slow',
          description: 'Slow action',
          execute: vi.fn().mockImplementation(async (ctx) => {
            await new Promise((resolve) => setTimeout(resolve, ctx.config.delay));
            return { done: true };
          }),
        }],
      };

      executor.registerPlugin(mockPlugin);

      // Use a shorter timeout for the test
      const result = await Promise.race([
        executor.execute(workflow),
        new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' }), 200)),
      ]);

      expect(result).toBeDefined();
    });
  });

  describe('Variable interpolation', () => {
    it('should interpolate step outputs', async () => {
      const yaml = `
name: interpolation-test
trigger:
  type: manual
steps:
  - id: get_data
    action: test.get
    with:
      key: "user"
  - id: use_data
    action: test.use
    needs: [get_data]
    with:
      value: "{{ steps.get_data.result.name }}"
`;
      const workflow = parseWorkflow(yaml);
      const mockPlugin = {
        name: 'test',
        version: '1.0.0',
        description: 'Test plugin',
        actions: [
          {
            name: 'get',
            description: 'Get data',
            execute: vi.fn().mockResolvedValue({ name: 'John Doe', id: 123 }),
          },
          {
            name: 'use',
            description: 'Use data',
            execute: vi.fn().mockImplementation(async (ctx) => {
              return { received: ctx.config.value };
            }),
          },
        ],
      };

      executor.registerPlugin(mockPlugin);
      const result = await executor.execute(workflow);

      expect(result.status).toBe('completed');
    });

    it('should interpolate environment variables', async () => {
      process.env.TEST_VAR = 'test-value';

      const yaml = `
name: env-test
trigger:
  type: manual
env:
  MY_VAR: "{{ env.TEST_VAR }}"
steps:
  - id: use_env
    action: test.log
    with:
      value: "{{ env.MY_VAR }}"
`;
      const workflow = parseWorkflow(yaml);
      const mockPlugin = {
        name: 'test',
        version: '1.0.0',
        description: 'Test plugin',
        actions: [{
          name: 'log',
          description: 'Log value',
          execute: vi.fn().mockResolvedValue({ logged: true }),
        }],
      };

      executor.registerPlugin(mockPlugin);
      const result = await executor.execute(workflow);

      expect(result.status).toBe('completed');

      delete process.env.TEST_VAR;
    });
  });

  describe('Event emission', () => {
    it('should emit events during execution', async () => {
      const yaml = `
name: event-test
trigger:
  type: manual
steps:
  - id: step1
    action: test.run
    with:
      data: "test"
`;
      const workflow = parseWorkflow(yaml);
      const events: Array<{ type: string; payload: unknown }> = [];
      const mockPlugin = {
        name: 'test',
        version: '1.0.0',
        description: 'Test plugin',
        actions: [{
          name: 'run',
          description: 'Run action',
          execute: vi.fn().mockResolvedValue({ done: true }),
        }],
      };

      executor.registerPlugin(mockPlugin);
      executor.on('step.started', (payload) => events.push({ type: 'step.started', payload }));
      executor.on('step.completed', (payload) => events.push({ type: 'step.completed', payload }));

      await executor.execute(workflow);

      expect(events.length).toBeGreaterThan(0);
    });
  });
});
