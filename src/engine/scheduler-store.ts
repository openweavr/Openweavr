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

export interface CompletedRun {
  id: string;
  workflowName: string;
  status: 'success' | 'failed';
  startedAt: number;
  completedAt: number;
  duration: number;
  error?: string;
  triggerType?: string;
  triggerData?: unknown;
  logs: Array<{
    timestamp: number;
    level: 'info' | 'error' | 'success';
    stepId?: string;
    message: string;
  }>;
  steps: Array<{
    stepId: string;
    status: string;
    duration?: number;
    error?: string;
    output?: unknown;
  }>;
}

export interface TokenUsageEntry {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  model?: string;
  workflowName?: string;
  runId?: string;
}

export interface RunHistoryOptions {
  page?: number;
  limit?: number;
  days?: number;
  status?: 'success' | 'failed';
  workflowName?: string;
}

export interface TokenUsageOptions {
  days?: number;
  workflowName?: string;
}

export interface TokenUsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
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

      -- Completed runs history (separate from queue)
      CREATE TABLE IF NOT EXISTS run_history (
        id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        error TEXT,
        trigger_type TEXT,
        trigger_data TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS run_history_workflow_idx ON run_history (workflow_name, started_at);
      CREATE INDEX IF NOT EXISTS run_history_date_idx ON run_history (started_at);
      CREATE INDEX IF NOT EXISTS run_history_status_idx ON run_history (status, started_at);

      -- Run logs (linked to run_history)
      CREATE TABLE IF NOT EXISTS run_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        step_id TEXT,
        message TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES run_history(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS run_logs_run_idx ON run_logs (run_id);

      -- Step results (linked to run_history)
      CREATE TABLE IF NOT EXISTS run_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL,
        duration INTEGER,
        error TEXT,
        output TEXT,
        FOREIGN KEY (run_id) REFERENCES run_history(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS run_steps_run_idx ON run_steps (run_id);

      -- Token usage tracking
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        model TEXT,
        workflow_name TEXT,
        run_id TEXT
      );

      CREATE INDEX IF NOT EXISTS token_usage_date_idx ON token_usage (timestamp);
      CREATE INDEX IF NOT EXISTS token_usage_workflow_idx ON token_usage (workflow_name, timestamp);
    `);

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
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

  // === Run History Methods ===

  saveCompletedRun(run: CompletedRun): void {
    const saveTx = this.db.transaction(() => {
      // Insert run history
      this.db
        .prepare(
          `INSERT OR REPLACE INTO run_history
            (id, workflow_name, status, started_at, completed_at, duration, error, trigger_type, trigger_data, created_at)
           VALUES
            (@id, @workflowName, @status, @startedAt, @completedAt, @duration, @error, @triggerType, @triggerData, @createdAt)`
        )
        .run({
          id: run.id,
          workflowName: run.workflowName,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          duration: run.duration,
          error: run.error ?? null,
          triggerType: run.triggerType ?? null,
          triggerData: run.triggerData ? JSON.stringify(run.triggerData) : null,
          createdAt: Date.now(),
        });

      // Insert logs
      if (run.logs.length > 0) {
        const insertLog = this.db.prepare(
          `INSERT INTO run_logs (run_id, timestamp, level, step_id, message)
           VALUES (@runId, @timestamp, @level, @stepId, @message)`
        );
        for (const log of run.logs) {
          insertLog.run({
            runId: run.id,
            timestamp: log.timestamp,
            level: log.level,
            stepId: log.stepId ?? null,
            message: log.message,
          });
        }
      }

      // Insert steps
      if (run.steps.length > 0) {
        const insertStep = this.db.prepare(
          `INSERT INTO run_steps (run_id, step_id, status, duration, error, output)
           VALUES (@runId, @stepId, @status, @duration, @error, @output)`
        );
        for (const step of run.steps) {
          insertStep.run({
            runId: run.id,
            stepId: step.stepId,
            status: step.status,
            duration: step.duration ?? null,
            error: step.error ?? null,
            output: step.output ? JSON.stringify(step.output) : null,
          });
        }
      }
    });

    saveTx();
  }

  getRunHistory(options: RunHistoryOptions = {}): { runs: CompletedRun[]; total: number; page: number; totalPages: number } {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params: Record<string, unknown> = {};

    if (options.days) {
      const cutoff = Date.now() - options.days * 24 * 60 * 60 * 1000;
      whereClause += ' AND started_at >= @cutoff';
      params.cutoff = cutoff;
    }

    if (options.status) {
      whereClause += ' AND status = @status';
      params.status = options.status;
    }

    if (options.workflowName) {
      whereClause += ' AND workflow_name = @workflowName';
      params.workflowName = options.workflowName;
    }

    // Get total count
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM run_history WHERE ${whereClause}`)
      .get(params) as { count: number };
    const total = countRow.count;
    const totalPages = Math.ceil(total / limit);

    // Get runs
    const rows = this.db
      .prepare(
        `SELECT id, workflow_name, status, started_at, completed_at, duration, error, trigger_type, trigger_data
         FROM run_history
         WHERE ${whereClause}
         ORDER BY started_at DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit, offset }) as Array<{
      id: string;
      workflow_name: string;
      status: string;
      started_at: number;
      completed_at: number;
      duration: number;
      error: string | null;
      trigger_type: string | null;
      trigger_data: string | null;
    }>;

    const runs: CompletedRun[] = rows.map((row) => ({
      id: row.id,
      workflowName: row.workflow_name,
      status: row.status as 'success' | 'failed',
      startedAt: row.started_at,
      completedAt: row.completed_at,
      duration: row.duration,
      error: row.error ?? undefined,
      triggerType: row.trigger_type ?? undefined,
      triggerData: row.trigger_data ? JSON.parse(row.trigger_data) : undefined,
      logs: [], // Not loaded in list view
      steps: [], // Not loaded in list view
    }));

    return { runs, total, page, totalPages };
  }

  getRunById(id: string): CompletedRun | null {
    const row = this.db
      .prepare(
        `SELECT id, workflow_name, status, started_at, completed_at, duration, error, trigger_type, trigger_data
         FROM run_history
         WHERE id = ?`
      )
      .get(id) as {
      id: string;
      workflow_name: string;
      status: string;
      started_at: number;
      completed_at: number;
      duration: number;
      error: string | null;
      trigger_type: string | null;
      trigger_data: string | null;
    } | undefined;

    if (!row) return null;

    // Get logs
    const logRows = this.db
      .prepare(
        `SELECT timestamp, level, step_id, message
         FROM run_logs
         WHERE run_id = ?
         ORDER BY timestamp ASC`
      )
      .all(id) as Array<{
      timestamp: number;
      level: string;
      step_id: string | null;
      message: string;
    }>;

    // Get steps
    const stepRows = this.db
      .prepare(
        `SELECT step_id, status, duration, error, output
         FROM run_steps
         WHERE run_id = ?`
      )
      .all(id) as Array<{
      step_id: string;
      status: string;
      duration: number | null;
      error: string | null;
      output: string | null;
    }>;

    return {
      id: row.id,
      workflowName: row.workflow_name,
      status: row.status as 'success' | 'failed',
      startedAt: row.started_at,
      completedAt: row.completed_at,
      duration: row.duration,
      error: row.error ?? undefined,
      triggerType: row.trigger_type ?? undefined,
      triggerData: row.trigger_data ? JSON.parse(row.trigger_data) : undefined,
      logs: logRows.map((log) => ({
        timestamp: log.timestamp,
        level: log.level as 'info' | 'error' | 'success',
        stepId: log.step_id ?? undefined,
        message: log.message,
      })),
      steps: stepRows.map((step) => ({
        stepId: step.step_id,
        status: step.status,
        duration: step.duration ?? undefined,
        error: step.error ?? undefined,
        output: step.output ? JSON.parse(step.output) : undefined,
      })),
    };
  }

  // === Token Usage Methods ===

  trackTokenUsage(entry: TokenUsageEntry): void {
    this.db
      .prepare(
        `INSERT INTO token_usage (timestamp, input_tokens, output_tokens, model, workflow_name, run_id)
         VALUES (@timestamp, @inputTokens, @outputTokens, @model, @workflowName, @runId)`
      )
      .run({
        timestamp: entry.timestamp,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        model: entry.model ?? null,
        workflowName: entry.workflowName ?? null,
        runId: entry.runId ?? null,
      });
  }

  getTokenUsage(options: TokenUsageOptions = {}): TokenUsageStats {
    let whereClause = '1=1';
    const params: Record<string, unknown> = {};

    if (options.days) {
      const cutoff = Date.now() - options.days * 24 * 60 * 60 * 1000;
      whereClause += ' AND timestamp >= @cutoff';
      params.cutoff = cutoff;
    }

    if (options.workflowName) {
      whereClause += ' AND workflow_name = @workflowName';
      params.workflowName = options.workflowName;
    }

    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(input_tokens), 0) as total_input,
           COALESCE(SUM(output_tokens), 0) as total_output,
           COUNT(*) as total_requests
         FROM token_usage
         WHERE ${whereClause}`
      )
      .get(params) as { total_input: number; total_output: number; total_requests: number };

    return {
      totalInputTokens: row.total_input,
      totalOutputTokens: row.total_output,
      totalRequests: row.total_requests,
    };
  }

  // === Cleanup Methods ===

  cleanupOldData(daysToKeep: number): { runsDeleted: number; tokenEntriesDeleted: number } {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    // Delete old runs (cascade deletes logs and steps)
    const runsResult = this.db
      .prepare('DELETE FROM run_history WHERE started_at < ?')
      .run(cutoff);

    // Delete old token usage entries
    const tokensResult = this.db
      .prepare('DELETE FROM token_usage WHERE timestamp < ?')
      .run(cutoff);

    return {
      runsDeleted: runsResult.changes,
      tokenEntriesDeleted: tokensResult.changes,
    };
  }
}
