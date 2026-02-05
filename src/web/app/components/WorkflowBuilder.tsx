import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Handle,
  Position,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AIChat } from './AIChat';
import { NodeLibrary } from './NodeLibrary';
import { type ContextPanelTab } from './ContextPanel';
import { YAMLEditor } from './YAMLEditor';
import { MemoryBlockEditor } from './MemoryBlockEditor';
import { AIChatPanel, type ChatMessage } from './AIChatPanel';
import { IntegrationIcon } from './IntegrationIcon';
import YAML from 'yaml';

interface WorkflowBuilderProps {
  onSave?: (yaml: string, name: string) => void;
  saving?: boolean;
  initialYaml?: string | null;
  initialName?: string | null;
  onBack?: () => void;
}

interface StepData {
  label: string;
  action: string;
  config: Record<string, unknown>;
  icon: string;
  stepId: string; // The user-visible step name/ID used in YAML and templates
}

type MemorySourceType = 'text' | 'file' | 'url' | 'web_search' | 'step' | 'trigger';

interface MemorySourceInput {
  id?: string;
  label?: string;
  type: MemorySourceType;
  text?: string;
  path?: string;
  url?: string;
  query?: string;
  step?: string;
  maxResults?: number;
  maxChars?: number;
}

interface MemoryBlockInput {
  id: string;
  description?: string;
  sources: MemorySourceInput[];
  template?: string;
  separator?: string;
  maxChars?: number;
  dedupe?: boolean;
}

interface OutputField {
  name: string;
  type: string;
  description: string;
}

interface ActionSchema {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  fields: FieldDef[];
  outputFields?: OutputField[];
}

interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'multiselect' | 'schedule';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  default?: unknown;
}

// Common timezone options
const TIMEZONE_OPTIONS = [
  { value: '', label: 'Local (System Default)' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)' },
];

// Schedule preset options with their cron expressions
const SCHEDULE_PRESETS = [
  { value: 'every-5-min', label: 'Every 5 minutes', expression: '*/5 * * * *' },
  { value: 'every-15-min', label: 'Every 15 minutes', expression: '*/15 * * * *' },
  { value: 'every-30-min', label: 'Every 30 minutes', expression: '*/30 * * * *' },
  { value: 'hourly', label: 'Every hour', expression: '0 * * * *' },
  { value: 'daily-9am', label: 'Daily at 9:00 AM', expression: '0 9 * * *' },
  { value: 'daily-midnight', label: 'Daily at midnight', expression: '0 0 * * *' },
  { value: 'weekdays-9am', label: 'Weekdays at 9:00 AM', expression: '0 9 * * 1-5' },
  { value: 'weekly-monday', label: 'Weekly on Monday at 9:00 AM', expression: '0 9 * * 1' },
  { value: 'monthly-first', label: 'Monthly on the 1st at 9:00 AM', expression: '0 9 1 * *' },
  { value: 'custom', label: 'Custom (Advanced)', expression: '' },
];

