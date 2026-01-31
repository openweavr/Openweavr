import { definePlugin, defineAction } from '../../sdk/types.js';
import { z } from 'zod';

const SendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string(),
  text: z.string().optional(),
  html: z.string().optional(),
  from: z.string().optional(),
  replyTo: z.string().email().optional(),
  cc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  bcc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
});

// Simple email sending using fetch to an email API service
// For production, you'd want to use nodemailer or similar
async function sendViaAPI(config: {
  apiKey: string;
  to: string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<{ success: boolean; messageId?: string }> {
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
  return { success: true, messageId: data.id };
}

export default definePlugin({
  name: 'email',
  version: '1.0.0',
  description: 'Send emails via SMTP or API',

  actions: [
    defineAction({
      name: 'send',
      description: 'Send an email',
      schema: SendEmailSchema,
      async execute(ctx) {
        const emailConfig = SendEmailSchema.parse(ctx.config);
        const apiKey = (ctx.config.apiKey as string) ?? ctx.env.EMAIL_API_KEY ?? process.env.RESEND_API_KEY;

        const to = Array.isArray(emailConfig.to) ? emailConfig.to : [emailConfig.to];
        const from = emailConfig.from ?? ctx.env.EMAIL_FROM ?? 'noreply@example.com';

        ctx.log(`Sending email to ${to.join(', ')}: ${emailConfig.subject}`);

        if (apiKey) {
          // Use API-based sending
          return await sendViaAPI({
            apiKey,
            to,
            from,
            subject: emailConfig.subject,
            text: emailConfig.text,
            html: emailConfig.html,
          });
        } else {
          // Fallback to console log for development
          console.log(`[email] Would send email:
            To: ${to.join(', ')}
            From: ${from}
            Subject: ${emailConfig.subject}
            Body: ${emailConfig.text ?? emailConfig.html ?? '(empty)'}
          `);
          return { success: true, messageId: 'dev-mode' };
        }
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
          return { success: true, messageId: data.id };
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

  auth: {
    type: 'api_key',
    config: {
      name: 'EMAIL_API_KEY',
    },
  },
});
