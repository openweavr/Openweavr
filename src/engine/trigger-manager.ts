import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PluginRegistry } from '../plugins/sdk/registry.js';
import type { Workflow } from '../types/index.js';
import { parser } from './parser.js';

export interface TriggerSubscription {
  workflowName: string;
  triggerType: string;
  config: Record<string, unknown>;
  cleanup: () => void;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
}

export interface TriggerManagerEvents {
  onWorkflowTriggered?: (workflowName: string, runId: string) => void;
  onWorkflowCompleted?: (workflowName: string, runId: string, status: 'success' | 'failed') => void;
  onExecuteWorkflow?: (workflow: Workflow, triggerData: unknown, runId: string) => Promise<void>;
}

// Track connection status by service type
export type ServiceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export class TriggerManager {
  private subscriptions = new Map<string, TriggerSubscription>();
  private registry: PluginRegistry;
  private workflowsDir: string;
  private events: TriggerManagerEvents;
  private serviceStatus = new Map<string, { status: ServiceStatus; error?: string }>();

  constructor(registry: PluginRegistry, workflowsDir: string, events: TriggerManagerEvents = {}) {
    this.registry = registry;
    this.workflowsDir = workflowsDir;
    this.events = events;
  }

  /**
   * Set up a trigger for a workflow
   */
  async setupTrigger(
    workflowName: string,
    triggerType: string,
    config: Record<string, unknown>,
    yamlContent: string
  ): Promise<boolean> {
    const trigger = this.registry.getTrigger(triggerType);
    if (!trigger?.setup) {
      console.log(`[trigger-manager] No setup function for trigger: ${triggerType}`);
      return false;
    }

    // Get the service name (e.g., 'slack' from 'slack.message')
    const serviceName = triggerType.split('.')[0];

    // Update service status to connecting
    this.serviceStatus.set(serviceName, { status: 'connecting' });

    // Create emit function that will be called when trigger fires
    const emit = async (data: unknown) => {
      // Apply filters
      if (!this.matchesFilters(config, data)) {
        return;
      }

      // Execute the workflow
      await this.executeWorkflow(workflowName, yamlContent, {
        type: triggerType,
        ...data as Record<string, unknown>,
      });
    };

    try {
      // Call the trigger's setup function
      const cleanup = await trigger.setup(config, emit);

      // Store the subscription
      this.subscriptions.set(workflowName, {
        workflowName,
        triggerType,
        config,
        cleanup,
        status: 'connected',
      });

      // Update service status
      this.serviceStatus.set(serviceName, { status: 'connected' });

      console.log(`[trigger-manager] Trigger set up: ${workflowName} (${triggerType})`);
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[trigger-manager] Failed to setup trigger ${triggerType}:`, errorMsg);

      // Store failed subscription for status tracking
      this.subscriptions.set(workflowName, {
        workflowName,
        triggerType,
        config,
        cleanup: () => {},
        status: 'error',
        error: errorMsg,
      });

      // Update service status
      this.serviceStatus.set(serviceName, { status: 'error', error: errorMsg });

      return false;
    }
  }

  /**
   * Stop a trigger for a workflow
   */
  stopTrigger(workflowName: string): boolean {
    const subscription = this.subscriptions.get(workflowName);
    if (!subscription) {
      return false;
    }

    try {
      subscription.cleanup();
    } catch (err) {
      console.error(`[trigger-manager] Error during cleanup for ${workflowName}:`, err);
    }

    this.subscriptions.delete(workflowName);
    console.log(`[trigger-manager] Trigger stopped: ${workflowName}`);

    // Check if any other workflows use this service
    const serviceName = subscription.triggerType.split('.')[0];
    const hasOtherSubscriptions = Array.from(this.subscriptions.values()).some(
      sub => sub.triggerType.startsWith(serviceName + '.')
    );

    if (!hasOtherSubscriptions) {
      this.serviceStatus.set(serviceName, { status: 'disconnected' });
    }

    return true;
  }

  /**
   * Stop all triggers
   */
  stopAll(): void {
    for (const [name] of this.subscriptions) {
      this.stopTrigger(name);
    }
    this.serviceStatus.clear();
    console.log('[trigger-manager] All triggers stopped');
  }

  /**
   * Get all active subscriptions
   */
  getSubscriptions(): TriggerSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Get connection status for all services
   */
  getConnectionStatus(): Map<string, { status: ServiceStatus; error?: string; workflowCount: number }> {
    const result = new Map<string, { status: ServiceStatus; error?: string; workflowCount: number }>();

    // Collect all services and their workflow counts
    for (const sub of this.subscriptions.values()) {
      const serviceName = sub.triggerType.split('.')[0];
      const existing = result.get(serviceName);
      const serviceInfo = this.serviceStatus.get(serviceName) ?? { status: 'disconnected' as ServiceStatus };

      result.set(serviceName, {
        status: serviceInfo.status,
        error: serviceInfo.error,
        workflowCount: (existing?.workflowCount ?? 0) + 1,
      });
    }

    return result;
  }

  /**
   * Update service status (called by plugins)
   */
  updateServiceStatus(serviceName: string, status: ServiceStatus, error?: string): void {
    this.serviceStatus.set(serviceName, { status, error });

    // Update all subscriptions for this service
    for (const sub of this.subscriptions.values()) {
      if (sub.triggerType.startsWith(serviceName + '.')) {
        sub.status = status;
        sub.error = error;
      }
    }
  }

  /**
   * Check if trigger data matches configured filters
   */
  private matchesFilters(config: Record<string, unknown>, data: unknown): boolean {
    const triggerData = data as Record<string, unknown>;

    // Channel filter (Slack, Discord)
    if (config.channel !== undefined) {
      const dataChannel = triggerData.channel ?? triggerData.channelId;
      if (dataChannel !== config.channel) {
        // Also check channel name with # prefix
        if (typeof config.channel === 'string' && config.channel.startsWith('#')) {
          const channelName = config.channel.slice(1);
          if (dataChannel !== channelName && triggerData.channelName !== channelName) {
            return false;
          }
        } else {
          return false;
        }
      }
    }

    // Channel ID filter (Discord specific)
    if (config.channelId !== undefined && triggerData.channelId !== config.channelId) {
      return false;
    }

    // Chat ID filter (Telegram)
    if (config.chatId !== undefined) {
      const dataChatId = (triggerData.chat as { id?: unknown })?.id ?? triggerData.chatId;
      if (String(dataChatId) !== String(config.chatId)) {
        return false;
      }
    }

    // Pattern filter (regex match on text)
    if (config.pattern !== undefined && typeof config.pattern === 'string') {
      const text = triggerData.text as string | undefined;
      if (!text) return false;

      try {
        const regex = new RegExp(config.pattern);
        if (!regex.test(text)) {
          return false;
        }
      } catch {
        console.error(`[trigger-manager] Invalid pattern regex: ${config.pattern}`);
        return false;
      }
    }

    // Ignore bot messages
    if (config.ignoreBot === true) {
      if (triggerData.isBot === true || triggerData.botId !== undefined) {
        return false;
      }
    }

    // User filter
    if (config.user !== undefined) {
      const dataUser = triggerData.user ?? triggerData.userId ?? triggerData.from;
      if (dataUser !== config.user) {
        return false;
      }
    }

    return true;
  }

  /**
   * Execute a workflow when triggered
   */
  private async executeWorkflow(
    workflowName: string,
    yamlContent: string,
    triggerData: unknown
  ): Promise<void> {
    const runId = randomUUID();
    console.log(`[trigger-manager] Triggering workflow: ${workflowName} (run: ${runId})`);

    this.events.onWorkflowTriggered?.(workflowName, runId);

    try {
      const workflow = parser.parse(yamlContent);

      if (this.events.onExecuteWorkflow) {
        await this.events.onExecuteWorkflow(workflow, triggerData, runId);
      } else {
        console.warn(`[trigger-manager] No executor configured for workflow: ${workflowName}`);
      }
    } catch (err) {
      console.error(`[trigger-manager] Execution failed for ${workflowName}:`, err);
      this.events.onWorkflowCompleted?.(workflowName, runId, 'failed');
    }
  }

  /**
   * Load workflow content from file
   */
  async loadWorkflowContent(workflowName: string): Promise<string | null> {
    try {
      const filePath = join(this.workflowsDir, `${workflowName}.yaml`);
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