// Action schemas with field definitions
const ACTION_SCHEMAS: ActionSchema[] = [
  // HTTP
  {
    id: 'http.get',
    label: 'HTTP GET',
    description: 'Fetch data from a URL',
    icon: 'http',
    category: 'HTTP',
    fields: [
      { name: 'url', label: 'URL', type: 'text', placeholder: 'https://api.example.com/data', required: true },
      { name: 'headers', label: 'Headers (JSON)', type: 'textarea', placeholder: '{"Authorization": "Bearer ..."}' },
    ],
    outputFields: [
      { name: 'status', type: 'number', description: 'HTTP status code' },
      { name: 'data', type: 'any', description: 'Response body (JSON or text)' },
      { name: 'ok', type: 'boolean', description: 'True if status is 2xx' },
    ],
  },
  {
    id: 'http.post',
    label: 'HTTP POST',
    description: 'Send data to a URL',
    icon: 'http',
    category: 'HTTP',
    fields: [
      { name: 'url', label: 'URL', type: 'text', placeholder: 'https://api.example.com/data', required: true },
      { name: 'body', label: 'Request Body (JSON)', type: 'textarea', placeholder: '{"key": "value"}' },
      { name: 'headers', label: 'Headers (JSON)', type: 'textarea', placeholder: '{"Content-Type": "application/json"}' },
    ],
    outputFields: [
      { name: 'status', type: 'number', description: 'HTTP status code' },
      { name: 'data', type: 'any', description: 'Response body (JSON or text)' },
      { name: 'ok', type: 'boolean', description: 'True if status is 2xx' },
    ],
  },
  {
    id: 'http.request',
    label: 'HTTP Request',
    description: 'Make a custom HTTP request',
    icon: 'http',
    category: 'HTTP',
    fields: [
      { name: 'url', label: 'URL', type: 'text', placeholder: 'https://api.example.com', required: true },
      { name: 'method', label: 'Method', type: 'select', options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
        { value: 'DELETE', label: 'DELETE' },
      ], default: 'GET' },
      { name: 'body', label: 'Request Body', type: 'textarea', placeholder: '{}' },
    ],
    outputFields: [
      { name: 'status', type: 'number', description: 'HTTP status code' },
      { name: 'statusText', type: 'string', description: 'HTTP status text' },
      { name: 'headers', type: 'object', description: 'Response headers' },
      { name: 'data', type: 'any', description: 'Response body' },
      { name: 'ok', type: 'boolean', description: 'True if status is 2xx' },
    ],
  },
  // Slack
  {
    id: 'slack.post',
    label: 'Post to Slack',
    description: 'Send a message to a Slack channel',
    icon: 'slack',
    category: 'Slack',
    fields: [
      { name: 'channel', label: 'Channel', type: 'text', placeholder: '#general', required: true },
      { name: 'text', label: 'Message', type: 'textarea', placeholder: 'Hello from Weavr!', required: true },
    ],
  },
  // Discord
  {
    id: 'discord.send',
    label: 'Send to Discord',
    description: 'Send a message via Discord webhook',
    icon: 'discord',
    category: 'Discord',
    fields: [
      { name: 'webhook_url', label: 'Webhook URL', type: 'text', placeholder: 'https://discord.com/api/webhooks/...', required: true },
      { name: 'content', label: 'Message', type: 'textarea', placeholder: 'Hello from Weavr!', required: true },
    ],
  },
  // GitHub
  {
    id: 'github.create_issue',
    label: 'Create GitHub Issue',
    description: 'Create a new issue in a repository',
    icon: 'github',
    category: 'GitHub',
    fields: [
      { name: 'repo', label: 'Repository', type: 'text', placeholder: 'owner/repo', required: true },
      { name: 'title', label: 'Issue Title', type: 'text', placeholder: 'Bug report', required: true },
      { name: 'body', label: 'Issue Body', type: 'textarea', placeholder: 'Describe the issue...' },
      { name: 'labels', label: 'Labels (comma-separated)', type: 'text', placeholder: 'bug, urgent' },
    ],
  },
  {
    id: 'github.create_comment',
    label: 'Add GitHub Comment',
    description: 'Add a comment to an issue or PR',
    icon: 'github',
    category: 'GitHub',
    fields: [
      { name: 'repo', label: 'Repository', type: 'text', placeholder: 'owner/repo', required: true },
      { name: 'issue_number', label: 'Issue/PR Number', type: 'number', placeholder: '123', required: true },
      { name: 'body', label: 'Comment', type: 'textarea', placeholder: 'Your comment...', required: true },
    ],
  },
  // AI
  {
    id: 'ai.complete',
    label: 'AI Generate',
    description: 'Generate text using AI',
    icon: 'ai',
    category: 'AI',
    fields: [
      { name: 'prompt', label: 'Prompt', type: 'textarea', placeholder: 'Write a summary of...', required: true },
      { name: 'system', label: 'System Prompt', type: 'textarea', placeholder: 'You are a helpful assistant...' },
      { name: 'maxTokens', label: 'Max Tokens', type: 'number', placeholder: '1024', default: 1024 },
    ],
    outputFields: [
      { name: 'text', type: 'string', description: 'Generated text' },
      { name: 'model', type: 'string', description: 'Model used' },
      { name: 'provider', type: 'string', description: 'AI provider' },
    ],
  },
  {
    id: 'ai.summarize',
    label: 'AI Summarize',
    description: 'Summarize text using AI',
    icon: 'ai',
    category: 'AI',
    fields: [
      { name: 'text', label: 'Text to Summarize', type: 'textarea', placeholder: 'The text to summarize...', required: true },
      { name: 'maxLength', label: 'Max Words', type: 'number', placeholder: '200', default: 200 },
      { name: 'style', label: 'Style', type: 'select', options: [
        { value: 'concise', label: 'Concise' },
        { value: 'detailed', label: 'Detailed' },
        { value: 'bullet-points', label: 'Bullet Points' },
      ], default: 'concise' },
    ],
    outputFields: [
      { name: 'summary', type: 'string', description: 'Summarized text' },
    ],
  },
  {
    id: 'ai.agent',
    label: 'AI Agent',
    description: 'Run a free-flowing AI agent that can use tools to accomplish a task',
    icon: 'brain',
    category: 'AI',
    fields: [
      { name: 'task', label: 'Task', type: 'textarea', placeholder: 'Research the latest news about AI and write a summary...', required: true },
      { name: 'system', label: 'System Prompt', type: 'textarea', placeholder: 'You are a helpful research assistant...' },
      { name: 'tools', label: 'Available Tools', type: 'multiselect', options: [
        { value: 'web_search', label: 'Web Search' },
        { value: 'web_fetch', label: 'Web Fetch' },
        { value: 'shell', label: 'Shell Commands' },
        { value: 'filesystem', label: 'File System' },
      ], default: ['web_search', 'web_fetch'] },
      { name: 'memory', label: 'Memory Blocks', type: 'multiselect', options: [] },
      { name: 'maxIterations', label: 'Max Iterations', type: 'number', placeholder: '10', default: 10 },
    ],
    outputFields: [
      { name: 'result', type: 'string', description: 'Agent\'s final result' },
      { name: 'iterations', type: 'number', description: 'Number of iterations taken' },
      { name: 'success', type: 'boolean', description: 'Whether the agent succeeded' },
    ],
  },
  // Email
  {
    id: 'email.send',
    label: 'Send Email',
    description: 'Send an email via SMTP',
    icon: 'email',
    category: 'Email',
    fields: [
      { name: 'to', label: 'To', type: 'text', placeholder: 'recipient@example.com', required: true },
      { name: 'subject', label: 'Subject', type: 'text', placeholder: 'Email subject', required: true },
      { name: 'body', label: 'Body', type: 'textarea', placeholder: 'Email content...', required: true },
    ],
  },
  // JSON
  {
    id: 'json.parse',
    label: 'Parse JSON',
    description: 'Parse a JSON string',
    icon: 'json',
    category: 'Data',
    fields: [
      { name: 'input', label: 'JSON String', type: 'textarea', placeholder: '{"key": "value"}', required: true },
    ],
    outputFields: [
      { name: 'data', type: 'any', description: 'Parsed JSON object' },
    ],
  },
  {
    id: 'json.get',
    label: 'Get JSON Value',
    description: 'Extract a value from JSON using a path',
    icon: 'json',
    category: 'Data',
    fields: [
      { name: 'input', label: 'JSON Object', type: 'textarea', placeholder: '{{ steps.prev.data }}', required: true },
      { name: 'path', label: 'Path', type: 'text', placeholder: 'data.items[0].name', required: true },
    ],
    outputFields: [
      { name: 'value', type: 'any', description: 'Extracted value' },
    ],
  },
  // Transform
  {
    id: 'transform',
    label: 'Transform Data',
    description: 'Transform data using a template',
    icon: 'transform',
    category: 'Data',
    fields: [
      { name: 'template', label: 'Template', type: 'textarea', placeholder: '{{ steps.prev.data | json }}', required: true },
    ],
    outputFields: [
      { name: 'result', type: 'string', description: 'Transformed output' },
    ],
  },
  // Filesystem
  {
    id: 'filesystem.read',
    label: 'Read File',
    description: 'Read contents of a file',
    icon: 'file',
    category: 'Local',
    fields: [
      { name: 'path', label: 'File Path', type: 'text', placeholder: '/path/to/file.txt', required: true },
      { name: 'parse', label: 'Parse As', type: 'select', options: [
        { value: 'auto', label: 'Auto-detect' },
        { value: 'text', label: 'Plain Text' },
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
      ], default: 'auto' },
    ],
    outputFields: [
      { name: 'content', type: 'string', description: 'File content as text' },
      { name: 'data', type: 'any', description: 'Parsed content (JSON/YAML)' },
      { name: 'path', type: 'string', description: 'File path' },
      { name: 'size', type: 'number', description: 'File size in bytes' },
    ],
  },
  {
    id: 'filesystem.write',
    label: 'Write File',
    description: 'Write content to a file',
    icon: 'file-write',
    category: 'Local',
    fields: [
      { name: 'path', label: 'File Path', type: 'text', placeholder: '/path/to/file.txt', required: true },
      { name: 'content', label: 'Content', type: 'textarea', placeholder: 'File contents...', required: true },
      { name: 'mode', label: 'Mode', type: 'select', options: [
        { value: 'write', label: 'Overwrite' },
        { value: 'append', label: 'Append' },
      ], default: 'write' },
    ],
    outputFields: [
      { name: 'path', type: 'string', description: 'File path written to' },
      { name: 'size', type: 'number', description: 'File size in bytes' },
      { name: 'written', type: 'boolean', description: 'Success flag' },
    ],
  },
  {
    id: 'filesystem.list',
    label: 'List Directory',
    description: 'List files in a directory',
    icon: 'folder',
    category: 'Local',
    fields: [
      { name: 'path', label: 'Directory Path', type: 'text', placeholder: '/path/to/dir', required: true },
      { name: 'pattern', label: 'Filter Pattern (regex)', type: 'text', placeholder: '\\.json$' },
    ],
    outputFields: [
      { name: 'files', type: 'array', description: 'List of files' },
      { name: 'count', type: 'number', description: 'Number of files' },
      { name: 'path', type: 'string', description: 'Directory path' },
    ],
  },
  {
    id: 'filesystem.delete',
    label: 'Delete File',
    description: 'Delete a file',
    icon: 'trash',
    category: 'Local',
    fields: [
      { name: 'path', label: 'File Path', type: 'text', placeholder: '/path/to/file.txt', required: true },
    ],
    outputFields: [
      { name: 'path', type: 'string', description: 'Deleted file path' },
      { name: 'deleted', type: 'boolean', description: 'Success flag' },
    ],
  },
  // Shell
  {
    id: 'shell.exec',
    label: 'Run Command',
    description: 'Execute a shell command',
    icon: 'terminal',
    category: 'Local',
    fields: [
      { name: 'command', label: 'Command', type: 'text', placeholder: 'ls -la', required: true },
      { name: 'cwd', label: 'Working Directory', type: 'text', placeholder: '/path/to/dir' },
      { name: 'timeout', label: 'Timeout (ms)', type: 'number', placeholder: '30000', default: 30000 },
    ],
    outputFields: [
      { name: 'stdout', type: 'string', description: 'Command output' },
      { name: 'stderr', type: 'string', description: 'Error output' },
      { name: 'exitCode', type: 'number', description: 'Exit code' },
    ],
  },
  {
    id: 'shell.script',
    label: 'Run Script',
    description: 'Run a multi-line script',
    icon: 'script',
    category: 'Local',
    fields: [
      { name: 'script', label: 'Script', type: 'textarea', placeholder: '#!/bin/bash\necho "Hello"', required: true },
      { name: 'interpreter', label: 'Interpreter', type: 'select', options: [
        { value: 'bash', label: 'Bash' },
        { value: 'sh', label: 'Shell' },
        { value: 'python3', label: 'Python' },
        { value: 'node', label: 'Node.js' },
        { value: 'powershell', label: 'PowerShell' },
        { value: 'cmd', label: 'CMD (Windows)' },
      ], default: 'bash' },
    ],
    outputFields: [
      { name: 'stdout', type: 'string', description: 'Script output' },
      { name: 'stderr', type: 'string', description: 'Error output' },
      { name: 'exitCode', type: 'number', description: 'Exit code' },
    ],
  },
  // Notification
  {
    id: 'notification.show',
    label: 'Show Notification',
    description: 'Display a system notification',
    icon: 'notification',
    category: 'Local',
    fields: [
      { name: 'title', label: 'Title', type: 'text', placeholder: 'Workflow Complete', required: true },
      { name: 'message', label: 'Message', type: 'textarea', placeholder: 'Your workflow finished!', required: true },
      { name: 'sound', label: 'Play Sound', type: 'boolean', default: true },
    ],
    outputFields: [
      { name: 'shown', type: 'boolean', description: 'Notification was displayed' },
    ],
  },
  // Clipboard
  {
    id: 'clipboard.read',
    label: 'Read Clipboard',
    description: 'Read text from clipboard',
    icon: 'clipboard',
    category: 'Local',
    fields: [],
    outputFields: [
      { name: 'text', type: 'string', description: 'Clipboard content' },
    ],
  },
  {
    id: 'clipboard.write',
    label: 'Write Clipboard',
    description: 'Write text to clipboard',
    icon: 'clipboard',
    category: 'Local',
    fields: [
      { name: 'text', label: 'Text', type: 'textarea', placeholder: 'Text to copy...', required: true },
    ],
    outputFields: [
      { name: 'written', type: 'boolean', description: 'Text was copied' },
    ],
  },
  // Telegram
  {
    id: 'telegram.send',
    label: 'Send Telegram',
    description: 'Send a Telegram message',
    icon: 'telegram',
    category: 'Messaging',
    fields: [
      { name: 'chatId', label: 'Chat ID', type: 'text', placeholder: '123456789', required: true },
      { name: 'text', label: 'Message', type: 'textarea', placeholder: 'Hello from Weavr!', required: true },
      { name: 'parseMode', label: 'Format', type: 'select', options: [
        { value: '', label: 'Plain Text' },
        { value: 'Markdown', label: 'Markdown' },
        { value: 'HTML', label: 'HTML' },
      ] },
    ],
    outputFields: [
      { name: 'messageId', type: 'number', description: 'Sent message ID' },
      { name: 'sent', type: 'boolean', description: 'Message was sent' },
    ],
  },
  // WhatsApp
  {
    id: 'whatsapp.send',
    label: 'Send WhatsApp',
    description: 'Send a WhatsApp message',
    icon: 'whatsapp',
    category: 'Messaging',
    fields: [
      { name: 'to', label: 'Phone Number', type: 'text', placeholder: '1234567890', required: true },
      { name: 'text', label: 'Message', type: 'textarea', placeholder: 'Hello from Weavr!', required: true },
    ],
    outputFields: [
      { name: 'messageId', type: 'string', description: 'Sent message ID' },
      { name: 'sent', type: 'boolean', description: 'Message was sent' },
    ],
  },
  // iMessage
  {
    id: 'imessage.send',
    label: 'Send iMessage',
    description: 'Send an iMessage (macOS only)',
    icon: 'imessage',
    category: 'Messaging',
    fields: [
      { name: 'to', label: 'Phone/Email', type: 'text', placeholder: '+1234567890', required: true },
      { name: 'text', label: 'Message', type: 'textarea', placeholder: 'Hello from Weavr!', required: true },
      { name: 'service', label: 'Service', type: 'select', options: [
        { value: 'iMessage', label: 'iMessage' },
        { value: 'SMS', label: 'SMS' },
      ], default: 'iMessage' },
    ],
  },
];

