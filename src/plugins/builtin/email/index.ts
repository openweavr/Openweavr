import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { randomUUID } from 'node:crypto';

const SendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string(),
  text: z.string().optional(),
  html: z.string().optional(),
  from: z.string().optional(),
  replyTo: z.string().email().optional(),
  cc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  bcc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  provider: z.enum(['auto', 'api', 'smtp']).optional(),
  smtp: z.object({
    host: z.string(),
    port: z.number().optional(),
    secure: z.boolean().optional(),
    user: z.string().optional(),
    pass: z.string().optional(),
    authMethod: z.enum(['login', 'plain']).optional(),
  }).optional(),
});

const InboundConfigSchema = z.object({
  path: z.string().default('email'),
  provider: z.string().optional(),
});

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  authMethod: 'login' | 'plain';
}

// Simple email sending using fetch to an email API service
// For production, you'd want to use a provider SDK or a robust SMTP client
async function sendViaAPI(config: {
  apiKey: string;
  to: string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
}): Promise<{ success: boolean; messageId?: string; provider: string }> {
  // This uses a generic email API pattern - you can swap for Resend, SendGrid, etc.
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.from,
      to: config.to,
      cc: config.cc,
      bcc: config.bcc,
      reply_to: config.replyTo,
      subject: config.subject,
      text: config.text,
      html: config.html,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Email API error: ${response.status} ${error}`);
  }

  const data = await response.json() as { id?: string };
  return { success: true, messageId: data.id, provider: 'api' };
}

function getGlobalSmtpConfig(): SmtpConfig | undefined {
  try {
    const configPath = join(homedir(), '.weavr', 'config.yaml');
    if (!existsSync(configPath)) return undefined;
    const content = readFileSync(configPath, 'utf-8');
    const config = parseYaml(content) as { email?: { smtp?: Record<string, unknown> } };
    const smtp = config?.email?.smtp;
    if (!smtp || typeof smtp !== 'object') return undefined;

    const host = smtp.host as string | undefined;
    if (!host) return undefined;

    return {
      host,
      port: (smtp.port as number) ?? 587,
      secure: (smtp.secure as boolean) ?? false,
      user: smtp.user as string | undefined,
      pass: smtp.pass as string | undefined,
      authMethod: (smtp.authMethod as 'login' | 'plain') ?? 'login',
    };
  } catch {
    return undefined;
  }
}

function getEnvSmtpConfig(env: Record<string, string>): SmtpConfig | undefined {
  const host = env.SMTP_HOST ?? process.env.SMTP_HOST;
  if (!host) return undefined;
  const portValue = env.SMTP_PORT ?? process.env.SMTP_PORT;
  const secureValue = env.SMTP_SECURE ?? process.env.SMTP_SECURE;
  const parsedPort = portValue ? Number(portValue) : 587;
  const port = Number.isNaN(parsedPort) ? 587 : parsedPort;

  return {
    host,
    port,
    secure: secureValue === 'true' || secureValue === '1',
    user: env.SMTP_USER ?? process.env.SMTP_USER,
    pass: env.SMTP_PASS ?? process.env.SMTP_PASS,
    authMethod: ((env.SMTP_AUTH_METHOD ?? process.env.SMTP_AUTH_METHOD) as 'login' | 'plain') ?? 'login',
  };
}

function resolveSmtpConfig(ctx: { config: Record<string, unknown>; env: Record<string, string> }): SmtpConfig | undefined {
  const inline = ctx.config.smtp as Record<string, unknown> | undefined;
  if (inline?.host) {
    const inlinePort = inline.port ? Number(inline.port) : 587;
    return {
      host: String(inline.host),
      port: Number.isNaN(inlinePort) ? 587 : inlinePort,
      secure: inline.secure === true,
      user: inline.user ? String(inline.user) : undefined,
      pass: inline.pass ? String(inline.pass) : undefined,
      authMethod: (inline.authMethod as 'login' | 'plain') ?? 'login',
    };
  }

  return getEnvSmtpConfig(ctx.env) ?? getGlobalSmtpConfig();
}

function buildMimeMessage(config: {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}): { message: string; messageId: string } {
  const messageId = `${randomUUID()}@weavr.local`;
  const headers: string[] = [
    `From: ${config.from}`,
    `To: ${config.to.join(', ')}`,
    config.cc.length > 0 ? `Cc: ${config.cc.join(', ')}` : '',
    `Subject: ${config.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    config.replyTo ? `Reply-To: ${config.replyTo}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean);

  const text = config.text ?? '';
  const html = config.html;

  if (html && text) {
    const boundary = `weavr_${randomUUID()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      '',
      text,
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      '',
      html,
      `--${boundary}--`,
    ].join('\r\n');

    return { message: headers.join('\r\n') + '\r\n\r\n' + body, messageId };
  }

  const contentType = html ? 'text/html' : 'text/plain';
  headers.push(`Content-Type: ${contentType}; charset="utf-8"`);

  return {
    message: headers.join('\r\n') + '\r\n\r\n' + (html ?? text),
    messageId,
  };
}

