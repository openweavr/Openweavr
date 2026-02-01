/**
 * MCP (Model Context Protocol) Type Definitions
 * Based on the MCP specification for tool-use between AI agents and local servers
 */

// JSON-RPC 2.0 base types
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// MCP Server Configuration
export interface MCPServerConfig {
  /** Command to run (e.g., "npx", "node", "python") */
  command: string;
  /** Arguments for the command (e.g., ["-y", "web-search-mcp"]) */
  args: string[];
  /** Optional environment variables */
  env?: Record<string, string>;
  /** Optional working directory */
  cwd?: string;
  /** Connection timeout in ms (default: 30000) */
  timeout?: number;
}

// MCP Tool types
export interface MCPToolInputSchema {
  type: 'object';
  properties?: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
  }>;
  required?: string[];
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: MCPToolInputSchema;
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

// MCP Protocol messages
export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: {
    roots?: { listChanged?: boolean };
    sampling?: Record<string, unknown>;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

export interface MCPListToolsResult {
  tools: MCPTool[];
}

export interface MCPCallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

// MCP Client interface
export interface IMCPClient {
  /** Connect to an MCP server */
  connect(config: MCPServerConfig): Promise<void>;
  /** Check if connected */
  isConnected(): boolean;
  /** List available tools from the server */
  listTools(): Promise<MCPTool[]>;
  /** Call a tool on the server */
  callTool(name: string, args?: Record<string, unknown>): Promise<MCPToolResult>;
  /** Disconnect from the server */
  disconnect(): Promise<void>;
  /** Get server info */
  getServerInfo(): { name: string; version: string } | null;
}

// MCP Manager interface for managing multiple servers
export interface IMCPManager {
  /** Load and connect to servers from config */
  loadFromConfig(configPath?: string): Promise<void>;
  /** Get all connected servers */
  getServers(): Map<string, IMCPClient>;
  /** Get all available tools across all servers */
  getAllTools(): Promise<Array<MCPTool & { server: string }>>;
  /** Call a tool by name (routes to correct server) */
  callTool(toolName: string, args?: Record<string, unknown>): Promise<MCPToolResult>;
  /** Disconnect all servers */
  disconnectAll(): Promise<void>;
}

// Config file structure
export interface WeavrConfig {
  ai?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    useCLI?: boolean;
    cliProvider?: 'claude' | 'ollama' | 'llm' | 'auto';
    cliModel?: string;
  };
  mcp?: {
    servers?: Record<string, MCPServerConfig>;
  };
}