const TRIGGER_SCHEMAS: ActionSchema[] = [
  {
    id: 'http.webhook',
    label: 'Webhook',
    description: 'Trigger when an HTTP request is received',
    icon: 'webhook',
    category: 'HTTP',
    fields: [
      { name: 'path', label: 'Path', type: 'text', placeholder: '/my-webhook', required: true },
      { name: 'method', label: 'Method', type: 'select', options: [
        { value: 'POST', label: 'POST' },
        { value: 'GET', label: 'GET' },
      ], default: 'POST' },
    ],
  },
  {
    id: 'cron.schedule',
    label: 'Schedule',
    description: 'Trigger on a schedule',
    icon: 'cron',
    category: 'Time',
    fields: [
      { name: 'schedule', label: 'Schedule', type: 'schedule', required: true },
      { name: 'timezone', label: 'Timezone', type: 'select', options: TIMEZONE_OPTIONS, default: '' },
    ],
  },
  {
    id: 'github.push',
    label: 'GitHub Push',
    description: 'Trigger when code is pushed',
    icon: 'github',
    category: 'GitHub',
    fields: [
      { name: 'repo', label: 'Repository', type: 'text', placeholder: 'owner/repo', required: true },
      { name: 'branch', label: 'Branch', type: 'text', placeholder: 'main' },
    ],
  },
  {
    id: 'github.pull_request',
    label: 'GitHub PR',
    description: 'Trigger on pull request events',
    icon: 'github',
    category: 'GitHub',
    fields: [
      { name: 'repo', label: 'Repository', type: 'text', placeholder: 'owner/repo', required: true },
      { name: 'events', label: 'Events', type: 'multiselect', options: [
        { value: 'opened', label: 'Opened' },
        { value: 'closed', label: 'Closed' },
        { value: 'synchronize', label: 'Updated (synchronize)' },
        { value: 'merged', label: 'Merged' },
      ], default: ['opened'] },
    ],
  },
  {
    id: 'github.issue.opened',
    label: 'GitHub Issue',
    description: 'Trigger when an issue is opened',
    icon: 'github',
    category: 'GitHub',
    fields: [
      { name: 'repo', label: 'Repository', type: 'text', placeholder: 'owner/repo', required: true },
    ],
  },
  // Local triggers
  {
    id: 'filesystem.watch',
    label: 'File Changed',
    description: 'Trigger when files change in a directory',
    icon: 'folder',
    category: 'Local',
    fields: [
      { name: 'path', label: 'Watch Path', type: 'text', placeholder: '/path/to/watch', required: true },
      { name: 'pattern', label: 'File Pattern (regex)', type: 'text', placeholder: '\\.json$' },
    ],
  },
  // Messaging triggers
  {
    id: 'telegram.message',
    label: 'Telegram Message',
    description: 'Trigger on incoming Telegram messages',
    icon: 'telegram',
    category: 'Messaging',
    fields: [
      { name: 'path', label: 'Webhook Path', type: 'text', placeholder: '/telegram', required: true },
    ],
  },
  {
    id: 'whatsapp.message',
    label: 'WhatsApp Message',
    description: 'Trigger on incoming WhatsApp messages',
    icon: 'whatsapp',
    category: 'Messaging',
    fields: [],
  },
];

// Custom node component for workflow steps (horizontal flow: left-to-right)
function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        background: selected ? 'var(--bg-hover)' : 'var(--bg-secondary)',
        border: `2px solid ${selected ? 'var(--accent-purple)' : 'var(--border-color)'}`,
        minWidth: '200px',
        boxShadow: selected ? '0 0 0 2px rgba(139, 92, 246, 0.3)' : 'none',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'var(--accent-blue)' }} />
      {/* Step name badge */}
      <div style={{
        fontSize: '10px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--accent-purple)',
        background: 'rgba(139, 92, 246, 0.15)',
        padding: '2px 6px',
        borderRadius: '4px',
        marginBottom: '8px',
        display: 'inline-block',
      }}>
        {data.stepId}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <IntegrationIcon name={data.icon} size={20} />
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>{data.label}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{data.action}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: 'var(--accent-green)' }} />
    </div>
  );
}

// Custom trigger node (horizontal flow: left-to-right)
function TriggerNode({ data, selected }: NodeProps<Node<StepData>>) {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        background: selected ? 'rgba(234, 179, 8, 0.2)' : 'rgba(234, 179, 8, 0.1)',
        border: `2px solid ${selected ? 'var(--accent-yellow)' : 'rgba(234, 179, 8, 0.3)'}`,
        minWidth: '200px',
      }}
    >
      {/* Trigger badge */}
      <div style={{
        fontSize: '10px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--accent-yellow)',
        background: 'rgba(234, 179, 8, 0.15)',
        padding: '2px 6px',
        borderRadius: '4px',
        marginBottom: '8px',
        display: 'inline-block',
      }}>
        trigger
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <IntegrationIcon name={data.icon} size={20} />
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>{data.label}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{data.action}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: 'var(--accent-yellow)' }} />
    </div>
  );
}

const nodeTypes = {
  step: StepNode,
  trigger: TriggerNode,
};

// Helper to get upstream steps for variable suggestions
function getUpstreamSteps(
  currentNodeId: string,
  nodes: Node<StepData>[],
  edges: Edge[]
): Array<{ stepId: string; actionId: string; outputFields: OutputField[] }> {
  const upstream: string[] = [];
  const visited = new Set<string>();

  // BFS to find all nodes that flow into current node
  const queue = edges
    .filter(e => e.target === currentNodeId)
    .map(e => e.source);

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    upstream.push(nodeId);

    edges
      .filter(e => e.target === nodeId)
      .forEach(e => queue.push(e.source));
  }

  return upstream
    .map(id => nodes.find(n => n.id === id))
    .filter((n): n is Node<StepData> => n?.type === 'step')
    .map(n => {
      const schema = ACTION_SCHEMAS.find(s => s.id === n.data.action);
      return {
        stepId: n.data.stepId,
        actionId: n.data.action,
        outputFields: schema?.outputFields ?? [{ name: 'data', type: 'any', description: 'Step output' }]
      };
    });
}

// Get trigger variables based on trigger type
function getTriggerVariables(triggerType?: string): Array<{ path: string; description: string }> {
  const common = [
    { path: 'trigger.type', description: 'Trigger type' },
  ];

  if (triggerType?.startsWith('github.pull_request')) {
    return [
      ...common,
      { path: 'trigger.title', description: 'PR title' },
      { path: 'trigger.body', description: 'PR description' },
      { path: 'trigger.author', description: 'PR author username' },
      { path: 'trigger.url', description: 'PR URL' },
      { path: 'trigger.number', description: 'PR number' },
      { path: 'trigger.action', description: 'Event action (opened, closed, etc.)' },
      { path: 'trigger.repository', description: 'Repository name' },
      { path: 'trigger.fileNames', description: 'Array of changed file paths' },
      { path: 'trigger.pullRequest.head.ref', description: 'Source branch' },
      { path: 'trigger.pullRequest.base.ref', description: 'Target branch' },
      { path: 'trigger.pullRequest.additions', description: 'Lines added' },
      { path: 'trigger.pullRequest.deletions', description: 'Lines deleted' },
      { path: 'trigger.pullRequest.labels', description: 'PR labels' },
    ];
  }

  if (triggerType?.startsWith('github.issue')) {
    return [
      ...common,
      { path: 'trigger.title', description: 'Issue title' },
      { path: 'trigger.body', description: 'Issue body' },
      { path: 'trigger.author', description: 'Issue author username' },
      { path: 'trigger.url', description: 'Issue URL' },
      { path: 'trigger.number', description: 'Issue number' },
      { path: 'trigger.action', description: 'Event action' },
      { path: 'trigger.repository', description: 'Repository name' },
      { path: 'trigger.issue.labels', description: 'Issue labels' },
      { path: 'trigger.issue.assignees', description: 'Assignee usernames' },
    ];
  }

  if (triggerType?.startsWith('github.push')) {
    return [
      ...common,
      { path: 'trigger.branch', description: 'Branch name' },
      { path: 'trigger.repository', description: 'Repository name' },
      { path: 'trigger.commits', description: 'Array of commits' },
      { path: 'trigger.headCommit.message', description: 'Latest commit message' },
      { path: 'trigger.headCommit.author.name', description: 'Commit author' },
    ];
  }

  if (triggerType?.startsWith('telegram') || triggerType?.startsWith('slack') || triggerType?.startsWith('discord')) {
    return [
      ...common,
      { path: 'trigger.text', description: 'Message text' },
      { path: 'trigger.from', description: 'Sender info' },
      { path: 'trigger.chat', description: 'Chat/channel info' },
    ];
  }

  if (triggerType?.startsWith('cron')) {
    return [
      ...common,
      { path: 'trigger.expression', description: 'Cron expression' },
    ];
  }

  // Generic fallback
  return [
    ...common,
    { path: 'trigger.data', description: 'Trigger payload' },
  ];
}

// Variable Suggestions Dropdown
function VariableSuggestions({
  suggestions,
  onSelect,
  filterText,
  visible,
  triggerType,
  memoryBlocks,
}: {
  suggestions: Array<{ stepId: string; actionId: string; outputFields: OutputField[] }>;
  onSelect: (variable: string) => void;
  filterText: string;
  visible: boolean;
  triggerType?: string;
  memoryBlocks: MemoryBlockInput[];
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Build flat list of all variables
  const allVariables = useMemo(() => {
    const vars: Array<{ path: string; description: string; category: string }> = [];

    for (const step of suggestions) {
      for (const field of step.outputFields) {
        vars.push({
          path: `steps.${step.stepId}.${field.name}`,
          description: field.description,
          category: step.stepId,
        });
      }
    }

    // Add trigger variables based on trigger type
    const triggerVars = getTriggerVariables(triggerType);
    for (const tv of triggerVars) {
      vars.push({ ...tv, category: 'trigger' });
    }

    if (memoryBlocks.length > 0) {
      for (const block of memoryBlocks) {
        if (!block.id) continue;
        vars.push({
          path: `memory.blocks.${block.id}`,
          description: block.description || 'Memory block',
          category: 'memory',
        });
        block.sources.forEach((source, index) => {
          const sourceId = source.id || `source_${index + 1}`;
          vars.push({
            path: `memory.sources.${block.id}.${sourceId}`,
            description: source.label || 'Memory source',
            category: 'memory',
          });
        });
      }
    }

    return vars;
  }, [suggestions, triggerType, memoryBlocks]);

  // Filter by what user has typed
  const filtered = useMemo(() => {
    if (!filterText) return allVariables;
    const lower = filterText.toLowerCase();
    return allVariables.filter(v => v.path.toLowerCase().includes(lower));
  }, [allVariables, filterText]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filterText]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      zIndex: 100,
      maxHeight: '200px',
      overflow: 'auto',
    }}>
      {filtered.map((v, i) => (
        <div
          key={v.path}
          onClick={() => onSelect(v.path)}
          style={{
            padding: '8px 12px',
            cursor: 'pointer',
            background: i === selectedIndex ? 'var(--bg-hover)' : 'transparent',
            borderBottom: i < filtered.length - 1 ? '1px solid var(--border-color)' : 'none',
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-purple)' }}>
            {'{{ ' + v.path + ' }}'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {v.description}
          </div>
        </div>
      ))}
    </div>
  );
}

