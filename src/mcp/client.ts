/**
 * MCP (Model Context Protocol) Client Implementation
 *
 * Connects to local MCP servers via stdio (stdin/stdout) for tool execution.
 * This enables the AI agent to use tools provided by MCP servers without API keys.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { createInterface, Interface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type {
  MCPServerConfig,
  MCPTool,
  MCPToolResult,
  MCPInitializeResult,
  MCPListToolsResult,
  JsonRpcRequest,
  JsonRpcResponse,
  IMCPClient,
  IMCPManager,
  WeavrConfig,
} from './types.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'weavr-agent', version: '1.0.0' };

/**
 * MCP Client - Connects to a single MCP server via stdio
 */
export class MCPClient implements IMCPClient {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private serverInfo: { name: string; version: string } | null = null;
  private connected = false;
  private logFn: ((msg: string) => void) | undefined;

  constructor(logFn?: (msg: string) => void) {
    this.logFn = logFn;
  }

  private log(msg: string): void {
    this.logFn?.(`[MCP] ${msg}`);
  }

  async connect(config: MCPServerConfig): Promise<void> {
    if (this.connected) {
      throw new Error('Already connected to an MCP server');
    }

    const timeout = config.timeout ?? 30000;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.cleanup();
        reject(new Error(`MCP connection timeout after ${timeout}ms`));
      }, timeout);

      try {
        // Substitute environment variables in args (e.g., ${HOME}, $HOME)
        const substitutedArgs = config.args.map(arg => {
          return arg.replace(/\$\{(\w+)\}/g, (_, varName) => {
            return process.env[varName] ?? '';
          }).replace(/\$(\w+)/g, (_, varName) => {
            return process.env[varName] ?? '';
          });
        });

        this.log(`Starting MCP server: ${config.command} ${substitutedArgs.join(' ')}`);

        // Spawn the MCP server process
        this.process = spawn(config.command, substitutedArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...config.env },
          cwd: config.cwd,
        });

        // Handle process errors
        this.process.on('error', (err) => {
          clearTimeout(timeoutId);
          this.cleanup();
          reject(new Error(`Failed to start MCP server: ${err.message}`));
        });

        this.process.on('exit', (code, signal) => {
          this.log(`MCP server exited (code: ${code}, signal: ${signal})`);
          this.cleanup();
        });

        // Handle stderr for debugging
        this.process.stderr?.on('data', (data) => {
          const stderr = data.toString().trim();
          if (stderr) {
            this.log(`MCP stderr: ${stderr}`);
          }
        });

        // Set up JSON-RPC message handling on stdout
        this.readline = createInterface({
          input: this.process.stdout!,
          crlfDelay: Infinity,
        });

        this.readline.on('line', (line) => {
          this.handleMessage(line);
        });

        // Initialize the connection
        this.initialize()
          .then((result) => {
            clearTimeout(timeoutId);
            this.serverInfo = result.serverInfo;
            this.connected = true;
            this.log(`Connected to MCP server: ${result.serverInfo.name} v${result.serverInfo.version}`);
            resolve();
          })
          .catch((err) => {
            clearTimeout(timeoutId);
            this.cleanup();
            reject(err);
          });
      } catch (err) {
        clearTimeout(timeoutId);
        this.cleanup();
        reject(err);
      }
    });
  }

  private async initialize(): Promise<MCPInitializeResult> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        roots: { listChanged: true },
      },
      clientInfo: CLIENT_INFO,
    }) as MCPInitializeResult;

    // Send initialized notification
    this.sendNotification('notifications/initialized', {});

    return result;
  }

  private handleMessage(line: string): void {
    if (!line.trim()) return;

    try {
      const message = JSON.parse(line) as JsonRpcResponse;

      // Check if this is a response to a pending request
      if ('id' in message && message.id !== undefined) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);

          if (message.error) {
            pending.reject(new Error(`MCP error: ${message.error.message} (code: ${message.error.code})`));
          } else {
            pending.resolve(message.result);
          }
        }
      }
      // Notifications and other messages are ignored for now
    } catch {
      // Ignore non-JSON lines (could be debug output from server)
    }
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('MCP server not connected'));
        return;
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const message = JSON.stringify(request) + '\n';
      this.process.stdin.write(message);
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;

    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.process.stdin.write(JSON.stringify(notification) + '\n');
  }

  isConnected(): boolean {
    return this.connected;
  }

  getServerInfo(): { name: string; version: string } | null {
    return this.serverInfo;
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.connected) {
      throw new Error('Not connected to MCP server');
    }

    const result = await this.sendRequest('tools/list', {}) as MCPListToolsResult;
    return result.tools ?? [];
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<MCPToolResult> {
    if (!this.connected) {
      throw new Error('Not connected to MCP server');
    }

    this.log(`Calling MCP tool: ${name}`);

    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args ?? {},
    }) as MCPToolResult;

    return result;
  }

  async disconnect(): Promise<void> {
    this.cleanup();
    this.log('Disconnected from MCP server');
  }

  private cleanup(): void {
    this.connected = false;

    // Clear all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    // Close readline
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    // Kill the process
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

/**
 * MCP Manager - Manages multiple MCP server connections
 */
export class MCPManager implements IMCPManager {
  private servers = new Map<string, MCPClient>();
  private toolToServer = new Map<string, string>();
  private logFn: ((msg: string) => void) | undefined;

  constructor(logFn?: (msg: string) => void) {
    this.logFn = logFn;
  }

  private log(msg: string): void {
    this.logFn?.(`[MCPManager] ${msg}`);
  }

  async loadFromConfig(configPath?: string): Promise<void> {
    const path = configPath ?? join(homedir(), '.weavr', 'config.yaml');

    if (!existsSync(path)) {
      this.log(`Config file not found: ${path}`);
      return;
    }

    try {
      const content = readFileSync(path, 'utf-8');
      const config = parseYaml(content) as WeavrConfig;

      if (!config.mcp?.servers) {
        this.log('No MCP servers configured');
        return;
      }

      const serverConfigs = config.mcp.servers;
      this.log(`Found ${Object.keys(serverConfigs).length} MCP server(s) in config`);

      // Connect to each server
      for (const [name, serverConfig] of Object.entries(serverConfigs)) {
        try {
          await this.connectServer(name, serverConfig);
        } catch (err) {
          this.log(`Failed to connect to MCP server '${name}': ${err}`);
          // Continue with other servers
        }
      }
    } catch (err) {
      this.log(`Failed to load config: ${err}`);
    }
  }

  async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    if (this.servers.has(name)) {
      this.log(`Server '${name}' already connected`);
      return;
    }

    const client = new MCPClient(this.logFn);
    await client.connect(config);
    this.servers.set(name, client);

    // Index the tools
    const tools = await client.listTools();
    for (const tool of tools) {
      this.toolToServer.set(tool.name, name);
      this.log(`Registered tool '${tool.name}' from server '${name}'`);
    }
  }

  getServers(): Map<string, IMCPClient> {
    return this.servers;
  }

  async getAllTools(): Promise<Array<MCPTool & { server: string }>> {
    const allTools: Array<MCPTool & { server: string }> = [];

    for (const [serverName, client] of this.servers) {
      if (!client.isConnected()) continue;

      try {
        const tools = await client.listTools();
        for (const tool of tools) {
          allTools.push({ ...tool, server: serverName });
        }
      } catch {
        // Skip failed servers
      }
    }

    return allTools;
  }

  async callTool(toolName: string, args?: Record<string, unknown>): Promise<MCPToolResult> {
    const serverName = this.toolToServer.get(toolName);
    if (!serverName) {
      return {
        content: [{ type: 'text', text: `Unknown MCP tool: ${toolName}` }],
        isError: true,
      };
    }

    const client = this.servers.get(serverName);
    if (!client?.isConnected()) {
      return {
        content: [{ type: 'text', text: `MCP server '${serverName}' not connected` }],
        isError: true,
      };
    }

    return client.callTool(toolName, args);
  }

  async disconnectServer(name: string): Promise<void> {
    const client = this.servers.get(name);
    if (!client) {
      this.log(`Server '${name}' not found`);
      return;
    }

    try {
      await client.disconnect();
    } catch (err) {
      this.log(`Error disconnecting '${name}': ${err}`);
    }

    this.servers.delete(name);

    // Remove tools for this server
    for (const [toolName, serverName] of this.toolToServer) {
      if (serverName === name) {
        this.toolToServer.delete(toolName);
      }
    }

    this.log(`Disconnected server '${name}'`);
  }

  isServerConnected(name: string): boolean {
    const client = this.servers.get(name);
    return client?.isConnected() ?? false;
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.keys()).filter(name => this.servers.get(name)?.isConnected());
  }

  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.servers) {
      try {
        await client.disconnect();
      } catch (err) {
        this.log(`Error disconnecting '${name}': ${err}`);
      }
    }
    this.servers.clear();
    this.toolToServer.clear();
  }
}

/**
 * Create a singleton MCP manager for use across the application
 */
let globalManager: MCPManager | null = null;

export function getMCPManager(logFn?: (msg: string) => void): MCPManager {
  if (!globalManager) {
    globalManager = new MCPManager(logFn);
  }
  return globalManager;
}

export async function initializeMCP(logFn?: (msg: string) => void): Promise<MCPManager> {
  const manager = getMCPManager(logFn);
  await manager.loadFromConfig();
  return manager;
}
