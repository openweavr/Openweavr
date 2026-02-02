import { Cron } from 'croner';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { randomUUID } from 'node:crypto';
import type { Workflow } from '../types/index.js';
import { parser } from './parser.js';
import { WorkflowExecutor } from './executor.js';
import type { PluginRegistry } from '../plugins/sdk/registry.js';
import { TriggerManager } from './trigger-manager.js';

export interface ScheduledWorkflow {
  name: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  status: 'active' | 'paused';
  nextRun?: string;
  lastRun?: string;
  lastStatus?: 'success' | 'failed';
  cronJob?: Cron;
}

export interface SchedulerEvents {
  onWorkflowTriggered?: (workflowName: string, runId: string) => void;
  onWorkflowCompleted?: (workflowName: string, runId: string, status: 'success' | 'failed') => void;
  onExecuteWorkflow?: (workflow: Workflow, triggerData: unknown, runId: string) => Promise<void>;
}

export class TriggerScheduler {
  private scheduledWorkflows = new Map<string, ScheduledWorkflow>();
  private workflowsDir: string;
  private executor: WorkflowExecutor;
  private events: SchedulerEvents;
  private triggerManager: TriggerManager;

  constructor(workflowsDir: string, registry: PluginRegistry, events: SchedulerEvents = {}) {
    this.workflowsDir = workflowsDir;
    this.events = events;
    this.executor = new WorkflowExecutor({
      registry,
      onRunComplete: (run) => {
        const scheduled = this.scheduledWorkflows.get(run.workflowName);
        if (scheduled) {
          scheduled.lastRun = new Date().toISOString();
          scheduled.lastStatus = run.status === 'completed' ? 'success' : 'failed';
        }
        this.events.onWorkflowCompleted?.(run.workflowName, run.id, run.status === 'completed' ? 'success' : 'failed');
      },
    });

    // Create TriggerManager for custom triggers (messaging, etc.)
    this.triggerManager = new TriggerManager(registry, workflowsDir, {
      onWorkflowTriggered: events.onWorkflowTriggered,
      onWorkflowCompleted: events.onWorkflowCompleted,
      onExecuteWorkflow: events.onExecuteWorkflow,
    });
  }

  /**
   * Get the trigger manager instance for status queries
   */
  getTriggerManager(): TriggerManager {
    return this.triggerManager;
  }

  async loadAndScheduleAll(): Promise<void> {
    try {
      const files = await readdir(this.workflowsDir);
      const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

      for (const file of yamlFiles) {
        try {
          const content = await readFile(join(this.workflowsDir, file), 'utf-8');
          const raw = parseYaml(content) as Record<string, unknown>;

          // Check if workflow has a trigger
          const trigger = raw.trigger as Record<string, unknown> | undefined;
          if (!trigger?.type) continue;

          const workflowName = (raw.name as string) ?? file.replace(/\.ya?ml$/, '');
          await this.scheduleWorkflow(workflowName, content);
        } catch (err) {
          console.error(`[scheduler] Failed to load ${file}:`, err);
        }
      }

      console.log(`[scheduler] Loaded ${this.scheduledWorkflows.size} scheduled workflow(s)`);
    } catch (err) {
      console.error('[scheduler] Failed to scan workflows:', err);
    }
  }

  async scheduleWorkflow(name: string, yamlContent: string): Promise<ScheduledWorkflow | null> {
    // Stop existing schedule if any
    this.unscheduleWorkflow(name);

    try {
      const raw = parseYaml(yamlContent) as Record<string, unknown>;
      const trigger = raw.trigger as Record<string, unknown> | undefined;

      if (!trigger?.type) {
        return null;
      }

      const triggerType = trigger.type as string;
      const triggerConfig = (trigger.with as Record<string, unknown>) ?? {};

      const scheduled: ScheduledWorkflow = {
        name,
        triggerType,
        triggerConfig,
        status: 'active',
      };

      // Set up cron triggers
      if (triggerType === 'cron.schedule') {
        // Accept both 'expression' and 'cron' as the cron expression field
        const expression = (triggerConfig.expression ?? triggerConfig.cron) as string;
        const timezone = triggerConfig.timezone as string | undefined;

        if (expression) {
          const cronJob = new Cron(expression, { timezone }, async () => {
            await this.executeWorkflow(name, yamlContent, { type: 'cron', expression });
          });

          scheduled.cronJob = cronJob;
          scheduled.nextRun = cronJob.nextRun()?.toISOString();

          console.log(`[scheduler] Cron scheduled: ${name} (${expression}) - next: ${scheduled.nextRun}`);
        }
      }
      // Set up custom triggers via TriggerManager (messaging, etc.)
      else if (triggerType !== 'http.webhook') {
        // Use TriggerManager for all non-cron, non-webhook triggers
        const success = await this.triggerManager.setupTrigger(name, triggerType, triggerConfig, yamlContent);
        if (success) {
          console.log(`[scheduler] Custom trigger set up: ${name} (${triggerType})`);
        } else {
          console.log(`[scheduler] Custom trigger registered (stub): ${name} (${triggerType})`);
        }
      }

      this.scheduledWorkflows.set(name, scheduled);
      return scheduled;
    } catch (err) {
      console.error(`[scheduler] Failed to schedule ${name}:`, err);
      return null;
    }
  }

