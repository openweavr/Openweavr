import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface QueuedRun {
  id: string;
  workflowName: string;
  triggerType: string;
  triggerData: unknown;
  workflowContent: string;
  attempts: number;
  scheduledFor?: string | null;
}

interface EnqueueRunInput {
  id: string;
  workflowName: string;
  triggerType: string;
  triggerData: unknown;
  workflowContent: string;
  scheduledFor?: string | null;
}

export class SchedulerStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? join(homedir(), '.weavr', 'scheduler.db');
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_data TEXT NOT NULL,
        workflow_content TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        scheduled_for TEXT,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS runs_status_idx ON runs (status, next_attempt_at, created_at);
      CREATE INDEX IF NOT EXISTS runs_workflow_idx ON runs (workflow_name, created_at);

      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        cron_expression TEXT,
        timezone TEXT,
        last_run_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS schedules_workflow_idx ON schedules (workflow_name);
    `);
  }

  enqueueRun(input: EnqueueRunInput): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO runs
          (id, workflow_name, trigger_type, trigger_data, workflow_content, status, attempts, next_attempt_at, created_at, scheduled_for)
         VALUES
          (@id, @workflowName, @triggerType, @triggerData, @workflowContent, 'queued', 0, @nextAttemptAt, @createdAt, @scheduledFor)`
      )
      .run({
        id: input.id,
        workflowName: input.workflowName,
        triggerType: input.triggerType,
        triggerData: JSON.stringify(input.triggerData ?? {}),
        workflowContent: input.workflowContent,
        nextAttemptAt: now,
        createdAt: now,
        scheduledFor: input.scheduledFor ?? null,
      });
  }

  claimNextRuns(limit: number): QueuedRun[] {
    if (limit <= 0) return [];
    const now = Date.now();

    const selectStmt = this.db.prepare(
      `SELECT id, workflow_name, trigger_type, trigger_data, workflow_content, attempts, scheduled_for
       FROM runs
       WHERE status = 'queued' AND next_attempt_at <= ?
       ORDER BY created_at ASC
       LIMIT ?`
    );

    const updateStmt = this.db.prepare(
      `UPDATE runs
       SET status = 'running', started_at = ?, attempts = attempts + 1
       WHERE id = ? AND status = 'queued'`
    );

    const claimTx = this.db.transaction((take: number) => {
      const rows = selectStmt.all(now, take) as Array<{
        id: string;
        workflow_name: string;
        trigger_type: string;
        trigger_data: string;
        workflow_content: string;
        attempts: number;
        scheduled_for: string | null;
      }>;

      const claimed: QueuedRun[] = [];
      for (const row of rows) {
        const result = updateStmt.run(now, row.id);
        if (result.changes === 0) continue;
        claimed.push({
          id: row.id,
          workflowName: row.workflow_name,
          triggerType: row.trigger_type,
          triggerData: JSON.parse(row.trigger_data),
          workflowContent: row.workflow_content,
          attempts: row.attempts + 1,
          scheduledFor: row.scheduled_for,
        });
      }
      return claimed;
    });

    return claimTx(limit);
  }

  markRunCompleted(id: string, status: 'completed' | 'failed', error?: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE runs
         SET status = ?, completed_at = ?, error = ?
         WHERE id = ?`
      )
      .run(status, now, error ?? null, id);
  }

  rescheduleRun(id: string, nextAttemptAt: number, error?: string): void {
    this.db
      .prepare(
        `UPDATE runs
         SET status = 'queued', next_attempt_at = ?, error = ?
         WHERE id = ?`
      )
      .run(nextAttemptAt, error ?? null, id);
  }

  upsertSchedule(
    id: string,
    workflowName: string,
    triggerType: string,
    cronExpression: string | null,
    timezone: string | null
  ): void {
    this.db
      .prepare(
        `INSERT INTO schedules (id, workflow_name, trigger_type, cron_expression, timezone, last_run_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           workflow_name = excluded.workflow_name,
           trigger_type = excluded.trigger_type,
           cron_expression = excluded.cron_expression,
           timezone = excluded.timezone`
      )
      .run(id, workflowName, triggerType, cronExpression, timezone);
  }

  setScheduleLastRun(id: string, lastRunAt: number): void {
    this.db
      .prepare('UPDATE schedules SET last_run_at = ? WHERE id = ?')
      .run(lastRunAt, id);
  }

  getScheduleLastRun(id: string): number | null {
    const row = this.db
      .prepare('SELECT last_run_at FROM schedules WHERE id = ?')
      .get(id) as { last_run_at?: number | null } | undefined;
    return row?.last_run_at ?? null;
  }

  deleteSchedulesForWorkflow(workflowName: string): void {
    this.db
      .prepare('DELETE FROM schedules WHERE workflow_name = ?')
      .run(workflowName);
  }

  close(): void {
    this.db.close();
  }
}
