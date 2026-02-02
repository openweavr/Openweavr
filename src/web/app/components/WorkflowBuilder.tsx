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
import { AIChat, ChatMessage } from './AIChat';
import YAML from 'yaml';

interface WorkflowBuilderProps {
  onSave?: (yaml: string, name: string) => void;
  saving?: boolean;
  initialYaml?: string | null;
  onBack?: () => void;
}

interface StepData {
  label: string;
  action: string;
  config: Record<string, unknown>;
  icon: string;
  stepId: string; // The user-visible step name/ID used in YAML and templates
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
    icon: '🌐',
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
    icon: '🌐',
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
    icon: '🌐',
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
    icon: '💬',
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
    icon: '🎮',
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
    icon: '🐙',
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
    icon: '🐙',
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
    icon: '🤖',
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
    icon: '🤖',
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
    icon: '🧠',
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
    icon: '📧',
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
    icon: '📊',
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
    icon: '📊',
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
    icon: '🔄',
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
    icon: '📄',
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
    icon: '📝',
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
    icon: '📁',
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
    icon: '🗑️',
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
    icon: '💻',
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
    icon: '📜',
    category: 'Local',
    fields: [
      { name: 'script', label: 'Script', type: 'textarea', placeholder: '#!/bin/bash\necho "Hello"', required: true },
      { name: 'interpreter', label: 'Interpreter', type: 'select', options: [
        { value: 'bash', label: 'Bash' },
        { value: 'sh', label: 'Shell' },
        { value: 'python3', label: 'Python' },
        { value: 'node', label: 'Node.js' },
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
    icon: '🔔',
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
    icon: '📋',
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
    icon: '📋',
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
    icon: '✈️',
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
    icon: '💬',
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
    icon: '💬',
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
    icon: '🔗',
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
    icon: '⏰',
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
    icon: '🐙',
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
    icon: '🐙',
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
    icon: '🐙',
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
    icon: '📁',
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
    icon: '✈️',
    category: 'Messaging',
    fields: [
      { name: 'path', label: 'Webhook Path', type: 'text', placeholder: '/telegram', required: true },
    ],
  },
  {
    id: 'whatsapp.message',
    label: 'WhatsApp Message',
    description: 'Trigger on incoming WhatsApp messages',
    icon: '💬',
    category: 'Messaging',
    fields: [],
  },
];

// Custom node component for workflow steps
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
      <Handle type="target" position={Position.Top} style={{ background: 'var(--accent-blue)' }} />
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
        <span style={{ fontSize: '20px' }}>{data.icon}</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>{data.label}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{data.action}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--accent-green)' }} />
    </div>
  );
}

// Custom trigger node
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
        <span style={{ fontSize: '20px' }}>{data.icon}</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>{data.label}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{data.action}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--accent-yellow)' }} />
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

// Variable Suggestions Dropdown
function VariableSuggestions({
  suggestions,
  onSelect,
  filterText,
  visible,
}: {
  suggestions: Array<{ stepId: string; actionId: string; outputFields: OutputField[] }>;
  onSelect: (variable: string) => void;
  filterText: string;
  visible: boolean;
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

    // Add trigger variables
    vars.push({ path: 'trigger.data', description: 'Trigger payload', category: 'trigger' });

    return vars;
  }, [suggestions]);

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

