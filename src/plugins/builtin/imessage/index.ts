import { definePlugin, defineAction } from '../../sdk/types.js';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';

const execAsync = promisify(exec);

// Check if we're on macOS
function checkMacOS(): void {
  if (platform() !== 'darwin') {
    throw new Error('iMessage is only available on macOS');
  }
}

const SendMessageSchema = z.object({
  to: z.string(), // Phone number or email
  text: z.string(),
  service: z.enum(['iMessage', 'SMS']).default('iMessage'),
});

const SendFileSchema = z.object({
  to: z.string(),
  filePath: z.string(),
  service: z.enum(['iMessage', 'SMS']).default('iMessage'),
});

const ReadMessagesSchema = z.object({
  from: z.string().optional(), // Filter by sender
  limit: z.number().default(10),
  hoursAgo: z.number().default(24), // Only messages from last N hours
});

// Escape string for AppleScript
function escapeAppleScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

export default definePlugin({
  name: 'imessage',
  version: '1.0.0',
  description: 'Send and read iMessages (macOS only)',

  actions: [
    defineAction({
      name: 'send',
      description: 'Send an iMessage or SMS',
      schema: SendMessageSchema,
      async execute(ctx) {
        checkMacOS();
        const config = SendMessageSchema.parse(ctx.config);

        ctx.log(`Sending ${config.service} to ${config.to}`);

        const escapedText = escapeAppleScript(config.text);
        const escapedTo = escapeAppleScript(config.to);

        // AppleScript to send message
        const script = `
          tell application "Messages"
            set targetService to 1st service whose service type = ${config.service}
            set targetBuddy to buddy "${escapedTo}" of targetService
            send "${escapedText}" to targetBuddy
          end tell
        `;

        try {
          await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);

          return {
            sent: true,
            to: config.to,
            service: config.service,
            timestamp: new Date().toISOString(),
          };
        } catch (err) {
          // Try alternative method using just the phone/email
          const altScript = `
            tell application "Messages"
              send "${escapedText}" to buddy "${escapedTo}"
            end tell
          `;

          try {
            await execAsync(`osascript -e '${altScript.replace(/'/g, "'\"'\"'")}'`);
            return {
              sent: true,
              to: config.to,
              service: config.service,
              timestamp: new Date().toISOString(),
              method: 'fallback',
            };
          } catch (fallbackErr) {
            throw new Error(`Failed to send message: ${err}. Fallback also failed: ${fallbackErr}`);
          }
        }
      },
    }),

    defineAction({
      name: 'sendFile',
      description: 'Send a file via iMessage',
      schema: SendFileSchema,
      async execute(ctx) {
        checkMacOS();
        const config = SendFileSchema.parse(ctx.config);

        ctx.log(`Sending file to ${config.to} via ${config.service}`);

        const escapedTo = escapeAppleScript(config.to);
        const escapedPath = escapeAppleScript(config.filePath);

        const script = `
          tell application "Messages"
            set targetService to 1st service whose service type = ${config.service}
            set targetBuddy to buddy "${escapedTo}" of targetService
            send POSIX file "${escapedPath}" to targetBuddy
          end tell
        `;

        try {
          await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);

          return {
            sent: true,
            to: config.to,
            filePath: config.filePath,
            service: config.service,
          };
        } catch (err) {
          throw new Error(`Failed to send file: ${err}`);
        }
      },
    }),

    defineAction({
      name: 'read',
      description: 'Read recent messages from the Messages database',
      schema: ReadMessagesSchema,
      async execute(ctx) {
        checkMacOS();
        const config = ReadMessagesSchema.parse(ctx.config);

        ctx.log(`Reading last ${config.limit} messages`);

        // Query the Messages SQLite database
        // Note: Requires Full Disk Access permission
        const dbPath = `${process.env.HOME}/Library/Messages/chat.db`;

        let whereClause = `WHERE datetime(message.date/1000000000 + 978307200, 'unixepoch') > datetime('now', '-${config.hoursAgo} hours')`;

        if (config.from) {
          whereClause += ` AND handle.id LIKE '%${config.from}%'`;
        }

        const query = `
          SELECT
            message.rowid,
            message.text,
            message.is_from_me,
            datetime(message.date/1000000000 + 978307200, 'unixepoch') as date,
            handle.id as sender
          FROM message
          LEFT JOIN handle ON message.handle_id = handle.rowid
          ${whereClause}
          ORDER BY message.date DESC
          LIMIT ${config.limit}
        `;

        try {
          const { stdout } = await execAsync(
            `sqlite3 -json "${dbPath}" "${query.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`,
            { maxBuffer: 10 * 1024 * 1024 }
          );

          const messages = JSON.parse(stdout || '[]') as Array<{
            rowid: number;
            text: string;
            is_from_me: number;
            date: string;
            sender: string;
          }>;

          return {
            messages: messages.map(m => ({
              id: m.rowid,
              text: m.text,
              isFromMe: m.is_from_me === 1,
              date: m.date,
              sender: m.sender,
            })),
            count: messages.length,
          };
        } catch (err) {
          const errorMsg = String(err);
          if (errorMsg.includes('unable to open database')) {
            throw new Error(
              'Cannot access Messages database. Grant Full Disk Access to Terminal/your shell in System Preferences > Security & Privacy > Privacy > Full Disk Access'
            );
          }
          throw new Error(`Failed to read messages: ${err}`);
        }
      },
    }),

    defineAction({
      name: 'status',
      description: 'Check if iMessage is available and configured',
      async execute(ctx) {
        ctx.log('Checking iMessage status');

        const isMac = platform() === 'darwin';
        if (!isMac) {
          return {
            available: false,
            reason: 'Not running on macOS',
          };
        }

        // Check if Messages app exists
        try {
          await execAsync('ls /Applications/Messages.app');
        } catch {
          return {
            available: false,
            reason: 'Messages.app not found',
          };
        }

        // Check if we can access Messages
        const script = `
          tell application "Messages"
            return (count of services)
          end tell
        `;

        try {
          const { stdout } = await execAsync(`osascript -e '${script}'`);
          const serviceCount = parseInt(stdout.trim(), 10);

          return {
            available: true,
            serviceCount,
            platform: 'macOS',
          };
        } catch (err) {
          return {
            available: false,
            reason: `Cannot access Messages: ${err}`,
          };
        }
      },
    }),
  ],
});