// Field aliases - map alternative field names to canonical names
const FIELD_ALIASES: Record<string, Record<string, string>> = {
  'telegram.send': { message: 'text' },
  'slack.post': { message: 'text' },
  'discord.send': { message: 'content' },
  'whatsapp.send': { message: 'text' },
};

// Normalize config to use canonical field names
function normalizeConfig(action: string, config: Record<string, unknown>): Record<string, unknown> {
  const aliases = FIELD_ALIASES[action];
  if (!aliases) return config;

  const normalized = { ...config };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias in normalized && !(canonical in normalized)) {
      normalized[canonical] = normalized[alias];
      delete normalized[alias];
    }
  }
  return normalized;
}

function MemoryEditor({
  blocks,
  onAddBlock,
  onUpdateBlock,
  onRemoveBlock,
  onAddSource,
  onUpdateSource,
  onRemoveSource,
}: {
  blocks: MemoryBlockInput[];
  onAddBlock: () => void;
  onUpdateBlock: (index: number, patch: Partial<MemoryBlockInput>) => void;
  onRemoveBlock: (index: number) => void;
  onAddSource: (blockIndex: number) => void;
  onUpdateSource: (blockIndex: number, sourceIndex: number, patch: Partial<MemorySourceInput>) => void;
  onRemoveSource: (blockIndex: number, sourceIndex: number) => void;
}) {
  const sourceTypes: Array<{ value: MemorySourceType; label: string }> = [
    { value: 'text', label: 'Text' },
    { value: 'file', label: 'File' },
    { value: 'url', label: 'URL' },
    { value: 'web_search', label: 'Web Search' },
    { value: 'step', label: 'Step Output' },
    { value: 'trigger', label: 'Trigger Data' },
  ];

  return (
    <div className="card" style={{ flex: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ fontSize: '14px', margin: 0 }}>Memory Blocks</h3>
        <button className="btn btn-ghost" onClick={onAddBlock} style={{ padding: '6px 10px' }}>
          + Add
        </button>
      </div>

      {blocks.length === 0 && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          No memory blocks yet. Add one to assemble reusable context.
        </div>
      )}

      {blocks.map((block, index) => (
        <div
          key={`${block.id}-${index}`}
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '12px',
            background: 'var(--bg-secondary)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Block {index + 1}
            </div>
            <button className="btn btn-ghost" onClick={() => onRemoveBlock(index)} style={{ color: 'var(--accent-red)', padding: '4px 8px' }}>
              Remove
            </button>
          </div>

          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            Block ID
          </label>
          <input
            className="input"
            value={block.id}
            onChange={(e) => onUpdateBlock(index, { id: e.target.value })}
            placeholder="project-context"
            style={{ marginBottom: '10px' }}
          />

          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            Description
          </label>
          <input
            className="input"
            value={block.description ?? ''}
            onChange={(e) => onUpdateBlock(index, { description: e.target.value })}
            placeholder="Short label for this memory block"
            style={{ marginBottom: '10px' }}
          />

          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            Template
          </label>
          <textarea
            className="input"
            value={block.template ?? ''}
            onChange={(e) => onUpdateBlock(index, { template: e.target.value })}
            placeholder="Optional: combine sources with {{ sources.source_id }}"
            style={{ minHeight: '70px', marginBottom: '10px' }}
          />

          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            Separator
          </label>
          <input
            className="input"
            value={block.separator ?? ''}
            onChange={(e) => onUpdateBlock(index, { separator: e.target.value })}
            placeholder="Default separator between sources"
            style={{ marginBottom: '10px' }}
          />

          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                Max Chars
              </label>
              <input
                type="number"
                className="input"
                value={block.maxChars ?? ''}
                onChange={(e) => onUpdateBlock(index, { maxChars: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="12000"
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '20px' }}>
              <input
                type="checkbox"
                checked={Boolean(block.dedupe)}
                onChange={(e) => onUpdateBlock(index, { dedupe: e.target.checked })}
              />
              <span style={{ fontSize: '12px' }}>Dedupe</span>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Sources</div>
            <button className="btn btn-ghost" onClick={() => onAddSource(index)} style={{ padding: '4px 8px' }}>
              + Add Source
            </button>
          </div>

          {block.sources.map((source, sourceIndex) => (
            <div
              key={`${source.type}-${sourceIndex}`}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '10px',
                marginBottom: '8px',
                background: 'var(--bg-primary)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Source {sourceIndex + 1}
                </div>
                <button className="btn btn-ghost" onClick={() => onRemoveSource(index, sourceIndex)} style={{ color: 'var(--accent-red)', padding: '4px 8px' }}>
                  Remove
                </button>
              </div>

              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                Source ID
              </label>
              <input
                className="input"
                value={source.id ?? ''}
                onChange={(e) => onUpdateSource(index, sourceIndex, { id: e.target.value })}
                placeholder="docs"
                style={{ marginBottom: '8px' }}
              />

              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                Label
              </label>
              <input
                className="input"
                value={source.label ?? ''}
                onChange={(e) => onUpdateSource(index, sourceIndex, { label: e.target.value })}
                placeholder="Optional display label"
                style={{ marginBottom: '8px' }}
              />

              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                Type
              </label>
              <select
                className="input"
                value={source.type}
                onChange={(e) => onUpdateSource(index, sourceIndex, { type: e.target.value as MemorySourceType })}
                style={{ marginBottom: '8px' }}
              >
                {sourceTypes.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              {source.type === 'text' && (
                <textarea
                  className="input"
                  value={source.text ?? ''}
                  onChange={(e) => onUpdateSource(index, sourceIndex, { text: e.target.value })}
                  placeholder="Inline text or instructions"
                  style={{ minHeight: '60px', marginBottom: '8px' }}
                />
              )}

              {source.type === 'file' && (
                <input
                  className="input"
                  value={source.path ?? ''}
                  onChange={(e) => onUpdateSource(index, sourceIndex, { path: e.target.value })}
                  placeholder="docs/overview.md"
                  style={{ marginBottom: '8px' }}
                />
              )}

              {source.type === 'url' && (
                <input
                  className="input"
                  value={source.url ?? ''}
                  onChange={(e) => onUpdateSource(index, sourceIndex, { url: e.target.value })}
                  placeholder="https://openweavr.ai"
                  style={{ marginBottom: '8px' }}
                />
              )}

              {source.type === 'web_search' && (
                <>
                  <input
                    className="input"
                    value={source.query ?? ''}
                    onChange={(e) => onUpdateSource(index, sourceIndex, { query: e.target.value })}
                    placeholder="Search query"
                    style={{ marginBottom: '8px' }}
                  />
                  <input
                    type="number"
                    className="input"
                    value={source.maxResults ?? ''}
                    onChange={(e) => onUpdateSource(index, sourceIndex, { maxResults: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="Max results"
                    style={{ marginBottom: '8px' }}
                  />
                </>
              )}

              {source.type === 'step' && (
                <>
                  <input
                    className="input"
                    value={source.step ?? ''}
                    onChange={(e) => onUpdateSource(index, sourceIndex, { step: e.target.value })}
                    placeholder="step-id"
                    style={{ marginBottom: '8px' }}
                  />
                  <input
                    className="input"
                    value={source.path ?? ''}
                    onChange={(e) => onUpdateSource(index, sourceIndex, { path: e.target.value })}
                    placeholder="output.path (optional)"
                    style={{ marginBottom: '8px' }}
                  />
                </>
              )}

              {source.type === 'trigger' && (
                <input
                  className="input"
                  value={source.path ?? ''}
                  onChange={(e) => onUpdateSource(index, sourceIndex, { path: e.target.value })}
                  placeholder="trigger.path (optional)"
                  style={{ marginBottom: '8px' }}
                />
              )}

              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                Max Chars
              </label>
              <input
                type="number"
                className="input"
                value={source.maxChars ?? ''}
                onChange={(e) => onUpdateSource(index, sourceIndex, { maxChars: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="12000"
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Property Editor Component
function PropertyEditor({
  node,
  schema,
  onUpdate,
  onUpdateStepId,
  onDelete,
  nodes,
  edges,
  availableTools,
  memoryBlocks,
}: {
  node: Node<StepData>;
  schema: ActionSchema | undefined;
  onUpdate: (config: Record<string, unknown>) => void;
  onUpdateStepId: (stepId: string) => void;
  onDelete: () => void;
  nodes: Node<StepData>[];
  edges: Edge[];
  availableTools?: ToolInfo[];
  memoryBlocks: MemoryBlockInput[];
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(
    normalizeConfig(node.data.action, node.data.config)
  );
  const [stepId, setStepId] = useState(node.data.stepId);
  const [showSuggestions, setShowSuggestions] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [expandedMcpServers, setExpandedMcpServers] = useState<Set<string>>(new Set());

  const upstreamSteps = useMemo(() => getUpstreamSteps(node.id, nodes, edges), [node.id, nodes, edges]);

  // Get trigger type from nodes for variable suggestions
  const triggerType = useMemo(() => {
    const triggerNode = nodes.find(n => n.type === 'trigger');
    return triggerNode?.data?.action;
  }, [nodes]);

  useEffect(() => {
    setConfig(normalizeConfig(node.data.action, node.data.config));
    setStepId(node.data.stepId);
  }, [node.id, node.data.action, node.data.config, node.data.stepId]);

  const handleFieldChange = (name: string, value: unknown) => {
    const newConfig = { ...config, [name]: value };
    setConfig(newConfig);
    onUpdate(newConfig);
  };

  const handleInputChange = (fieldName: string, e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    const pos = e.target.selectionStart ?? 0;

    // Check if we're inside {{ ... }}
    const beforeCursor = value.substring(0, pos);
    const openBrace = beforeCursor.lastIndexOf('{{');
    const closeBrace = beforeCursor.lastIndexOf('}}');

    if (openBrace > closeBrace) {
      setShowSuggestions(fieldName);
      setFilterText(beforeCursor.substring(openBrace + 2).trim());
    } else {
      setShowSuggestions(null);
      setFilterText('');
    }

    handleFieldChange(fieldName, value);
  };

  const handleSuggestionSelect = (fieldName: string, variable: string, inputRef: HTMLInputElement | HTMLTextAreaElement | null) => {
    const currentValue = String(config[fieldName] ?? '');
    const pos = inputRef?.selectionStart ?? currentValue.length;

    // Find the {{ position to replace from
    const beforeCursor = currentValue.substring(0, pos);
    const openBrace = beforeCursor.lastIndexOf('{{');

    if (openBrace !== -1) {
      const newValue = currentValue.substring(0, openBrace) + '{{ ' + variable + ' }}' + currentValue.substring(pos);
      handleFieldChange(fieldName, newValue);
    }

    setShowSuggestions(null);
    setFilterText('');
  };

  const renderField = (field: FieldDef) => {
    const value = config[field.name] ?? field.default ?? '';
    const compactInputStyle = { fontSize: '12px', padding: '6px 8px' };

    switch (field.type) {
      case 'textarea': {
        return (
          <div style={{ position: 'relative' }}>
            <textarea
              className="input"
              value={String(value)}
              onChange={(e) => handleInputChange(field.name, e)}
              onBlur={() => setTimeout(() => setShowSuggestions(null), 200)}
              placeholder={field.placeholder}
              style={{
                minHeight: '60px',
                fontSize: '12px',
                padding: '6px 8px',
                resize: 'vertical',
              }}
            />
            <VariableSuggestions
              suggestions={upstreamSteps}
              onSelect={(v) => handleSuggestionSelect(field.name, v, null)}
              filterText={filterText}
              visible={showSuggestions === field.name}
              triggerType={triggerType}
              memoryBlocks={memoryBlocks}
            />
          </div>
        );
      }
      case 'number':
        return (
          <input
            type="number"
            className="input"
            value={value as number}
            onChange={(e) => handleFieldChange(field.name, parseInt(e.target.value) || 0)}
            placeholder={field.placeholder}
            style={compactInputStyle}
          />
        );
      case 'select':
        return (
          <select
            className="input"
            value={String(value)}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            style={compactInputStyle}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        );
      case 'multiselect': {
        const selectedValues = Array.isArray(value) ? value : (field.default as string[] ?? []);

        // For tools field in ai.agent, use dynamic tools from API
        const isToolsField = field.name === 'tools' && node.data.action === 'ai.agent';
        const isMemoryField = field.name === 'memory' && node.data.action === 'ai.agent';

        if (isMemoryField) {
          const options = memoryBlocks.map((block) => ({
            value: block.id,
            label: block.description ? `${block.id} — ${block.description}` : block.id,
          })).filter((opt) => opt.value);

          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {options.length > 0 ? options.map((opt) => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '11px', padding: '3px 6px', background: selectedValues.includes(opt.value) ? 'var(--bg-hover)' : 'var(--bg-tertiary)', borderRadius: '4px', border: selectedValues.includes(opt.value) ? '1px solid var(--accent-purple)' : '1px solid var(--border-color)' }}>
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(opt.value)}
                    onChange={(e) => {
                      const newValues = e.target.checked
                        ? [...selectedValues, opt.value]
                        : selectedValues.filter((v: string) => v !== opt.value);
                      handleFieldChange(field.name, newValues);
                    }}
                    style={{ width: '12px', height: '12px' }}
                  />
                  <span>{opt.label}</span>
                </label>
              )) : (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '6px', background: 'var(--bg-tertiary)', borderRadius: '4px' }}>
                  Add a memory block first
                </div>
              )}
            </div>
          );
        }

        const options = isToolsField && availableTools && availableTools.length > 0
          ? availableTools.map(t => ({
              value: t.id,
              label: t.name,
              description: t.description,
              source: t.source,
              server: t.server,
            }))
          : field.options?.map(o => ({ ...o, source: 'builtin', description: '', server: undefined })) ?? [];

        // Group tools by source
        const builtinTools = options.filter(o => o.source === 'builtin');
        const mcpTools = options.filter(o => o.source === 'mcp');

        // Group MCP tools by server
        const mcpByServer: Record<string, typeof mcpTools> = {};
        for (const tool of mcpTools) {
          const server = tool.server || 'unknown';
          if (!mcpByServer[server]) mcpByServer[server] = [];
          mcpByServer[server].push(tool);
        }

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* Built-in tools */}
            {builtinTools.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {builtinTools.map((opt) => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '11px', padding: '3px 6px', background: selectedValues.includes(opt.value) ? 'var(--bg-hover)' : 'var(--bg-tertiary)', borderRadius: '4px', border: selectedValues.includes(opt.value) ? '1px solid var(--accent-purple)' : '1px solid var(--border-color)' }} title={opt.description}>
                    <input
                      type="checkbox"
                      checked={selectedValues.includes(opt.value)}
                      onChange={(e) => {
                        const newValues = e.target.checked
                          ? [...selectedValues, opt.value]
                          : selectedValues.filter((v: string) => v !== opt.value);
                        handleFieldChange(field.name, newValues);
                      }}
                      style={{ width: '12px', height: '12px' }}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            )}

            {/* MCP tools grouped by server - collapsible */}
            {Object.keys(mcpByServer).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {Object.entries(mcpByServer).map(([server, tools]) => {
                  const isExpanded = expandedMcpServers.has(server);
                  const selectedCount = tools.filter(t => selectedValues.includes(t.value)).length;
                  const allSelected = selectedCount === tools.length;

                  return (
                    <div key={server} style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                      {/* Server header - always visible */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 8px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          const newSet = new Set(expandedMcpServers);
                          if (isExpanded) newSet.delete(server);
                          else newSet.add(server);
                          setExpandedMcpServers(newSet);
                        }}
                      >
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        <span style={{ fontSize: '11px', fontWeight: 500, flex: 1 }}>
                          {server}
                        </span>
                        {selectedCount > 0 && (
                          <span style={{ fontSize: '10px', color: 'var(--accent-purple)', background: 'var(--bg-hover)', padding: '1px 5px', borderRadius: '8px' }}>
                            {selectedCount}/{tools.length}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const serverToolIds = tools.map(t => t.value);
                            const newValues = allSelected
                              ? selectedValues.filter((v: string) => !serverToolIds.includes(v))
                              : [...new Set([...selectedValues, ...serverToolIds])];
                            handleFieldChange(field.name, newValues);
                          }}
                          style={{ fontSize: '9px', padding: '2px 6px', background: allSelected ? 'var(--accent-purple)' : 'var(--bg-primary)', color: allSelected ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '3px', cursor: 'pointer' }}
                        >
                          {allSelected ? '✓ All' : 'Add All'}
                        </button>
                      </div>

                      {/* Tools list - only when expanded */}
                      {isExpanded && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', padding: '0 8px 8px 8px' }}>
                          {tools.map((opt) => (
                            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer', fontSize: '10px', padding: '2px 5px', background: selectedValues.includes(opt.value) ? 'var(--bg-hover)' : 'var(--bg-primary)', borderRadius: '3px', border: selectedValues.includes(opt.value) ? '1px solid var(--accent-purple)' : '1px solid var(--border-color)' }} title={opt.description}>
                              <input
                                type="checkbox"
                                checked={selectedValues.includes(opt.value)}
                                onChange={(e) => {
                                  const newValues = e.target.checked
                                    ? [...selectedValues, opt.value]
                                    : selectedValues.filter((v: string) => v !== opt.value);
                                  handleFieldChange(field.name, newValues);
                                }}
                                style={{ width: '10px', height: '10px' }}
                              />
                              <span>{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isToolsField && mcpTools.length === 0 && builtinTools.length === 0 && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '6px', background: 'var(--bg-tertiary)', borderRadius: '4px' }}>
                Enable MCP servers in Settings
              </div>
            )}
          </div>
        );
      }
      case 'boolean':
        return (
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleFieldChange(field.name, e.target.checked)}
              style={{ width: '14px', height: '14px' }}
            />
            <span style={{ fontSize: '12px' }}>{field.label}</span>
          </label>
        );
      case 'schedule': {
        // Schedule field combines preset selection with custom cron expression
        const scheduleValue = value as { preset?: string; expression?: string } | string | undefined;
        let preset = 'daily-9am';
        let expression = '0 9 * * *';

        // Handle both legacy (string expression) and new (object) formats
        if (typeof scheduleValue === 'string') {
          // Legacy format - try to match to a preset
          const matchedPreset = SCHEDULE_PRESETS.find(p => p.expression === scheduleValue);
          if (matchedPreset) {
            preset = matchedPreset.value;
            expression = scheduleValue;
          } else {
            preset = 'custom';
            expression = scheduleValue;
          }
        } else if (scheduleValue && typeof scheduleValue === 'object') {
          preset = scheduleValue.preset ?? 'daily-9am';
          expression = scheduleValue.expression ?? '0 9 * * *';
        }

        const isCustom = preset === 'custom';
        const selectedPreset = SCHEDULE_PRESETS.find(p => p.value === preset);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <select
              className="input"
              value={preset}
              onChange={(e) => {
                const newPreset = e.target.value;
                const presetConfig = SCHEDULE_PRESETS.find(p => p.value === newPreset);
                const newExpression = presetConfig?.expression ?? expression;
                handleFieldChange(field.name, { preset: newPreset, expression: newExpression });
                handleFieldChange('expression', newExpression);
              }}
              style={compactInputStyle}
            >
              {SCHEDULE_PRESETS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {isCustom ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="text"
                  className="input"
                  value={expression}
                  onChange={(e) => {
                    handleFieldChange(field.name, { preset: 'custom', expression: e.target.value });
                    handleFieldChange('expression', e.target.value);
                  }}
                  placeholder="*/5 * * * *"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '4px 8px', flex: 1 }}
                />
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>min hr day mon wkd</span>
              </div>
            ) : (
              <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                {selectedPreset?.expression}
              </div>
            )}
          </div>
        );
      }
      default:
        return (
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="input"
              value={String(value)}
              onChange={(e) => handleInputChange(field.name, e)}
              onBlur={() => setTimeout(() => setShowSuggestions(null), 200)}
              placeholder={field.placeholder}
              style={compactInputStyle}
            />
            <VariableSuggestions
              suggestions={upstreamSteps}
              onSelect={(v) => handleSuggestionSelect(field.name, v, null)}
              filterText={filterText}
              visible={showSuggestions === field.name}
              triggerType={triggerType}
              memoryBlocks={memoryBlocks}
            />
          </div>
        );
    }
  };

  return (
    <div style={{ overflow: 'auto' }}>
      {/* Step Name field - only for steps, not triggers */}
      {node.type === 'step' && (
        <div style={{ marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--accent-purple)',
              whiteSpace: 'nowrap',
            }}>
              Step ID
            </label>
            <input
              type="text"
              className="input"
              value={stepId}
              onChange={(e) => {
                const newId = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
                setStepId(newId);
                onUpdateStepId(newId);
              }}
              placeholder="e.g., fetch-data"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', padding: '4px 8px', flex: 1 }}
            />
            <code style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {'{{ steps.' + stepId + '.* }}'}
            </code>
          </div>
        </div>
      )}

      {schema?.fields && schema.fields.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
          {schema.fields.map((field) => (
            <div key={field.name} style={{ minWidth: 0 }}>
              <label style={{
                fontSize: '11px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                display: 'block',
                marginBottom: '4px'
              }}>
                {field.label}
                {field.required && <span style={{ color: 'var(--accent-red)', marginLeft: '2px' }}>*</span>}
              </label>
              {renderField(field)}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '12px' }}>
          No configuration options for this action.
        </div>
      )}

      <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <details style={{ flex: 1 }}>
          <summary style={{ fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}>
            Raw JSON
          </summary>
          <textarea
            className="input"
            value={JSON.stringify(config, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                setConfig(parsed);
                onUpdate(parsed);
              } catch {
                // Invalid JSON
              }
            }}
            style={{ minHeight: '80px', fontFamily: 'var(--font-mono)', fontSize: '10px', marginTop: '6px' }}
          />
        </details>
        <button className="btn btn-ghost" onClick={onDelete} style={{ color: 'var(--accent-red)', padding: '4px 10px', fontSize: '12px', marginLeft: '12px' }}>
          Delete Node
        </button>
      </div>
    </div>
  );
}

// Node Selector Component
function NodeSelector({
  type,
  onSelect,
  onClose
}: {
  type: 'trigger' | 'step';
  onSelect: (schema: ActionSchema) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const schemas = type === 'trigger' ? TRIGGER_SCHEMAS : ACTION_SCHEMAS;

  const categories = useMemo(() => {
    const cats: Record<string, ActionSchema[]> = {};
    for (const schema of schemas) {
      if (search && !schema.label.toLowerCase().includes(search.toLowerCase()) &&
          !schema.description.toLowerCase().includes(search.toLowerCase())) {
        continue;
      }
      if (!cats[schema.category]) cats[schema.category] = [];
      cats[schema.category].push(schema);
    }
    return cats;
  }, [schemas, search]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ marginBottom: '12px' }}>
            {type === 'trigger' ? '⚡ Select a Trigger' : '➕ Add an Action'}
          </h3>
          <input
            type="text"
            className="input"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          {Object.entries(categories).map(([category, items]) => (
            <div key={category} style={{ marginBottom: '20px' }}>
              <h4 style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '10px',
                paddingBottom: '6px',
                borderBottom: '1px solid var(--border-color)',
              }}>
                {category}
              </h4>
              <div style={{ display: 'grid', gap: '8px' }}>
                {items.map((schema) => (
                  <button
                    key={schema.id}
                    onClick={() => onSelect(schema)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                      padding: '12px 14px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent-purple)';
                      e.currentTarget.style.background = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'var(--bg-secondary)';
                    }}
                  >
                    <IntegrationIcon name={schema.icon} size={24} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '2px', color: '#fff' }}>
                        {schema.label}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {schema.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {Object.keys(categories).length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
              No actions found matching "{search}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper functions
function getSchema(actionId: string, type: 'trigger' | 'step'): ActionSchema | undefined {
  const schemas = type === 'trigger' ? TRIGGER_SCHEMAS : ACTION_SCHEMAS;
  return schemas.find((s) => s.id === actionId);
}

function parseYamlToGraph(yamlStr: string): { nodes: Node<StepData>[]; edges: Edge[]; name: string; memory: MemoryBlockInput[] } {
  const nodes: Node<StepData>[] = [];
  const edges: Edge[] = [];
  let name = 'my-workflow';
  let memory: MemoryBlockInput[] = [];

  try {
    // Use proper YAML parser to handle multiline strings correctly
    const parsed = YAML.parse(yamlStr) as {
      name?: string;
      trigger?: { type?: string; with?: Record<string, unknown> };
      triggers?: { type?: string; with?: Record<string, unknown> };
      memory?: MemoryBlockInput[];
      _ui?: { positions?: Record<string, { x: number; y: number }> };
      steps?: Array<{
        id: string;
        action: string;
        needs?: string[];
        with?: Record<string, unknown>;
      }>;
    };

    if (parsed.name) {
      name = parsed.name;
    }

    if (Array.isArray(parsed.memory)) {
      memory = parsed.memory.map((block) => ({
        ...block,
        sources: Array.isArray(block.sources) ? block.sources : [],
      }));
    }

    // Get saved UI positions if available
    const savedPositions = parsed._ui?.positions ?? {};

    // Handle trigger (supports both 'trigger' and 'triggers' keys)
    const trigger = parsed.trigger || parsed.triggers;
    const triggerType = trigger?.type || '';
    const triggerConfig = trigger?.with || {};

    // Handle steps
    const steps = (parsed.steps || []).map((step) => ({
      id: step.id,
      action: step.action,
      needs: step.needs,
      config: step.with || {},
    }));

    // Horizontal layout: nodes flow left to right
    const Y_CENTER = 200;
    let x = triggerType ? 300 : 50;

    if (triggerType) {
      const schema = getSchema(triggerType, 'trigger');
      const savedPos = savedPositions['trigger-1'];
      nodes.push({
        id: 'trigger-1',
        type: 'trigger',
        position: savedPos ? { x: savedPos.x, y: savedPos.y } : { x: 50, y: Y_CENTER },
        data: {
          label: schema?.label ?? triggerType,
          action: triggerType,
          config: triggerConfig,
          icon: schema?.icon ?? '⚡',
          stepId: 'trigger',
        },
      });
    }

    const stepIdToNodeId: Record<string, string> = {};

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const nodeId = `step-${i + 1}`;
      stepIdToNodeId[step.id] = nodeId;
      const schema = getSchema(step.action, 'step');

      const savedPos = savedPositions[nodeId];
      nodes.push({
        id: nodeId,
        type: 'step',
        position: savedPos ? { x: savedPos.x, y: savedPos.y } : { x, y: Y_CENTER },
        data: {
          label: schema?.label ?? step.action,
          action: step.action,
          config: step.config,
          icon: schema?.icon ?? '⚙️',
          stepId: step.id, // Preserve the original step ID from YAML
        },
      });
      x += 250; // horizontal spacing
    }

    if (triggerType && steps.length > 0) {
      edges.push({
        id: 'e-trigger-step-1',
        source: 'trigger-1',
        target: 'step-1',
        animated: true,
        style: { stroke: 'var(--accent-purple)' },
      });
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.needs) {
        for (const need of step.needs) {
          const sourceNodeId = stepIdToNodeId[need];
          const targetNodeId = stepIdToNodeId[step.id];
          if (sourceNodeId && targetNodeId) {
            edges.push({
              id: `e-${sourceNodeId}-${targetNodeId}`,
              source: sourceNodeId,
              target: targetNodeId,
              animated: true,
              style: { stroke: 'var(--accent-purple)' },
            });
          }
        }
      } else if (i > 0) {
        const prevNodeId = stepIdToNodeId[steps[i - 1].id];
        const currentNodeId = stepIdToNodeId[step.id];
        if (prevNodeId && currentNodeId) {
          edges.push({
            id: `e-${prevNodeId}-${currentNodeId}`,
            source: prevNodeId,
            target: currentNodeId,
            animated: true,
            style: { stroke: 'var(--accent-purple)' },
          });
        }
      }
    }
  } catch (err) {
    console.error('Failed to parse YAML:', err);
  }

  return { nodes, edges, name, memory };
}

function escapeYamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function indentLines(value: string, indent: number): string {
  return value.split('\n').map((line) => `${' '.repeat(indent)}${line}`).join('\n');
}

function formatYamlString(value: string, indent: number): string {
  if (value.includes('\n')) {
    return `|\n${indentLines(value, indent)}`;
  }
  return escapeYamlString(value);
}

function renderMemoryYaml(blocks: MemoryBlockInput[]): string {
  if (!blocks.length) return '';

  let yaml = 'memory:\n';

  for (const block of blocks) {
    if (!block.id) continue;
    yaml += `  - id: ${block.id}\n`;
    if (block.description) {
      yaml += `    description: ${formatYamlString(block.description, 6)}\n`;
    }
    if (block.separator) {
      yaml += `    separator: ${formatYamlString(block.separator, 6)}\n`;
    }
    if (typeof block.maxChars === 'number') {
      yaml += `    maxChars: ${block.maxChars}\n`;
    }
    if (typeof block.dedupe === 'boolean') {
      yaml += `    dedupe: ${block.dedupe}\n`;
    }
    if (block.template) {
      yaml += `    template: ${formatYamlString(block.template, 6)}\n`;
    }

    if (block.sources.length === 0) {
      yaml += '    sources: []\n';
      continue;
    }

    yaml += '    sources:\n';
    for (const source of block.sources) {
      if (!source.type) continue;
      yaml += `      - type: ${source.type}\n`;
      if (source.id) yaml += `        id: ${source.id}\n`;
      if (source.label) yaml += `        label: ${formatYamlString(source.label, 10)}\n`;
      if (typeof source.maxChars === 'number') yaml += `        maxChars: ${source.maxChars}\n`;
      if (source.type === 'text' && source.text) {
        yaml += `        text: ${formatYamlString(source.text, 10)}\n`;
      }
      if (source.type === 'file' && source.path) {
        yaml += `        path: ${formatYamlString(source.path, 10)}\n`;
      }
      if (source.type === 'url' && source.url) {
        yaml += `        url: ${formatYamlString(source.url, 10)}\n`;
      }
      if (source.type === 'web_search' && source.query) {
        yaml += `        query: ${formatYamlString(source.query, 10)}\n`;
        if (typeof source.maxResults === 'number') {
          yaml += `        maxResults: ${source.maxResults}\n`;
        }
      }
      if (source.type === 'step' && source.step) {
        yaml += `        step: ${formatYamlString(source.step, 10)}\n`;
        if (source.path) yaml += `        path: ${formatYamlString(source.path, 10)}\n`;
      }
      if (source.type === 'trigger' && source.path) {
        yaml += `        path: ${formatYamlString(source.path, 10)}\n`;
      }
    }
  }

  return yaml.trimEnd();
}

// Tool info from API
interface ToolInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  server?: string;
}

export function WorkflowBuilder({ onSave, saving, initialYaml, initialName, onBack }: WorkflowBuilderProps) {
  const [name, setName] = useState(initialName ?? 'my-workflow');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node<StepData> | null>(null);
  const [showSelector, setShowSelector] = useState<'trigger' | 'step' | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [hasGeneratedWorkflow, setHasGeneratedWorkflow] = useState(false);
  const [memoryBlocks, setMemoryBlocks] = useState<MemoryBlockInput[]>([]);

  // Dynamic tool list for AI agent
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);

  // Fetch available tools on mount
  useEffect(() => {
    fetch('/api/tools')
      .then(res => res.json())
      .then(data => {
        const tools: ToolInfo[] = [
          ...(data.builtin ?? []),
          ...(data.mcp ?? []),
        ];
        setAvailableTools(tools);
      })
      .catch(err => {
        console.error('Failed to fetch tools:', err);
        // Fallback to builtin tools
        setAvailableTools([
          { id: 'web_search', name: 'Web Search', description: 'Search the web', category: 'builtin', source: 'builtin' },
          { id: 'web_fetch', name: 'Web Fetch', description: 'Fetch URL content', category: 'builtin', source: 'builtin' },
          { id: 'shell', name: 'Shell Commands', description: 'Execute shell commands', category: 'builtin', source: 'builtin' },
        ]);
      });
  }, []);

  useEffect(() => {
    if (initialYaml) {
      const { nodes: parsedNodes, edges: parsedEdges, name: parsedName, memory: parsedMemory } = parseYamlToGraph(initialYaml);
      setNodes(parsedNodes);
      setEdges(parsedEdges);
      setName(parsedName);
      setMemoryBlocks(parsedMemory);
    }
  }, [initialYaml, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: 'var(--accent-purple)' } }, eds)),
    [setEdges]
  );

  const addNode = useCallback((schema: ActionSchema, type: 'trigger' | 'step') => {
    const id = `${type}-${Date.now()}`;
    const existingTriggers = nodes.filter(n => n.type === 'trigger');
    const existingSteps = nodes.filter(n => n.type === 'step');

    // Horizontal layout: position nodes left to right
    const Y_CENTER = 200;
    const xOffset = type === 'trigger'
      ? 50
      : (existingTriggers.length > 0 ? 300 : 50) + existingSteps.length * 250;

    // Generate a meaningful default step ID based on the action
    const baseStepId = schema.id.split('.').pop() ?? schema.id;
    const existingIds = nodes.map(n => n.data.stepId).filter(Boolean);
    let stepId = baseStepId;
    let counter = 1;
    while (existingIds.includes(stepId)) {
      stepId = `${baseStepId}-${counter}`;
      counter++;
    }

    // Build default config from schema
    const defaultConfig: Record<string, unknown> = {};
    for (const field of schema.fields) {
      if (field.default !== undefined) {
        defaultConfig[field.name] = field.default;
      }
    }

    const newNode: Node<StepData> = {
      id,
      type,
      position: { x: xOffset, y: Y_CENTER },
      data: {
        label: schema.label,
        action: schema.id,
        config: defaultConfig,
        icon: schema.icon,
        stepId: type === 'trigger' ? 'trigger' : stepId,
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setShowSelector(null);

    // Auto-select the new node
    setTimeout(() => setSelectedNode(newNode), 50);
  }, [nodes, setNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  const updateNodeConfig = useCallback((nodeId: string, config: Record<string, unknown>) => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, config } } : n
    ));
  }, [setNodes]);

  const updateNodeStepId = useCallback((nodeId: string, stepId: string) => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, stepId } } : n
    ));
  }, [setNodes]);

  const addMemoryBlock = useCallback(() => {
    setMemoryBlocks((blocks) => [
      ...blocks,
      {
        id: `memory-${blocks.length + 1}`,
        sources: [{ id: 'source_1', type: 'text', text: '' }],
      },
    ]);
  }, []);

  const updateMemoryBlock = useCallback((index: number, patch: Partial<MemoryBlockInput>) => {
    setMemoryBlocks((blocks) => blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  }, []);

  const removeMemoryBlock = useCallback((index: number) => {
    setMemoryBlocks((blocks) => blocks.filter((_, i) => i !== index));
  }, []);

  const addMemorySource = useCallback((blockIndex: number) => {
    setMemoryBlocks((blocks) => blocks.map((block, i) => {
      if (i !== blockIndex) return block;
      const nextIndex = block.sources.length + 1;
      return {
        ...block,
        sources: [...block.sources, { id: `source_${nextIndex}`, type: 'text', text: '' }],
      };
    }));
  }, []);

  const updateMemorySource = useCallback((blockIndex: number, sourceIndex: number, patch: Partial<MemorySourceInput>) => {
    setMemoryBlocks((blocks) => blocks.map((block, i) => {
      if (i !== blockIndex) return block;
      const sources = block.sources.map((source, sIdx) => (sIdx === sourceIndex ? { ...source, ...patch } : source));
      return { ...block, sources };
    }));
  }, []);

  const removeMemorySource = useCallback((blockIndex: number, sourceIndex: number) => {
    setMemoryBlocks((blocks) => blocks.map((block, i) => {
      if (i !== blockIndex) return block;
      return { ...block, sources: block.sources.filter((_, sIdx) => sIdx !== sourceIndex) };
    }));
  }, []);

  const generateYaml = useCallback(() => {
    const triggers = nodes.filter((n) => n.type === 'trigger');
    const steps = nodes.filter((n) => n.type === 'step');

    let yaml = `name: ${name}\n\n`;
    const memoryYaml = renderMemoryYaml(memoryBlocks);
    if (memoryYaml) {
      yaml += `${memoryYaml}\n\n`;
    }

    if (triggers.length > 0) {
      yaml += 'trigger:\n';
      const t = triggers[0];
      yaml += `  type: ${t.data.action}\n`;
      if (Object.keys(t.data.config).length > 0) {
        yaml += '  with:\n';
        for (const [key, value] of Object.entries(t.data.config)) {
          // Skip internal UI fields like 'schedule' (we use 'expression' for output)
          if (key === 'schedule') continue;
          if (value !== '' && value !== undefined && value !== null) {
            // Handle different value types
            if (Array.isArray(value)) {
              // Arrays (e.g., events: [opened, closed])
              yaml += `    ${key}: [${value.join(', ')}]\n`;
            } else if (typeof value === 'string') {
              yaml += `    ${key}: "${value}"\n`;
            } else if (typeof value === 'object') {
              // Skip non-array objects (like the schedule field)
              continue;
            } else {
              yaml += `    ${key}: ${value}\n`;
            }
          }
        }
      }
      yaml += '\n';
    }

    if (steps.length > 0) {
      yaml += 'steps:\n';

      // Build deps using node IDs, then map to step IDs for output
      const deps: Record<string, string[]> = {};
      for (const edge of edges) {
        if (!deps[edge.target]) deps[edge.target] = [];
        const sourceNode = nodes.find(n => n.id === edge.source);
        if (sourceNode && sourceNode.type === 'step') {
          deps[edge.target].push(sourceNode.data.stepId);
        }
      }

      for (const step of steps) {
        const stepId = step.data.stepId || step.id;
        yaml += `  - id: ${stepId}\n`;
        yaml += `    action: ${step.data.action}\n`;

        if (deps[step.id]?.length > 0) {
          yaml += `    needs: [${deps[step.id].join(', ')}]\n`;
        }

        const configEntries = Object.entries(step.data.config).filter(([, v]) => v !== '' && v !== undefined);
        if (configEntries.length > 0) {
          yaml += '    with:\n';
          for (const [key, value] of configEntries) {
            if (Array.isArray(value)) {
              yaml += `      ${key}: [${value.join(', ')}]\n`;
            } else if (typeof value === 'string') {
              yaml += `      ${key}: "${value}"\n`;
            } else {
              yaml += `      ${key}: ${value}\n`;
            }
          }
        }
      }
    }

    // Add UI metadata for node positions (persists when workflow is saved)
    if (nodes.length > 0) {
      yaml += '\n# UI metadata (positions persist when you drag nodes)\n';
      yaml += '_ui:\n  positions:\n';
      for (const node of nodes) {
        yaml += `    ${node.id}: { x: ${Math.round(node.position.x)}, y: ${Math.round(node.position.y)} }\n`;
      }
    }

    return yaml;
  }, [name, nodes, edges, memoryBlocks]);

  // Handle workflow generation from AIChat component
  const handleAIGenerateWorkflow = useCallback((yaml: string, messages: ChatMessage[], sessionId: string | null) => {
    try {
      const { nodes: parsedNodes, edges: parsedEdges, name: parsedName, memory: parsedMemory } = parseYamlToGraph(yaml);
      setNodes(parsedNodes);
      setEdges(parsedEdges);
      setName(parsedName);
      setMemoryBlocks(parsedMemory);
      // Store chat history and keep sidebar open
      setChatMessages(messages);
      setChatSessionId(sessionId);
      setHasGeneratedWorkflow(true);
      // Don't close the chat - it will switch to sidebar mode
    } catch (err) {
      console.error('Failed to parse workflow:', err);
    }
  }, [setNodes, setEdges]);

  const handleSave = useCallback(() => {
    const yaml = generateYaml();
    onSave?.(yaml, name);
  }, [generateYaml, onSave, name]);

  const selectedNodeSchema = useMemo(() => {
    if (!selectedNode) return undefined;
    return getSchema(selectedNode.data.action, selectedNode.type as 'trigger' | 'step');
  }, [selectedNode]);

  const hasTrigger = nodes.some(n => n.type === 'trigger');

  // Layout state
  const [nodeLibraryCollapsed, setNodeLibraryCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<'canvas' | 'memory' | 'yaml'>('canvas');

  // Legacy state kept for compatibility (no longer used directly)
  const [activeContextTab, setActiveContextTab] = useState<ContextPanelTab>('properties');

  // Handle YAML changes from the editor
  const handleYamlChange = useCallback((yaml: string) => {
    try {
      const { nodes: parsedNodes, edges: parsedEdges, name: parsedName, memory: parsedMemory } = parseYamlToGraph(yaml);
      setNodes(parsedNodes);
      setEdges(parsedEdges);
      setName(parsedName);
      setMemoryBlocks(parsedMemory);
    } catch (err) {
      console.error('Failed to parse YAML:', err);
    }
  }, [setNodes, setEdges]);

  // Handle drag and drop from NodeLibrary
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;

    try {
      const { type, schema } = JSON.parse(data);
      addNode(schema, type);
    } catch {
      // Invalid data
    }
  }, [addNode]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Handle workflow generated from AI
  const handleWorkflowFromAI = useCallback((yaml: string) => {
    handleYamlChange(yaml);
  }, [handleYamlChange]);

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      {/* Header with view mode tabs */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        {onBack && (
          <button className="btn btn-ghost" onClick={onBack} style={{ padding: '8px 12px' }}>
            ← Back
          </button>
        )}
        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ fontWeight: 600, fontSize: '16px', width: '200px' }}
        />

        {/* View mode tabs */}
        <div style={{
          display: 'flex',
          gap: '2px',
          background: 'var(--bg-primary)',
          padding: '4px',
          borderRadius: '8px',
          marginLeft: '16px',
        }}>
          <button
            className={viewMode === 'canvas' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setViewMode('canvas')}
            style={{ padding: '6px 14px', fontSize: '13px' }}
          >
            Canvas
          </button>
          <button
            className={viewMode === 'memory' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setViewMode('memory')}
            style={{ padding: '6px 14px', fontSize: '13px' }}
          >
            Memory
          </button>
          <button
            className={viewMode === 'yaml' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setViewMode('yaml')}
            style={{ padding: '6px 14px', fontSize: '13px' }}
          >
            YAML
          </button>
        </div>

        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Workflow'}
        </button>
      </div>

      {/* Main content area */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left Panel - Node Library (collapsed by default) */}
        {viewMode === 'canvas' && (
          <NodeLibrary
            actionSchemas={ACTION_SCHEMAS}
            triggerSchemas={TRIGGER_SCHEMAS}
            onSelectAction={(schema) => addNode(schema, 'step')}
            onSelectTrigger={(schema) => addNode(schema, 'trigger')}
            hasTrigger={hasTrigger}
            collapsed={nodeLibraryCollapsed}
            onToggleCollapsed={() => setNodeLibraryCollapsed(!nodeLibraryCollapsed)}
          />
        )}

        {/* Center Panel - Content based on view mode */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Canvas view */}
          {viewMode === 'canvas' && (
            <div style={{ flex: 1, position: 'relative' }} onDrop={handleDrop} onDragOver={handleDragOver}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => setSelectedNode(node as Node<StepData>)}
                onPaneClick={() => setSelectedNode(null)}
                nodeTypes={nodeTypes}
                fitView
                style={{ background: 'var(--bg-primary)' }}
              >
                <Controls style={{ background: 'var(--bg-secondary)', borderRadius: '8px' }} />
                <Background color="var(--border-color)" gap={20} />
              </ReactFlow>

              {/* Empty state */}
              {nodes.length === 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}
                >
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>🧵</div>
                  <div style={{ fontSize: '18px', fontWeight: 500, marginBottom: '8px' }}>
                    Start building your workflow
                  </div>
                  <div style={{ fontSize: '14px', marginBottom: '8px' }}>
                    Expand the node library on the left or use the AI assistant
                  </div>
                </div>
              )}

              {/* Add buttons when canvas has content */}
              {nodes.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '16px',
                    left: '16px',
                    display: 'flex',
                    gap: '8px',
                    zIndex: 10,
                  }}
                >
                  {!hasTrigger && (
                    <button className="btn btn-secondary" onClick={() => setShowSelector('trigger')}>
                      ⚡ Add Trigger
                    </button>
                  )}
                  <button className="btn btn-secondary" onClick={() => setShowSelector('step')}>
                    ➕ Add Action
                  </button>
                </div>
              )}

              {/* Bottom properties drawer when node selected */}
              {selectedNode && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    maxHeight: '40%',
                    background: 'var(--bg-secondary)',
                    borderTop: '1px solid var(--border-color)',
                    overflow: 'auto',
                    zIndex: 20,
                    boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 12px',
                    borderBottom: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IntegrationIcon name={selectedNode.data.icon} size={16} />
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>{selectedNode.data.label}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{selectedNode.data.action}</span>
                    </div>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setSelectedNode(null)}
                      style={{ padding: '2px 8px', fontSize: '14px' }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <PropertyEditor
                      node={selectedNode}
                      schema={selectedNodeSchema}
                      onUpdate={(config) => updateNodeConfig(selectedNode.id, config)}
                      onUpdateStepId={(stepId) => updateNodeStepId(selectedNode.id, stepId)}
                      onDelete={() => deleteNode(selectedNode.id)}
                      nodes={nodes}
                      edges={edges}
                      availableTools={availableTools}
                      memoryBlocks={memoryBlocks}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Memory view */}
          {viewMode === 'memory' && (
            <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
              {/* Memory Block Documentation */}
              <div style={{
                padding: '16px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                marginBottom: '20px',
                border: '1px solid var(--border-color)',
              }}>
                <h3 style={{ marginBottom: '8px', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📚</span> Memory Blocks
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.5 }}>
                  Memory blocks let you assemble context from multiple sources (files, URLs, search results,
                  previous step outputs) and inject them into AI agent prompts.
                </p>

                <details style={{ fontSize: '13px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--accent-purple)' }}>
                    How to use memory blocks
                  </summary>
                  <div style={{ padding: '12px 0', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    <ol style={{ margin: 0, paddingLeft: '20px' }}>
                      <li style={{ marginBottom: '8px' }}><strong>Create a block</strong> — Give it an ID like "project-docs"</li>
                      <li style={{ marginBottom: '8px' }}><strong>Add sources</strong> — Files, URLs, text, web search, or step outputs</li>
                      <li style={{ marginBottom: '8px' }}><strong>Reference in prompts</strong> — Use <code style={{ background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: '4px', color: 'var(--accent-purple)' }}>{'{{ memory.blocks.project-docs }}'}</code></li>
                      <li><strong>Or attach to AI agent</strong> — Select the block in the agent's "Memory" field</li>
                    </ol>

                    <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '6px' }}>
                      <strong style={{ display: 'block', marginBottom: '8px' }}>Source Types:</strong>
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: '12px' }}>
                        <span>📝 Text</span><span style={{ color: 'var(--text-muted)' }}>Inline text or instructions you write directly</span>
                        <span>📄 File</span><span style={{ color: 'var(--text-muted)' }}>Contents of a local file</span>
                        <span>🌐 URL</span><span style={{ color: 'var(--text-muted)' }}>Fetch and extract content from a web page</span>
                        <span>🔍 Web Search</span><span style={{ color: 'var(--text-muted)' }}>Search the web and include top results</span>
                        <span>⚡ Step Output</span><span style={{ color: 'var(--text-muted)' }}>Output from a previous workflow step</span>
                        <span>🎯 Trigger Data</span><span style={{ color: 'var(--text-muted)' }}>Data from the workflow trigger</span>
                      </div>
                    </div>
                  </div>
                </details>
              </div>

              <MemoryBlockEditor
                blocks={memoryBlocks}
                onAddBlock={addMemoryBlock}
                onUpdateBlock={updateMemoryBlock}
                onRemoveBlock={removeMemoryBlock}
                onAddSource={addMemorySource}
                onUpdateSource={updateMemorySource}
                onRemoveSource={removeMemorySource}
              />
            </div>
          )}

          {/* YAML view */}
          {viewMode === 'yaml' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <YAMLEditor
                value={generateYaml()}
                onChange={handleYamlChange}
              />
            </div>
          )}
        </div>

        {/* Right Panel - AI Chat (always visible) */}
        <div
          style={{
            width: '360px',
            borderLeft: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-secondary)',
          }}
        >
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            fontWeight: 600,
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span>✨</span> AI Assistant
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <AIChatPanel
              messages={chatMessages}
              setMessages={setChatMessages}
              sessionId={chatSessionId}
              setSessionId={setChatSessionId}
              onWorkflowGenerated={handleWorkflowFromAI}
            />
          </div>
        </div>
      </div>

      {/* Node Selector Modal (for buttons, not drag) */}
      {showSelector && (
        <NodeSelector
          type={showSelector}
          onSelect={(schema) => addNode(schema, showSelector)}
          onClose={() => setShowSelector(null)}
        />
      )}

      {/* AI Chat Modal (for initial generation before any workflow exists) */}
      {showAI && (
        <AIChat
          onClose={() => setShowAI(false)}
          onGenerateWorkflow={handleAIGenerateWorkflow}
          mode="modal"
          initialMessages={chatMessages}
          initialSessionId={chatSessionId}
        />
      )}
    </div>
  );
}