// Property Editor Component
function PropertyEditor({
  node,
  schema,
  onUpdate,
  onUpdateStepId,
  onDelete,
  nodes,
  edges,
}: {
  node: Node<StepData>;
  schema: ActionSchema | undefined;
  onUpdate: (config: Record<string, unknown>) => void;
  onUpdateStepId: (stepId: string) => void;
  onDelete: () => void;
  nodes: Node<StepData>[];
  edges: Edge[];
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(
    normalizeConfig(node.data.action, node.data.config)
  );
  const [stepId, setStepId] = useState(node.data.stepId);
  const [showSuggestions, setShowSuggestions] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  const upstreamSteps = useMemo(() => getUpstreamSteps(node.id, nodes, edges), [node.id, nodes, edges]);

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

    switch (field.type) {
      case 'textarea':
        return (
          <div style={{ position: 'relative' }}>
            <textarea
              className="input"
              value={String(value)}
              onChange={(e) => handleInputChange(field.name, e)}
              onBlur={() => setTimeout(() => setShowSuggestions(null), 200)}
              placeholder={field.placeholder}
              style={{ minHeight: '80px', fontSize: '13px' }}
            />
            <VariableSuggestions
              suggestions={upstreamSteps}
              onSelect={(v) => handleSuggestionSelect(field.name, v, null)}
              filterText={filterText}
              visible={showSuggestions === field.name}
            />
          </div>
        );
      case 'number':
        return (
          <input
            type="number"
            className="input"
            value={value as number}
            onChange={(e) => handleFieldChange(field.name, parseInt(e.target.value) || 0)}
            placeholder={field.placeholder}
          />
        );
      case 'select':
        return (
          <select
            className="input"
            value={String(value)}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        );
      case 'multiselect': {
        const selectedValues = Array.isArray(value) ? value : (field.default as string[] ?? []);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {field.options?.map((opt) => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedValues.includes(opt.value)}
                  onChange={(e) => {
                    const newValues = e.target.checked
                      ? [...selectedValues, opt.value]
                      : selectedValues.filter((v: string) => v !== opt.value);
                    handleFieldChange(field.name, newValues);
                  }}
                />
                <span style={{ fontSize: '13px' }}>{opt.label}</span>
              </label>
            ))}
          </div>
        );
      }
      case 'boolean':
        return (
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleFieldChange(field.name, e.target.checked)}
            />
            <span style={{ fontSize: '13px' }}>{field.label}</span>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <select
              className="input"
              value={preset}
              onChange={(e) => {
                const newPreset = e.target.value;
                const presetConfig = SCHEDULE_PRESETS.find(p => p.value === newPreset);
                const newExpression = presetConfig?.expression ?? expression;
                // Store expression directly for backend compatibility
                handleFieldChange(field.name, { preset: newPreset, expression: newExpression });
                // Also update the expression field directly for backward compatibility
                handleFieldChange('expression', newExpression);
              }}
            >
              {SCHEDULE_PRESETS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {isCustom ? (
              <div>
                <label style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  display: 'block',
                  marginBottom: '6px'
                }}>
                  Cron Expression
                </label>
                <input
                  type="text"
                  className="input"
                  value={expression}
                  onChange={(e) => {
                    handleFieldChange(field.name, { preset: 'custom', expression: e.target.value });
                    handleFieldChange('expression', e.target.value);
                  }}
                  placeholder="*/5 * * * *"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                />
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  Format: minute hour day month weekday
                </div>
              </div>
            ) : (
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                background: 'var(--bg-primary)',
                padding: '8px 12px',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
              }}>
                <span style={{ color: 'var(--text-muted)' }}>Cron: </span>
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
            />
            <VariableSuggestions
              suggestions={upstreamSteps}
              onSelect={(v) => handleSuggestionSelect(field.name, v, null)}
              filterText={filterText}
              visible={showSuggestions === field.name}
            />
          </div>
        );
    }
  };

  return (
    <div className="card" style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '24px' }}>{node.data.icon}</span>
          <div>
            <h3 style={{ fontSize: '15px', margin: 0, color: '#fff' }}>{node.data.label}</h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{node.data.action}</div>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={onDelete} style={{ color: 'var(--accent-red)', padding: '6px 10px' }}>
          Delete
        </button>
      </div>

      {/* Step Name field - only for steps, not triggers */}
      {node.type === 'step' && (
        <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
          <label style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--accent-purple)',
            display: 'block',
            marginBottom: '6px'
          }}>
            Step Name <span style={{ color: 'var(--accent-red)' }}>*</span>
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
            placeholder="e.g., fetch-data, send-notification"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}
          />
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {schema?.outputFields && schema.outputFields.length > 0 ? (
              <>
                Available outputs:{' '}
                {schema.outputFields.slice(0, 3).map((f, i) => (
                  <span key={f.name}>
                    {i > 0 && ', '}
                    <code style={{ color: 'var(--accent-purple)' }}>{'{{ steps.' + stepId + '.' + f.name + ' }}'}</code>
                  </span>
                ))}
                {schema.outputFields.length > 3 && <span style={{ color: 'var(--text-muted)' }}> +{schema.outputFields.length - 3} more</span>}
              </>
            ) : (
              <>Use this name to reference this step: <code style={{ color: 'var(--accent-purple)' }}>{'{{ steps.' + stepId + '.data }}'}</code></>
            )}
          </div>
        </div>
      )}

      {schema?.fields && schema.fields.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {schema.fields.map((field) => (
            <div key={field.name}>
              <label style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                display: 'block',
                marginBottom: '6px'
              }}>
                {field.label}
                {field.required && <span style={{ color: 'var(--accent-red)', marginLeft: '4px' }}>*</span>}
              </label>
              {renderField(field)}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
          No configuration options for this action.
        </div>
      )}

      <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
        <details>
          <summary style={{ fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '8px' }}>
            Advanced: Raw JSON
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
            style={{ minHeight: '100px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
          />
        </details>
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
                    <span style={{ fontSize: '24px', lineHeight: 1 }}>{schema.icon}</span>
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

function parseYamlToGraph(yamlStr: string): { nodes: Node<StepData>[]; edges: Edge[]; name: string } {
  const nodes: Node<StepData>[] = [];
  const edges: Edge[] = [];
  let name = 'my-workflow';

  try {
    // Use proper YAML parser to handle multiline strings correctly
    const parsed = YAML.parse(yamlStr) as {
      name?: string;
      trigger?: { type?: string; with?: Record<string, unknown> };
      triggers?: { type?: string; with?: Record<string, unknown> };
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

    if (triggerType) {
      const schema = getSchema(triggerType, 'trigger');
      nodes.push({
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 250, y: 50 },
        data: {
          label: schema?.label ?? triggerType,
          action: triggerType,
          config: triggerConfig,
          icon: schema?.icon ?? '⚡',
          stepId: 'trigger',
        },
      });
    }

    let y = triggerType ? 180 : 50;
    const stepIdToNodeId: Record<string, string> = {};

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const nodeId = `step-${i + 1}`;
      stepIdToNodeId[step.id] = nodeId;
      const schema = getSchema(step.action, 'step');

      nodes.push({
        id: nodeId,
        type: 'step',
        position: { x: 250, y },
        data: {
          label: schema?.label ?? step.action,
          action: step.action,
          config: step.config,
          icon: schema?.icon ?? '⚙️',
          stepId: step.id, // Preserve the original step ID from YAML
        },
      });
      y += 130;
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

  return { nodes, edges, name };
}

export function WorkflowBuilder({ onSave, saving, initialYaml, onBack }: WorkflowBuilderProps) {
  const [name, setName] = useState('my-workflow');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node<StepData> | null>(null);
  const [showSelector, setShowSelector] = useState<'trigger' | 'step' | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [hasGeneratedWorkflow, setHasGeneratedWorkflow] = useState(false);

  useEffect(() => {
    if (initialYaml) {
      const { nodes: parsedNodes, edges: parsedEdges, name: parsedName } = parseYamlToGraph(initialYaml);
      setNodes(parsedNodes);
      setEdges(parsedEdges);
      setName(parsedName);
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

    const yOffset = type === 'trigger' ? 50 : (existingTriggers.length > 0 ? 180 : 50) + existingSteps.length * 130;

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
      position: { x: 250, y: yOffset },
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

  const generateYaml = useCallback(() => {
    const triggers = nodes.filter((n) => n.type === 'trigger');
    const steps = nodes.filter((n) => n.type === 'step');

    let yaml = `name: ${name}\n\n`;

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

    return yaml;
  }, [name, nodes, edges]);

  // Handle workflow generation from AIChat component
  const handleAIGenerateWorkflow = useCallback((yaml: string, messages: ChatMessage[], sessionId: string | null) => {
    try {
      const { nodes: parsedNodes, edges: parsedEdges, name: parsedName } = parseYamlToGraph(yaml);
      setNodes(parsedNodes);
      setEdges(parsedEdges);
      setName(parsedName);
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

  return (
    <div style={{ display: 'flex', height: '100%', gap: '16px' }}>
      {/* Left Panel - Canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Header */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
          <button className="btn btn-secondary" onClick={() => setShowAI(true)}>
            ✨ Generate with AI
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={() => setShowYaml(!showYaml)}>
            {showYaml ? 'Hide' : 'Show'} YAML
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Workflow'}
          </button>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative' }}>
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
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              color: 'var(--text-muted)',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🧵</div>
              <div style={{ fontSize: '18px', fontWeight: 500, marginBottom: '8px' }}>
                Start building your workflow
              </div>
              <div style={{ fontSize: '14px', marginBottom: '24px' }}>
                Add a trigger to start, then add actions
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={() => setShowSelector('trigger')}>
                  ⚡ Add Trigger
                </button>
                <button className="btn btn-secondary" onClick={() => setShowAI(true)}>
                  ✨ Generate with AI
                </button>
              </div>
            </div>
          )}

          {/* Add buttons when canvas has content */}
          {nodes.length > 0 && (
            <div style={{
              position: 'absolute',
              bottom: '16px',
              left: '16px',
              display: 'flex',
              gap: '8px',
              zIndex: 10,
            }}>
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
        </div>
      </div>

      {/* Right Panel - Properties / YAML */}
      <div style={{ width: '340px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {showYaml ? (
          <div className="card" style={{ flex: 1, overflow: 'auto' }}>
            <h3 style={{ fontSize: '14px', marginBottom: '12px' }}>Generated YAML</h3>
            <pre style={{
              background: 'var(--bg-primary)',
              padding: '12px',
              borderRadius: '6px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'pre-wrap',
              overflow: 'auto',
            }}>
              {generateYaml()}
            </pre>
          </div>
        ) : selectedNode ? (
          <PropertyEditor
            node={selectedNode}
            schema={selectedNodeSchema}
            onUpdate={(config) => updateNodeConfig(selectedNode.id, config)}
            onUpdateStepId={(stepId) => updateNodeStepId(selectedNode.id, stepId)}
            onDelete={() => deleteNode(selectedNode.id)}
            nodes={nodes}
            edges={edges}
          />
        ) : (
          <div className="card" style={{ flex: 1 }}>
            <h3 style={{ fontSize: '14px', marginBottom: '16px' }}>Getting Started</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {!hasTrigger && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowSelector('trigger')}
                  style={{ justifyContent: 'flex-start', padding: '12px 16px' }}
                >
                  <span style={{ marginRight: '10px' }}>⚡</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 500 }}>Add a Trigger</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Start your workflow</div>
                  </div>
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => setShowSelector('step')}
                style={{ justifyContent: 'flex-start', padding: '12px 16px' }}
              >
                <span style={{ marginRight: '10px' }}>➕</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 500 }}>Add an Action</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>HTTP, Slack, AI, etc.</div>
                </div>
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setShowAI(true)}
                style={{ justifyContent: 'flex-start', padding: '12px 16px' }}
              >
                <span style={{ marginRight: '10px' }}>✨</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 500 }}>Generate with AI</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Describe what you want</div>
                </div>
              </button>
            </div>

            {nodes.length > 0 && (
              <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Click on a node to edit its properties
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Node Selector Modal */}
      {showSelector && (
        <NodeSelector
          type={showSelector}
          onSelect={(schema) => addNode(schema, showSelector)}
          onClose={() => setShowSelector(null)}
        />
      )}

      {/* AI Chat - Modal (before generation) or Sidebar (after generation) */}
      {(showAI || hasGeneratedWorkflow) && (
        <AIChat
          onClose={() => {
            setShowAI(false);
            if (hasGeneratedWorkflow) {
              // Don't clear chat history when closing sidebar, just hide it
              setHasGeneratedWorkflow(false);
            }
          }}
          onGenerateWorkflow={handleAIGenerateWorkflow}
          mode={hasGeneratedWorkflow ? 'sidebar' : 'modal'}
          initialMessages={chatMessages}
          initialSessionId={chatSessionId}
        />
      )}
    </div>
  );
}
