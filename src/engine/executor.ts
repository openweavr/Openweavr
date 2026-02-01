import { randomUUID } from 'node:crypto';
import type { Workflow, Step, WorkflowRun, StepResult, ActionContext } from '../types/index.js';
import type { PluginRegistry } from '../plugins/sdk/registry.js';

export interface ExecutorOptions {
  registry: PluginRegistry;
  onStepStart?: (runId: string, stepId: string) => void;
  onStepComplete?: (runId: string, stepId: string, result: StepResult) => void;
  onRunComplete?: (run: WorkflowRun) => void;
  onLog?: (runId: string, stepId: string, message: string) => void;
}

export class WorkflowExecutor {
  private runs = new Map<string, WorkflowRun>();

  constructor(private options: ExecutorOptions) {}

  async execute(workflow: Workflow, triggerData?: unknown, providedRunId?: string): Promise<WorkflowRun> {
    const runId = providedRunId ?? randomUUID();

    const run: WorkflowRun = {
      id: runId,
      workflowName: workflow.name,
      status: 'running',
      triggerData,
      steps: new Map(),
      startedAt: new Date(),
    };

    this.runs.set(runId, run);

    // Initialize all steps as pending
    for (const step of workflow.steps) {
      run.steps.set(step.id, {
        id: step.id,
        status: 'pending',
      });
    }

    try {
      // Build dependency graph
      const graph = this.buildDependencyGraph(workflow.steps);

      // Execute steps in topological order
      await this.executeGraph(run, workflow, graph);

      run.status = 'completed';
      run.completedAt = new Date();
    } catch (err) {
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : String(err);
      run.completedAt = new Date();
    }

    this.options.onRunComplete?.(run);
    return run;
  }

  private buildDependencyGraph(steps: Step[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    for (const step of steps) {
      graph.set(step.id, new Set(step.depends_on ?? []));
    }

    return graph;
  }

  private async executeGraph(
    run: WorkflowRun,
    workflow: Workflow,
    graph: Map<string, Set<string>>
  ): Promise<void> {
    const completed = new Set<string>();
    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));

