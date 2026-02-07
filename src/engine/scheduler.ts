import { Cron } from 'croner';
import { readdir, readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { randomUUID } from 'node:crypto';
import type { Workflow, WorkflowRun, WeavrConfig } from '../types/index.js';
import { parser } from './parser.js';

const WEBHOOK_TRIGGER_TYPES = new Set(['http.webhook', 'email.inbound']);
import { WorkflowExecutor } from './executor.js';
import type { PluginRegistry } from '../plugins/sdk/registry.js';
import { TriggerManager } from './trigger-manager.js';
import { SchedulerStore } from './scheduler-store.js';

// Get global timezone from config or system default
function getGlobalTimezone(): string {
  try {
    const configPath = join(homedir(), '.weavr', 'config.yaml');
    if (!existsSync(configPath)) {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    const content = readFileSync(configPath, 'utf-8');
    const config = parseYaml(content) as WeavrConfig;
    return config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

export interface ScheduledWorkflow {
  id: string;
  name: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  status: 'active' | 'paused';
  nextRun?: string;
  lastRun?: string;
  lastStatus?: 'success' | 'failed';
  cronJob?: Cron;
  workflowContent: string;
  sourcePath?: string;
}

export interface SchedulerEvents {
  onWorkflowTriggered?: (workflowName: string, runId: string) => void;
  onWorkflowCompleted?: (workflowName: string, runId: string, status: 'success' | 'failed') => void;
  onExecuteWorkflow?: (
    workflow: Workflow,
    triggerData: unknown,
    runId: string,
    workflowContent?: string
  ) => Promise<WorkflowRun | void>;
}

export interface SchedulerOptions {
  storePath?: string;
  maxConcurrency?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  pollIntervalMs?: number;
  maxCatchUpRuns?: number;
  catchUpWindowMs?: number;
}

export class TriggerScheduler {
  private scheduledWorkflows = new Map<string, ScheduledWorkflow>();
  private workflowsDir: string;
  private executor: WorkflowExecutor;
  private events: SchedulerEvents;
  private triggerManager: TriggerManager;
  public readonly store: SchedulerStore;
  private activeRuns = new Set<string>();
  private pollIntervalId?: NodeJS.Timeout;
  private maxConcurrency: number;
  private maxAttempts: number;
  private retryDelayMs: number;
  private pollIntervalMs: number;
  private maxCatchUpRuns: number;
  private catchUpWindowMs: number;

  constructor(
    workflowsDir: string,
    registry: PluginRegistry,
    events: SchedulerEvents = {},
    options: SchedulerOptions = {}
  ) {
    this.workflowsDir = workflowsDir;
    this.events = events;
    this.executor = new WorkflowExecutor({ registry });
    this.store = new SchedulerStore(options.storePath);
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 5000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.maxCatchUpRuns = options.maxCatchUpRuns ?? 10;
    this.catchUpWindowMs = options.catchUpWindowMs ?? 24 * 60 * 60 * 1000;

    // Create TriggerManager for custom triggers (messaging, etc.)
    this.triggerManager = new TriggerManager(registry, workflowsDir, {
      onWorkflowTriggered: events.onWorkflowTriggered,
      onWorkflowCompleted: events.onWorkflowCompleted,
      onExecuteWorkflow: events.onExecuteWorkflow,
      onEnqueueWorkflow: async (workflowName, workflowContent, triggerData, runId) => {
        const triggerType =
          typeof (triggerData as { type?: unknown })?.type === 'string'
            ? ((triggerData as { type?: string }).type as string)
            : 'custom';
        this.enqueueRun(workflowName, triggerType, triggerData, workflowContent, runId);
      },
    });

    this.startQueue();
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

          const triggers = this.extractTriggers(raw);
          if (triggers.length === 0) continue;

          const workflowName = (raw.name as string) ?? file.replace(/\.ya?ml$/, '');
          await this.scheduleWorkflow(workflowName, content, join(this.workflowsDir, file));
        } catch (err) {
          console.error(`[scheduler] Failed to load ${file}:`, err);
        }
      }

      console.log(`[scheduler] Loaded ${this.scheduledWorkflows.size} scheduled workflow(s)`);
    } catch (err) {
      console.error('[scheduler] Failed to scan workflows:', err);
    }
  }

  async scheduleWorkflow(name: string, yamlContent: string, sourcePath?: string): Promise<ScheduledWorkflow | null> {
    // Stop existing schedule if any
    this.unscheduleWorkflow(name);

    try {
      const raw = parseYaml(yamlContent) as Record<string, unknown>;
      const triggers = this.extractTriggers(raw);
      if (triggers.length === 0) {
        return null;
      }

      let firstScheduled: ScheduledWorkflow | null = null;
      for (let index = 0; index < triggers.length; index += 1) {
        const { type: triggerType, config: triggerConfig } = triggers[index];
        const scheduled = await this.scheduleTrigger(
          name,
          triggerType,
          triggerConfig,
          yamlContent,
          sourcePath,
          index
        );
        if (!firstScheduled) {
          firstScheduled = scheduled;
        }
      }

      return firstScheduled;
    } catch (err) {
      console.error(`[scheduler] Failed to schedule ${name}:`, err);
      return null;
    }
  }

  unscheduleWorkflow(name: string): boolean {
    let removed = false;
    for (const [id, scheduled] of this.scheduledWorkflows) {
      if (scheduled.name !== name) continue;
      if (scheduled.cronJob) {
        scheduled.cronJob.stop();
      }
      if (scheduled.triggerType !== 'cron.schedule' && scheduled.triggerType !== 'http.webhook') {
        this.triggerManager.stopTrigger(id);
      }
      this.scheduledWorkflows.delete(id);
      removed = true;
    }

    if (removed) {
      this.store.deleteSchedulesForWorkflow(name);
      console.log(`[scheduler] Unscheduled: ${name}`);
    }
    return removed;
  }

  pauseWorkflow(name: string): boolean {
    let updated = false;
    for (const scheduled of this.scheduledWorkflows.values()) {
      if (scheduled.name !== name) continue;
      scheduled.status = 'paused';
      if (scheduled.cronJob) {
        scheduled.cronJob.pause();
      } else if (scheduled.triggerType !== 'http.webhook') {
        this.triggerManager.stopTrigger(scheduled.id);
      }
      updated = true;
    }
    return updated;
  }

  resumeWorkflow(name: string): boolean {
    let updated = false;
    for (const scheduled of this.scheduledWorkflows.values()) {
      if (scheduled.name !== name) continue;
      scheduled.status = 'active';
      if (scheduled.cronJob) {
        scheduled.cronJob.resume();
        scheduled.nextRun = scheduled.cronJob.nextRun()?.toISOString();
      } else if (scheduled.triggerType !== 'http.webhook') {
        void this.triggerManager.setupTrigger(
          name,
          scheduled.triggerType,
          scheduled.triggerConfig,
          scheduled.workflowContent,
          scheduled.id
        );
      }
      updated = true;
    }
    return updated;
  }

  private enqueueRun(
    name: string,
    triggerType: string,
    triggerData: unknown,
    yamlContent: string,
    runId: string,
    scheduledFor?: string | null
  ): void {
    this.store.enqueueRun({
      id: runId,
      workflowName: name,
      triggerType,
      triggerData,
      workflowContent: yamlContent,
      scheduledFor: scheduledFor ?? null,
    });
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
    const scheduled = Array.from(this.scheduledWorkflows.values()).find((entry) => entry.name === name);
    if (scheduled?.cronJob && scheduled.status === 'active') {
      scheduled.nextRun = scheduled.cronJob.nextRun()?.toISOString();
    }
    return scheduled;
  }

  // For webhook triggers - called externally
  async triggerWebhook(path: string, data: unknown): Promise<{ triggered: string[]; runIds: string[] }> {
    const triggered: string[] = [];
    const runIds: string[] = [];

    for (const scheduled of this.scheduledWorkflows.values()) {
      if (scheduled.status !== 'active') continue;
      if (!WEBHOOK_TRIGGER_TYPES.has(scheduled.triggerType)) continue;

      const defaultPath = scheduled.triggerType === 'email.inbound' ? 'email' : undefined;
      const webhookPath = (scheduled.triggerConfig.path as string | undefined) ?? defaultPath;
      if (!webhookPath) continue;
      if (webhookPath === path || webhookPath === `/${path}` || `/${webhookPath}` === path) {
        try {
          const runId = randomUUID();
          triggered.push(scheduled.name);
          runIds.push(runId);

          this.events.onWorkflowTriggered?.(scheduled.name, runId);
          const triggerPayload = scheduled.triggerType === 'email.inbound'
            ? {
              type: 'email',
              path,
              provider: scheduled.triggerConfig.provider as string | undefined,
              data,
            }
            : { type: 'webhook', path, data };
          this.enqueueRun(
            scheduled.name,
            scheduled.triggerType,
            triggerPayload,
            scheduled.workflowContent,
            runId
          );
        } catch (err) {
          console.error(`[scheduler] Failed to trigger webhook for ${scheduled.name}:`, err);
        }
      }
    }

    return { triggered, runIds };
  }

  // For GitHub webhook events - called from the GitHub webhook handler
  async triggerGitHubEvent(triggerType: string, data: Record<string, unknown>): Promise<{ triggered: string[]; runIds: string[] }> {
    const triggered: string[] = [];
    const runIds: string[] = [];

    for (const scheduled of this.scheduledWorkflows.values()) {
      if (scheduled.status !== 'active') continue;
      if (scheduled.triggerType !== triggerType) continue;

      // Check if the repo matches (if configured in trigger config)
      const configRepo = scheduled.triggerConfig.repo as string | undefined;
      const eventRepo = data.repository as string;
      if (configRepo && eventRepo && configRepo !== eventRepo) {
        continue;
      }

      // Check branch filter for push events
      if (triggerType === 'github.push') {
        const configBranch = scheduled.triggerConfig.branch as string | undefined;
        const eventBranch = data.branch as string;
        if (configBranch && eventBranch && configBranch !== eventBranch) {
          continue;
        }
      }

      // Check action filter for pull_request events
      if (triggerType === 'github.pull_request') {
        const configEvents = scheduled.triggerConfig.events as string[] | undefined;
        const eventAction = data.action as string;
        if (configEvents && configEvents.length > 0 && !configEvents.includes(eventAction)) {
          continue;
        }
      }

      const runId = randomUUID();
      triggered.push(scheduled.name);
      runIds.push(runId);

      this.events.onWorkflowTriggered?.(scheduled.name, runId);
      console.log(`[scheduler] GitHub event triggered workflow: ${scheduled.name} (run: ${runId})`);

      this.enqueueRun(
        scheduled.name,
        triggerType,
        { type: 'github', triggerType, ...data },
        scheduled.workflowContent,
        runId
      );
    }

    return { triggered, runIds };
  }

  stopAll(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = undefined;
    }
    for (const scheduled of this.scheduledWorkflows.values()) {
      if (scheduled.cronJob) {
        scheduled.cronJob.stop();
      }
    }
    // Stop all custom triggers
    this.triggerManager.stopAll();
    this.scheduledWorkflows.clear();
    this.store.close();
    console.log('[scheduler] All workflows stopped');
  }

  private extractTriggers(raw: Record<string, unknown>): Array<{ type: string; config: Record<string, unknown> }> {
    const triggers: Array<{ type: string; config: Record<string, unknown> }> = [];
    const single = raw.trigger as Record<string, unknown> | undefined;
    if (single?.type) {
      triggers.push({
        type: single.type as string,
        config: (single.with as Record<string, unknown>) ?? (single.config as Record<string, unknown>) ?? {},
      });
    }

    const list = raw.triggers as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (!entry?.type) continue;
        triggers.push({
          type: entry.type as string,
          config: (entry.with as Record<string, unknown>) ?? (entry.config as Record<string, unknown>) ?? {},
        });
      }
    }

    return triggers;
  }

  private scheduleKey(name: string, triggerType: string, index: number): string {
    return `${name}::${triggerType}::${index}`;
  }

  private async scheduleTrigger(
    name: string,
    triggerType: string,
    triggerConfig: Record<string, unknown>,
    yamlContent: string,
    sourcePath: string | undefined,
    index: number
  ): Promise<ScheduledWorkflow> {
    const id = this.scheduleKey(name, triggerType, index);
    const scheduled: ScheduledWorkflow = {
      id,
      name,
      triggerType,
      triggerConfig,
      status: 'active',
      workflowContent: yamlContent,
      sourcePath,
    };

    if (triggerType === 'cron.schedule') {
      const expression = (triggerConfig.expression ?? triggerConfig.cron) as string;
      const timezone = (triggerConfig.timezone as string) ?? getGlobalTimezone();

      if (!expression) {
        console.error(`[scheduler] Missing cron expression for ${name}`);
        scheduled.status = 'paused';
      } else {
        try {
          const cronJob = new Cron(expression, { timezone }, async () => {
            const runId = randomUUID();
            this.events.onWorkflowTriggered?.(name, runId);
            const scheduledFor = new Date().toISOString();
            this.enqueueRun(
              name,
              triggerType,
              { type: 'cron', expression, scheduledFor },
              yamlContent,
              runId,
              scheduledFor
            );
            this.store.setScheduleLastRun(id, Date.now());
          });

          scheduled.cronJob = cronJob;
          scheduled.nextRun = cronJob.nextRun()?.toISOString();

          this.store.upsertSchedule(id, name, triggerType, expression, timezone);
          this.catchUpCronRuns(id, cronJob, name, expression, yamlContent);

          console.log(`[scheduler] Cron scheduled: ${name} (${expression}) timezone: ${timezone} - next: ${scheduled.nextRun}`);
        } catch (err) {
          scheduled.status = 'paused';
          console.error(`[scheduler] Invalid cron schedule for ${name}:`, err);
        }
      }
    } else if (!WEBHOOK_TRIGGER_TYPES.has(triggerType)) {
      const success = await this.triggerManager.setupTrigger(name, triggerType, triggerConfig, yamlContent, id);
      if (success) {
        console.log(`[scheduler] Custom trigger set up: ${name} (${triggerType})`);
      } else {
        console.log(`[scheduler] Custom trigger registered (stub): ${name} (${triggerType})`);
      }
    }

    this.scheduledWorkflows.set(id, scheduled);
    return scheduled;
  }

  private catchUpCronRuns(
    scheduleId: string,
    cronJob: Cron,
    workflowName: string,
    expression: string,
    yamlContent: string
  ): void {
    const lastRunAt = this.store.getScheduleLastRun(scheduleId);
    if (lastRunAt === null) return;

    const now = Date.now();
    const windowStart = now - this.catchUpWindowMs;
    const startFrom = new Date(Math.max(lastRunAt, windowStart));
    const dueRuns = cronJob
      .nextRuns(this.maxCatchUpRuns, startFrom)
      .filter((runDate) => runDate.getTime() <= now && runDate.getTime() > lastRunAt);

    if (dueRuns.length === 0) return;

    for (const runDate of dueRuns) {
      const runId = randomUUID();
      const scheduledFor = runDate.toISOString();
      this.events.onWorkflowTriggered?.(workflowName, runId);
      this.enqueueRun(
        workflowName,
        'cron.schedule',
        { type: 'cron', expression, scheduledFor },
        yamlContent,
        runId,
        scheduledFor
      );
    }

    const last = dueRuns[dueRuns.length - 1];
    this.store.setScheduleLastRun(scheduleId, last.getTime());
  }

  private startQueue(): void {
    if (this.pollIntervalId) return;
    this.pollIntervalId = setInterval(() => {
      void this.drainQueue();
    }, this.pollIntervalMs);
    void this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    const available = this.maxConcurrency - this.activeRuns.size;
    if (available <= 0) return;

    const runs = this.store.claimNextRuns(available);
    for (const run of runs) {
      this.activeRuns.add(run.id);
      void this.executeRun(run).finally(() => {
        this.activeRuns.delete(run.id);
      });
    }
  }

  private async executeRun(run: {
    id: string;
    workflowName: string;
    triggerType: string;
    triggerData: unknown;
    workflowContent: string;
    attempts: number;
  }): Promise<void> {
    try {
      const workflow = parser.parse(run.workflowContent);
      const result = this.events.onExecuteWorkflow
        ? await this.events.onExecuteWorkflow(workflow, run.triggerData, run.id, run.workflowContent)
        : await this.executor.execute(workflow, run.triggerData, run.id);

      const status = result?.status ?? 'completed';
      if (status === 'failed') {
        throw new Error(result?.error ?? 'Workflow failed');
      }

      this.store.markRunCompleted(run.id, 'completed');
      this.markWorkflowCompletion(run.workflowName, run.id, 'success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (run.attempts < this.maxAttempts) {
        const delay = this.retryDelayMs * Math.pow(2, run.attempts - 1);
        this.store.rescheduleRun(run.id, Date.now() + delay, errorMessage);
      } else {
        this.store.markRunCompleted(run.id, 'failed', errorMessage);
        this.markWorkflowCompletion(run.workflowName, run.id, 'failed', errorMessage);
      }
    }
  }

  private markWorkflowCompletion(
    name: string,
    runId: string,
    status: 'success' | 'failed',
    error?: string
  ): void {
    const now = new Date().toISOString();
    for (const scheduled of this.scheduledWorkflows.values()) {
      if (scheduled.name !== name) continue;
      scheduled.lastRun = now;
      scheduled.lastStatus = status;
    }
    if (!this.events.onExecuteWorkflow) {
      this.events.onWorkflowCompleted?.(name, runId, status);
    }
    if (status === 'failed' && error) {
      console.error(`[scheduler] Workflow ${name} failed: ${error}`);
    }
  }
}