async function readSmtpResponse(socket: ReturnType<typeof netConnect>, timeoutMs = 30000): Promise<{ code: number; message: string }> {
  return await new Promise((resolve, reject) => {
    let buffer = '';
    const lines: string[] = [];
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      cleanup();
      reject(new Error('SMTP timeout waiting for response'));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
    }

    function onError(err: Error): void {
      if (resolved) return;
      cleanup();
      reject(err);
    }

    function onData(chunk: Buffer): void {
      buffer += chunk.toString('utf-8');
      while (buffer.includes('\n')) {
        const idx = buffer.indexOf('\n');
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        lines.push(line);

        const match = line.match(/^(\d{3})([ -])/);
        if (match) {
          const code = Number(match[1]);
          const hasMore = match[2] === '-';
          if (!hasMore) {
            resolved = true;
            cleanup();
            resolve({ code, message: lines.join('\n') });
            return;
          }
        }
      }
    }

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function sendSmtpCommand(socket: ReturnType<typeof netConnect>, command: string): Promise<{ code: number; message: string }> {
  socket.write(`${command}\r\n`);
  return await readSmtpResponse(socket);
}

async function sendViaSMTP(config: {
  smtp: SmtpConfig;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}): Promise<{ success: boolean; messageId: string; provider: string }> {
  const { smtp } = config;
  const socket = smtp.secure
    ? tlsConnect({ host: smtp.host, port: smtp.port })
    : netConnect({ host: smtp.host, port: smtp.port });

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', (err) => reject(err));
  });

  const greeting = await readSmtpResponse(socket);
  if (greeting.code >= 400) {
    socket.end();
    throw new Error(`SMTP error: ${greeting.message}`);
  }

  let response = await sendSmtpCommand(socket, `EHLO weavr.local`);
  if (response.code >= 400) {
    response = await sendSmtpCommand(socket, `HELO weavr.local`);
  }

  if (smtp.user && smtp.pass) {
    if (smtp.authMethod === 'plain') {
      const authString = Buffer.from(`\u0000${smtp.user}\u0000${smtp.pass}`, 'utf-8').toString('base64');
      response = await sendSmtpCommand(socket, `AUTH PLAIN ${authString}`);
    } else {
      response = await sendSmtpCommand(socket, 'AUTH LOGIN');
      if (response.code === 334) {
        response = await sendSmtpCommand(socket, Buffer.from(smtp.user, 'utf-8').toString('base64'));
      }
      if (response.code === 334) {
        response = await sendSmtpCommand(socket, Buffer.from(smtp.pass, 'utf-8').toString('base64'));
      }
    }

    if (response.code >= 400) {
      socket.end();
      throw new Error(`SMTP authentication failed: ${response.message}`);
    }
  }

  response = await sendSmtpCommand(socket, `MAIL FROM:<${config.from}>`);
  if (response.code >= 400) {
    socket.end();
    throw new Error(`SMTP MAIL FROM failed: ${response.message}`);
  }

  const recipients = [...config.to, ...config.cc, ...config.bcc];
  for (const recipient of recipients) {
    response = await sendSmtpCommand(socket, `RCPT TO:<${recipient}>`);
    if (response.code >= 400) {
      socket.end();
      throw new Error(`SMTP RCPT TO failed: ${response.message}`);
    }
  }

  response = await sendSmtpCommand(socket, 'DATA');
  if (response.code >= 400) {
    socket.end();
    throw new Error(`SMTP DATA failed: ${response.message}`);
  }

  const { message, messageId } = buildMimeMessage({
    from: config.from,
    to: config.to,
    cc: config.cc,
    bcc: config.bcc,
    subject: config.subject,
    text: config.text,
    html: config.html,
    replyTo: config.replyTo,
  });

  const normalized = message
    .replace(/\r?\n/g, '\r\n')
    .replace(/^\./, '..')
    .replace(/\r\n\./g, '\r\n..');

  socket.write(normalized + '\r\n.\r\n');
  response = await readSmtpResponse(socket);
  if (response.code >= 400) {
    socket.end();
    throw new Error(`SMTP message rejected: ${response.message}`);
  }

  await sendSmtpCommand(socket, 'QUIT');
  socket.end();

  return { success: true, messageId, provider: 'smtp' };
}