    while (completed.size < workflow.steps.length) {
      // Find steps that are ready to execute
      const ready: Step[] = [];

      for (const [stepId, deps] of graph) {
        if (completed.has(stepId)) continue;

        const allDepsCompleted = [...deps].every((dep) => completed.has(dep));
        if (allDepsCompleted) {
          const step = stepMap.get(stepId);
          if (step) ready.push(step);
        }
      }

      if (ready.length === 0 && completed.size < workflow.steps.length) {
        throw new Error('Circular dependency detected in workflow');
      }

      // Execute ready steps in parallel
      await Promise.all(
        ready.map((step) =>
          this.executeStep(run, workflow, step).then(() => {
            completed.add(step.id);
          })
        )
      );
    }
  }

  private async executeStep(
    run: WorkflowRun,
    workflow: Workflow,
    step: Step
  ): Promise<void> {
    const stepResult = run.steps.get(step.id)!;
    stepResult.status = 'running';
    stepResult.startedAt = new Date();

    this.options.onStepStart?.(run.id, step.id);

    try {
      // Get action from registry
      const action = this.options.registry.getAction(step.action);

      if (!action) {
        // Check if it's a built-in action
        const output = await this.executeBuiltinAction(step, run, workflow);
        stepResult.output = output;
        stepResult.status = 'completed';
      } else {
        // Build interpolation context
        const interpolationCtx = {
          trigger: run.triggerData,
          steps: this.getStepOutputs(run),
          env: workflow.env ?? {},
        };

        // Interpolate config values
        const interpolatedConfig = this.interpolateConfig(
          (step.config ?? {}) as Record<string, unknown>,
          interpolationCtx
        );

        // Build context for plugin action
        const context: ActionContext = {
          workflowName: workflow.name,
          runId: run.id,
          stepId: step.id,
          config: interpolatedConfig,
          trigger: run.triggerData,
          steps: this.getStepOutputs(run),
          env: workflow.env ?? {},
          log: (message: string) => {
            console.log(`[${workflow.name}:${step.id}] ${message}`);
            // Also send to run history via callback
            this.options.onLog?.(run.id, step.id, message);
          },
        };

        // Execute with retry
        const output = await this.executeWithRetry(
          () => action.execute(context),
          step.retry?.attempts ?? 1,
          step.retry?.delay ?? 1000
        );

        stepResult.output = output;
        stepResult.status = 'completed';
      }
    } catch (err) {
      stepResult.status = 'failed';
      stepResult.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      stepResult.completedAt = new Date();
      stepResult.duration =
        stepResult.completedAt.getTime() - (stepResult.startedAt?.getTime() ?? 0);

      this.options.onStepComplete?.(run.id, step.id, stepResult);
    }
  }

  private async executeBuiltinAction(
    step: Step,
    run: WorkflowRun,
    workflow: Workflow
  ): Promise<unknown> {
    const config = step.config ?? {};

    switch (step.action) {
      case 'transform': {
        const template = config.template as string;
        return this.interpolate(template, {
          trigger: run.triggerData,
          steps: this.getStepOutputs(run),
          env: workflow.env ?? {},
        });
      }

      case 'log': {
        const message = config.message as string;
        const interpolated = this.interpolate(message, {
          trigger: run.triggerData,
          steps: this.getStepOutputs(run),
          env: workflow.env ?? {},
        });
        console.log(`[${workflow.name}] ${interpolated}`);
        return { logged: interpolated };
      }

      case 'delay': {
        const ms = config.ms as number;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { delayed: ms };
      }

      case 'condition': {
        const expr = config.if as string;
        const result = this.evaluateCondition(expr, {
          trigger: run.triggerData,
          steps: this.getStepOutputs(run),
          env: workflow.env ?? {},
        });
        return { result };
      }

      default:
        throw new Error(`Unknown action: ${step.action}`);
    }
  }

  private getStepOutputs(run: WorkflowRun): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const [id, result] of run.steps) {
      if (result.status === 'completed') {
        outputs[id] = result.output;
      }
    }
    return outputs;
  }

  private interpolate(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, expr: string) => {
      const value = this.resolvePath(expr.trim(), context);
      return value !== undefined ? String(value) : '';
    });
  }

  private interpolateConfig(
    config: Record<string, unknown>,
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        result[key] = this.interpolate(value, context);
      } else if (Array.isArray(value)) {
        result[key] = value.map((v) =>
          typeof v === 'string' ? this.interpolate(v, context) : v
        );
      } else if (value && typeof value === 'object') {
        result[key] = this.interpolateConfig(value as Record<string, unknown>, context);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private resolvePath(path: string, obj: Record<string, unknown>): unknown {
    // Handle array indexing like "steps.fetch-stories.data[0]"
    const parts = path.split(/\.(?![^\[]*\])/);
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;

      // Check for array index notation like "data[0]"
      const arrayMatch = part.match(/^(.+?)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, key, indexStr] = arrayMatch;
        const index = parseInt(indexStr, 10);
        const arr = (current as Record<string, unknown>)[key];
        if (Array.isArray(arr)) {
          current = arr[index];
        } else {
          return undefined;
        }
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }

    return current;
  }

  private evaluateCondition(expr: string, context: Record<string, unknown>): boolean {
    // Simple expression evaluator for conditions
    const interpolated = this.interpolate(`{{ ${expr} }}`, context);
    return Boolean(interpolated && interpolated !== 'false' && interpolated !== '0');
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    attempts: number,
    delay: number
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
        }
      }
    }

    throw lastError;
  }

  getRun(id: string): WorkflowRun | undefined {
    return this.runs.get(id);
  }

  listRuns(): WorkflowRun[] {
    return Array.from(this.runs.values());
  }
}
