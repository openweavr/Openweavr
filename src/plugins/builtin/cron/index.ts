import { definePlugin, defineTrigger, defineAction } from '../../sdk/types.js';
import { Cron } from 'croner';
import { z } from 'zod';

const ScheduleConfigSchema = z.object({
  expression: z.string(),
  timezone: z.string().optional(),
});

// Store active cron jobs for cleanup
const activeJobs = new Map<string, Cron>();

export default definePlugin({
  name: 'cron',
  version: '1.0.0',
  description: 'Scheduled triggers using cron expressions',

  triggers: [
    defineTrigger({
      name: 'schedule',
      description: 'Trigger workflow on a schedule',
      schema: ScheduleConfigSchema,
      async setup(config, emit) {
        const parsed = ScheduleConfigSchema.parse(config);
        const jobId = `cron-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const job = new Cron(parsed.expression, {
          timezone: parsed.timezone,
        }, () => {
          emit({
            type: 'cron.tick',
            timestamp: new Date().toISOString(),
            expression: parsed.expression,
            jobId,
          });
        });

        activeJobs.set(jobId, job);

        const nextRun = job.nextRun();
        console.log(`[cron] Scheduled: "${parsed.expression}" (next: ${nextRun?.toISOString() ?? 'never'})`);

        return () => {
          job.stop();
          activeJobs.delete(jobId);
          console.log(`[cron] Stopped: ${jobId}`);
        };
      },
    }),
  ],

  actions: [
    defineAction({
      name: 'next',
      description: 'Get next run time for a cron expression',
      async execute(ctx) {
        const expression = ctx.config.expression as string;
        const timezone = ctx.config.timezone as string | undefined;

        const job = new Cron(expression, { timezone });
        const nextRuns: string[] = [];

        for (let i = 0; i < 5; i++) {
          const next = job.nextRun();
          if (next) {
            nextRuns.push(next.toISOString());
          }
        }

        job.stop();

        return {
          expression,
          timezone: timezone ?? 'local',
          nextRuns,
        };
      },
    }),

    defineAction({
      name: 'wait',
      description: 'Wait for a specified duration',
      async execute(ctx) {
        const ms = (ctx.config.ms as number) ?? 0;
        const seconds = (ctx.config.seconds as number) ?? 0;
        const minutes = (ctx.config.minutes as number) ?? 0;
        const hours = (ctx.config.hours as number) ?? 0;

        const totalMs = ms + (seconds + minutes * 60 + hours * 3600) * 1000;

        ctx.log(`Waiting for ${totalMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, totalMs));

        return { waited: totalMs };
      },
    }),
  ],

  hooks: {
    async onUnload() {
      // Clean up all active cron jobs
      for (const [id, job] of activeJobs) {
        job.stop();
        console.log(`[cron] Cleanup: stopped ${id}`);
      }
      activeJobs.clear();
    },
  },
});