export default definePlugin({
  name: 'email',
  version: '1.1.0',
  description: 'Send emails via SMTP or API and receive inbound webhooks',

  actions: [
    defineAction({
      name: 'send',
      description: 'Send an email',
      schema: SendEmailSchema,
      async execute(ctx) {
        const emailConfig = SendEmailSchema.parse(ctx.config);
        const apiKey = (ctx.config.apiKey as string) ?? ctx.env.EMAIL_API_KEY ?? process.env.RESEND_API_KEY;
        const provider = emailConfig.provider ?? 'auto';

        const to = Array.isArray(emailConfig.to) ? emailConfig.to : [emailConfig.to];
        const cc = emailConfig.cc ? (Array.isArray(emailConfig.cc) ? emailConfig.cc : [emailConfig.cc]) : [];
        const bcc = emailConfig.bcc ? (Array.isArray(emailConfig.bcc) ? emailConfig.bcc : [emailConfig.bcc]) : [];
        const smtpConfig = resolveSmtpConfig(ctx);
        const from = emailConfig.from
          ?? ctx.env.EMAIL_FROM
          ?? process.env.EMAIL_FROM
          ?? smtpConfig?.user
          ?? 'noreply@example.com';

        ctx.log(`Sending email to ${to.join(', ')}: ${emailConfig.subject}`);

        if (provider === 'api' || (provider === 'auto' && apiKey)) {
          if (!apiKey) {
            throw new Error('Email API key missing. Set EMAIL_API_KEY or RESEND_API_KEY, or use SMTP.');
          }
          return await sendViaAPI({
            apiKey,
            to,
            from,
            subject: emailConfig.subject,
            text: emailConfig.text,
            html: emailConfig.html,
            replyTo: emailConfig.replyTo,
            cc,
            bcc,
          });
        }

        if (provider === 'smtp' || (provider === 'auto' && smtpConfig)) {
          if (!smtpConfig) {
            throw new Error('SMTP configuration missing. Provide smtp config or SMTP_* environment variables.');
          }
          return await sendViaSMTP({
            smtp: smtpConfig,
            from,
            to,
            cc,
            bcc,
            subject: emailConfig.subject,
            text: emailConfig.text,
            html: emailConfig.html,
            replyTo: emailConfig.replyTo,
          });
        }

        // Fallback to console log for development
        console.log(`[email] Would send email:\n  To: ${to.join(', ')}\n  From: ${from}\n  Subject: ${emailConfig.subject}\n  Body: ${emailConfig.text ?? emailConfig.html ?? '(empty)'}\n`);
        return { success: true, messageId: 'dev-mode', provider: 'dry-run' };
      },
    }),

    defineAction({
      name: 'send_template',
      description: 'Send an email using a template',
      async execute(ctx) {
        const apiKey = (ctx.config.apiKey as string) ?? ctx.env.EMAIL_API_KEY ?? process.env.RESEND_API_KEY;
        const templateId = ctx.config.templateId as string;
        const to = ctx.config.to as string | string[];
        const from = (ctx.config.from as string) ?? ctx.env.EMAIL_FROM ?? 'noreply@example.com';
        const variables = ctx.config.variables as Record<string, string>;

        const toList = Array.isArray(to) ? to : [to];

        ctx.log(`Sending template email ${templateId} to ${toList.join(', ')}`);

        // Template-based sending - uses Resend API
        if (apiKey) {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from,
              to: toList,
              template_id: templateId,
              data: variables,
            }),
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(`Email API error: ${response.status} ${error}`);
          }

          const data = await response.json() as { id?: string };
          return { success: true, messageId: data.id, provider: 'api' };
        }

        return {
          success: true,
          templateId,
          to: toList,
          from,
          variables,
          mode: 'dry-run',
        };
      },
    }),
  ],

  triggers: [
    defineTrigger({
      name: 'inbound',
      description: 'Trigger on inbound email (via webhook payload)',
      schema: InboundConfigSchema,
    }),
  ],

  auth: {
    type: 'api_key',
    config: {
      name: 'EMAIL_API_KEY',
    },
  },
});