  unscheduleWorkflow(name: string): boolean {
    const scheduled = this.scheduledWorkflows.get(name);
    if (scheduled) {
      if (scheduled.cronJob) {
        scheduled.cronJob.stop();
      }
      // Stop custom triggers via TriggerManager
      this.triggerManager.stopTrigger(name);
      this.scheduledWorkflows.delete(name);
      console.log(`[scheduler] Unscheduled: ${name}`);
      return true;
    }
    return false;
  }

  pauseWorkflow(name: string): boolean {
    const scheduled = this.scheduledWorkflows.get(name);
    if (scheduled) {
      scheduled.status = 'paused';
      if (scheduled.cronJob) {
        scheduled.cronJob.pause();
      }
      return true;
    }
    return false;
  }

  resumeWorkflow(name: string): boolean {
    const scheduled = this.scheduledWorkflows.get(name);
    if (scheduled) {
      scheduled.status = 'active';
      if (scheduled.cronJob) {
        scheduled.cronJob.resume();
        scheduled.nextRun = scheduled.cronJob.nextRun()?.toISOString();
      }
      return true;
    }
    return false;
  }

  private async executeWorkflow(name: string, yamlContent: string, triggerData: unknown): Promise<void> {
    const runId = randomUUID();
    console.log(`[scheduler] Triggering workflow: ${name} (run: ${runId})`);

    this.events.onWorkflowTriggered?.(name, runId);

    try {
      const workflow = parser.parse(yamlContent);
      // Use external executor if provided, otherwise use internal one
      if (this.events.onExecuteWorkflow) {
        await this.events.onExecuteWorkflow(workflow, triggerData, runId);
      } else {
        await this.executor.execute(workflow, triggerData, runId);
      }
    } catch (err) {
      console.error(`[scheduler] Execution failed for ${name}:`, err);
    }
  }

  getScheduledWorkflows(): ScheduledWorkflow[] {
    // Update next run times before returning
    for (const scheduled of this.scheduledWorkflows.values()) {
      if (scheduled.cronJob && scheduled.status === 'active') {
        scheduled.nextRun = scheduled.cronJob.nextRun()?.toISOString();
      }
    }
    return Array.from(this.scheduledWorkflows.values());
  }

  getWorkflowSchedule(name: string): ScheduledWorkflow | undefined {
    const scheduled = this.scheduledWorkflows.get(name);
    if (scheduled?.cronJob && scheduled.status === 'active') {
      scheduled.nextRun = scheduled.cronJob.nextRun()?.toISOString();
    }
    return scheduled;
  }

  // For webhook triggers - called externally
  async triggerWebhook(path: string, data: unknown): Promise<{ triggered: string[]; runIds: string[] }> {
    const triggered: string[] = [];
    const runIds: string[] = [];

    for (const [name, scheduled] of this.scheduledWorkflows) {
      if (scheduled.status !== 'active') continue;
      if (scheduled.triggerType !== 'http.webhook') continue;

      const webhookPath = scheduled.triggerConfig.path as string;
      if (webhookPath === path || webhookPath === `/${path}` || `/${webhookPath}` === path) {
        try {
          const content = await readFile(join(this.workflowsDir, `${name}.yaml`), 'utf-8');
          const runId = randomUUID();
          triggered.push(name);
          runIds.push(runId);

          this.events.onWorkflowTriggered?.(name, runId);

          const workflow = parser.parse(content);
          // Execute async - don't wait
          const executePromise = this.events.onExecuteWorkflow
            ? this.events.onExecuteWorkflow(workflow, { type: 'webhook', path, data }, runId)
            : this.executor.execute(workflow, { type: 'webhook', path, data }, runId);
          executePromise.catch(err => {
            console.error(`[scheduler] Webhook execution failed for ${name}:`, err);
          });
        } catch (err) {
          console.error(`[scheduler] Failed to trigger webhook for ${name}:`, err);
        }
      }
    }

    return { triggered, runIds };
  }

  stopAll(): void {
    for (const [_name, scheduled] of this.scheduledWorkflows) {
      if (scheduled.cronJob) {
        scheduled.cronJob.stop();
      }
    }
    // Stop all custom triggers
    this.triggerManager.stopAll();
    this.scheduledWorkflows.clear();
    console.log('[scheduler] All workflows stopped');
  }
}
