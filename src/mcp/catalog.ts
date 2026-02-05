/**
 * MCP Server Catalog
 *
 * A curated catalog of popular MCP (Model Context Protocol) servers
 * that users can easily enable from the UI.
 */

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeout?: number;
}

export interface MCPServerEntry {
  id: string;
  name: string;
  description: string;
  category: 'filesystem' | 'git' | 'database' | 'browser' | 'search' | 'cloud' | 'productivity' | 'dev-tools' | 'other';
  package: string;  // npm package or command
  configTemplate: MCPServerConfig;
  requiredEnv?: string[];  // Environment variables that must be set
  setupUrl?: string;
  official?: boolean;  // Whether this is an official/reference server
  tools?: string[];  // Example tools this server provides
}

/**
 * Curated catalog of MCP servers
 */
export const MCP_SERVER_CATALOG: MCPServerEntry[] = [
  // ============================================================================
  // Official Reference Servers
  // ============================================================================
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Secure file operations with configurable access controls',
    category: 'filesystem',
    package: '@modelcontextprotocol/server-filesystem',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${HOME}'],
    },
    official: true,
    tools: ['read_file', 'write_file', 'list_directory', 'create_directory', 'move_file', 'search_files'],
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Knowledge graph-based persistent memory system for context retention',
    category: 'productivity',
    package: '@modelcontextprotocol/server-memory',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    official: true,
    tools: ['create_entities', 'create_relations', 'search_nodes', 'open_nodes'],
  },
  {
    id: 'time',
    name: 'Time',
    description: 'Time and timezone conversion capabilities',
    category: 'productivity',
    package: '@modelcontextprotocol/server-time',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-time'],
    },
    official: true,
    tools: ['get_current_time', 'convert_timezone'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Dynamic problem-solving through thought sequences',
    category: 'productivity',
    package: '@modelcontextprotocol/server-sequential-thinking',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
    official: true,
    tools: ['think_step', 'get_thoughts', 'clear_thoughts'],
  },

  // ============================================================================
  // Git & Version Control
  // ============================================================================
  {
    id: 'git',
    name: 'Git',
    description: 'Git repository operations - commits, branches, diffs, logs',
    category: 'git',
    package: 'mcp-server-git',
    configTemplate: {
      command: 'uvx',
      args: ['mcp-server-git'],
    },
    official: true,
    tools: ['git_status', 'git_log', 'git_diff', 'git_commit', 'git_branch', 'git_checkout'],
    setupUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub API - repos, issues, PRs, actions',
    category: 'git',
    package: 'ghcr.io/github/github-mcp-server',
    configTemplate: {
      command: 'docker',
      args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' },
    },
    requiredEnv: ['GITHUB_TOKEN'],
    setupUrl: 'https://github.com/github/github-mcp-server',
    tools: ['list_repos', 'get_repo', 'list_issues', 'create_issue', 'list_prs', 'get_pr'],
  },

  // ============================================================================
  // Databases
  // ============================================================================
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'SQLite database operations - query, insert, update',
    category: 'database',
    package: '@pollinations/mcp-server-sqlite',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@pollinations/mcp-server-sqlite', '${DATABASE_PATH:-./data.db}'],
    },
    tools: ['query', 'execute', 'list_tables', 'describe_table'],
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'PostgreSQL database operations',
    category: 'database',
    package: '@modelcontextprotocol/server-postgres',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', '${DATABASE_URL}'],
    },
    requiredEnv: ['DATABASE_URL'],
    tools: ['query', 'list_tables', 'describe_table'],
  },

  // ============================================================================
  // Browser Automation
  // ============================================================================
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Browser automation using Playwright - click, type, screenshot',
    category: 'browser',
    package: '@playwright/mcp',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
    },
    setupUrl: 'https://github.com/microsoft/playwright-mcp',
    tools: ['navigate', 'click', 'type', 'screenshot', 'get_text', 'wait_for_selector'],
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation with Puppeteer',
    category: 'browser',
    package: '@modelcontextprotocol/server-puppeteer',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
    official: true,
    tools: ['navigate', 'screenshot', 'click', 'fill', 'evaluate'],
  },

  // ============================================================================
  // Search & Web
  // ============================================================================
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search using Brave Search API',
    category: 'search',
    package: '@modelcontextprotocol/server-brave-search',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '${BRAVE_API_KEY}' },
    },
    requiredEnv: ['BRAVE_API_KEY'],
    setupUrl: 'https://brave.com/search/api/',
    tools: ['web_search', 'local_search'],
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Web content fetching and conversion for LLM usage',
    category: 'search',
    package: 'mcp-server-fetch',
    configTemplate: {
      command: 'uvx',
      args: ['mcp-server-fetch'],
    },
    official: true,
    tools: ['fetch', 'fetch_raw'],
  },

  // ============================================================================
  // Cloud & Infrastructure
  // ============================================================================
  {
    id: 'aws',
    name: 'AWS',
    description: 'AWS service integration - S3, Lambda, EC2, etc.',
    category: 'cloud',
    package: '@awslabs/mcp-server-aws',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@awslabs/mcp-server-aws'],
    },
    requiredEnv: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    setupUrl: 'https://github.com/awslabs/mcp',
    tools: ['s3_list', 's3_get', 's3_put', 'lambda_invoke'],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Cloudflare Workers and services',
    category: 'cloud',
    package: '@cloudflare/mcp-server-cloudflare',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@cloudflare/mcp-server-cloudflare'],
      env: { CLOUDFLARE_API_TOKEN: '${CLOUDFLARE_API_TOKEN}' },
    },
    requiredEnv: ['CLOUDFLARE_API_TOKEN'],
    setupUrl: 'https://github.com/cloudflare/mcp-server-cloudflare',
    tools: ['list_workers', 'deploy_worker', 'list_kv_namespaces'],
  },

  // ============================================================================
  // Development Tools
  // ============================================================================
  {
    id: 'docker',
    name: 'Docker',
    description: 'Docker container management',
    category: 'dev-tools',
    package: '@modelcontextprotocol/server-docker',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-docker'],
    },
    tools: ['list_containers', 'start_container', 'stop_container', 'container_logs'],
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    description: 'Kubernetes cluster management',
    category: 'dev-tools',
    package: 'mcp-server-kubernetes',
    configTemplate: {
      command: 'npx',
      args: ['-y', 'mcp-server-kubernetes'],
    },
    tools: ['list_pods', 'get_pod', 'list_deployments', 'scale_deployment'],
  },

  // ============================================================================
  // Productivity
  // ============================================================================
  {
    id: 'slack',
    name: 'Slack',
    description: 'Slack workspace integration - messages, channels, users',
    category: 'productivity',
    package: '@modelcontextprotocol/server-slack',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}' },
    },
    requiredEnv: ['SLACK_BOT_TOKEN'],
    official: true,
    tools: ['list_channels', 'post_message', 'get_channel_history'],
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Google Drive file operations',
    category: 'productivity',
    package: '@modelcontextprotocol/server-gdrive',
    configTemplate: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gdrive'],
    },
    official: true,
    tools: ['list_files', 'read_file', 'search_files'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Notion workspace integration',
    category: 'productivity',
    package: 'mcp-server-notion',
    configTemplate: {
      command: 'npx',
      args: ['-y', 'mcp-server-notion'],
      env: { NOTION_API_KEY: '${NOTION_API_KEY}' },
    },
    requiredEnv: ['NOTION_API_KEY'],
    tools: ['search', 'get_page', 'create_page', 'update_page'],
  },
];

