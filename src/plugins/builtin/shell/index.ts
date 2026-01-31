import { definePlugin, defineAction } from '../../sdk/types.js';
import { z } from 'zod';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const ExecSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().default(30000),
  shell: z.string().optional(),
});

const ScriptSchema = z.object({
  script: z.string(),
  interpreter: z.enum(['bash', 'sh', 'zsh', 'python', 'python3', 'node']).default('bash'),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().default(60000),
});

export default definePlugin({
  name: 'shell',
  version: '1.0.0',
  description: 'Execute shell commands and scripts',

  actions: [
    defineAction({
      name: 'exec',
      description: 'Execute a shell command',
      schema: ExecSchema,
      async execute(ctx) {
        const config = ExecSchema.parse(ctx.config);
        ctx.log(`Executing: ${config.command}`);

        const startTime = Date.now();

        try {
          const { stdout, stderr } = await execAsync(config.command, {
            cwd: config.cwd,
            env: { ...process.env, ...config.env },
            timeout: config.timeout,
            shell: config.shell ?? '/bin/bash',
            maxBuffer: 10 * 1024 * 1024, // 10MB
          });

          const duration = Date.now() - startTime;

          return {
            success: true,
            exitCode: 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            command: config.command,
            duration,
          };
        } catch (err) {
          const error = err as { code?: number; stdout?: string; stderr?: string; killed?: boolean; signal?: string };
          const duration = Date.now() - startTime;

          // Check if it was a timeout
          if (error.killed && error.signal === 'SIGTERM') {
            return {
              success: false,
              exitCode: -1,
              stdout: error.stdout?.trim() ?? '',
              stderr: error.stderr?.trim() ?? '',
              error: `Command timed out after ${config.timeout}ms`,
              command: config.command,
              duration,
              timedOut: true,
            };
          }

          return {
            success: false,
            exitCode: error.code ?? -1,
            stdout: error.stdout?.trim() ?? '',
            stderr: error.stderr?.trim() ?? '',
            error: error.stderr?.trim() || String(err),
            command: config.command,
            duration,
          };
        }
      },
    }),

    defineAction({
      name: 'script',
      description: 'Run a multi-line script with an interpreter',
      schema: ScriptSchema,
      async execute(ctx) {
        const config = ScriptSchema.parse(ctx.config);
        ctx.log(`Running ${config.interpreter} script`);

        const interpreterPaths: Record<string, string> = {
          bash: '/bin/bash',
          sh: '/bin/sh',
          zsh: '/bin/zsh',
          python: 'python',
          python3: 'python3',
          node: 'node',
        };

        const interpreterPath = interpreterPaths[config.interpreter];
        const startTime = Date.now();

        return new Promise((resolve) => {
          const child = spawn(interpreterPath, ['-c', config.script], {
            cwd: config.cwd,
            env: { ...process.env, ...config.env },
            shell: false,
          });

          let stdout = '';
          let stderr = '';
          let timedOut = false;

          const timeout = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, config.timeout);

          child.stdout.on('data', (data) => {
            stdout += data.toString();
          });

          child.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          child.on('close', (code) => {
            clearTimeout(timeout);
            const duration = Date.now() - startTime;

            if (timedOut) {
              resolve({
                success: false,
                exitCode: -1,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                error: `Script timed out after ${config.timeout}ms`,
                interpreter: config.interpreter,
                duration,
                timedOut: true,
              });
            } else {
              resolve({
                success: code === 0,
                exitCode: code ?? -1,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                interpreter: config.interpreter,
                duration,
              });
            }
          });

          child.on('error', (err) => {
            clearTimeout(timeout);
            const duration = Date.now() - startTime;
            resolve({
              success: false,
              exitCode: -1,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              error: String(err),
              interpreter: config.interpreter,
              duration,
            });
          });
        });
      },
    }),
  ],
});