/**
 * Get servers by category
 */
export function getServersByCategory(category: MCPServerEntry['category']): MCPServerEntry[] {
  return MCP_SERVER_CATALOG.filter((s) => s.category === category);
}

/**
 * Get all unique categories
 */
export function getCategories(): MCPServerEntry['category'][] {
  return [...new Set(MCP_SERVER_CATALOG.map((s) => s.category))];
}

/**
 * Get a server by ID
 */
export function getServerById(id: string): MCPServerEntry | undefined {
  return MCP_SERVER_CATALOG.find((s) => s.id === id);
}

/**
 * Check if a server has all required environment variables set
 */
export function hasRequiredEnv(server: MCPServerEntry): boolean {
  if (!server.requiredEnv || server.requiredEnv.length === 0) {
    return true;
  }
  return server.requiredEnv.every((envVar) => !!process.env[envVar]);
}

/**
 * Generate config for a server, substituting environment variables
 */
export function generateServerConfig(server: MCPServerEntry): MCPServerConfig {
  const config = { ...server.configTemplate };

  // Substitute ${VAR} patterns in args
  config.args = config.args.map((arg) =>
    arg.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, varName, defaultValue) => {
      return process.env[varName] ?? defaultValue ?? '';
    })
  );

  // Substitute in env vars
  if (config.env) {
    config.env = Object.fromEntries(
      Object.entries(config.env).map(([key, value]) => [
        key,
        value.replace(/\$\{(\w+)\}/g, (_, varName) => process.env[varName] ?? ''),
      ])
    );
  }

  return config;
}
