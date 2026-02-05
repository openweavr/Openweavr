import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  ActionContext,
  MemoryBlock,
  MemoryContext,
  MemorySource,
  Step,
  StepResult,
  WeavrConfig,
  Workflow,
  WorkflowRun,
} from '../types/index.js';
import type { PluginRegistry } from '../plugins/sdk/registry.js';
import { loadConfig } from '../config/index.js';

// Import AI tracking context functions
let setTrackingContext: ((ctx: { model?: string; workflowName?: string; runId?: string }) => void) | null = null;
let clearTrackingContext: (() => void) | null = null;

// Dynamically import AI module to set tracking context
import('../plugins/builtin/ai/index.js')
  .then((aiModule) => {
    setTrackingContext = aiModule.setTrackingContext;
    clearTrackingContext = aiModule.clearTrackingContext;
  })
  .catch(() => {
    // AI plugin not available, tracking context won't be set
  });

export interface ExecutorOptions {
  registry: PluginRegistry;
  onStepStart?: (runId: string, stepId: string) => void;
  onStepComplete?: (runId: string, stepId: string, result: StepResult) => void;
  onRunComplete?: (run: WorkflowRun) => void;
  onLog?: (runId: string, stepId: string, message: string) => void;
}

export class WorkflowExecutor {
  private runs = new Map<string, WorkflowRun>();
  private memoryCaches = new Map<string, Map<string, string>>();
  private cachedConfig: { value: WeavrConfig; loadedAt: number } | null = null;

  constructor(private options: ExecutorOptions) {}

  async execute(workflow: Workflow, triggerData?: unknown, providedRunId?: string): Promise<WorkflowRun> {
    const runId = providedRunId ?? randomUUID();

    const run: WorkflowRun = {
      id: runId,
      workflowName: workflow.name,
      status: 'running',
      triggerData,
      steps: new Map(),
      startedAt: new Date(),
    };

    this.runs.set(runId, run);
    this.memoryCaches.set(runId, new Map());

    // Set AI tracking context for token usage
    if (setTrackingContext) {
      setTrackingContext({ workflowName: workflow.name, runId });
    }

    // Initialize all steps as pending
    for (const step of workflow.steps) {
      run.steps.set(step.id, {
        id: step.id,
        status: 'pending',
      });
    }

    try {
      // Build dependency graph
      const graph = this.buildDependencyGraph(workflow.steps);

      // Execute steps in topological order
      await this.executeGraph(run, workflow, graph);

      run.status = 'completed';
      run.completedAt = new Date();
    } catch (err) {
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : String(err);
      run.completedAt = new Date();
    } finally {
      // Clear AI tracking context
      if (clearTrackingContext) {
        clearTrackingContext();
      }
      this.memoryCaches.delete(runId);
    }

    this.options.onRunComplete?.(run);
    return run;
  }

  private buildDependencyGraph(steps: Step[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    for (const step of steps) {
      graph.set(step.id, new Set(step.depends_on ?? []));
    }

    return graph;
  }

  private async executeGraph(
    run: WorkflowRun,
    workflow: Workflow,
    graph: Map<string, Set<string>>
  ): Promise<void> {
    const completed = new Set<string>();
    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));

    while (completed.size < workflow.steps.length) {
      // Find steps that are ready to execute
      const ready: Step[] = [];

      for (const [stepId, deps] of graph) {
        if (completed.has(stepId)) continue;

        const allDepsCompleted = [...deps].every((dep) => completed.has(dep));
        if (allDepsCompleted) {
          const step = stepMap.get(stepId);
          if (step) ready.push(step);
        }
      }

      if (ready.length === 0 && completed.size < workflow.steps.length) {
        throw new Error('Circular dependency detected in workflow');
      }

      // Execute ready steps in parallel
      await Promise.all(
        ready.map((step) =>
          this.executeStep(run, workflow, step).then(() => {
            completed.add(step.id);
          })
        )
      );
    }
  }

  private async executeStep(
    run: WorkflowRun,
    workflow: Workflow,
    step: Step
  ): Promise<void> {
    const stepResult = run.steps.get(step.id)!;
    stepResult.status = 'running';
    stepResult.startedAt = new Date();

    this.options.onStepStart?.(run.id, step.id);

    try {
      // Get action from registry
      const action = this.options.registry.getAction(step.action);

      if (!action) {
        // Check if it's a built-in action
        const interpolationCtx = await this.buildInterpolationContext(run, workflow);
        const output = await this.executeBuiltinAction(step, run, workflow, interpolationCtx);
        stepResult.output = output;
        stepResult.status = 'completed';
      } else {
        const interpolationCtx = await this.buildInterpolationContext(run, workflow);
        const memory = (interpolationCtx as { memory?: MemoryContext }).memory ?? { blocks: {}, sources: {} };

        // Interpolate config values
        const interpolatedConfig = this.interpolateConfig(
          (step.config ?? {}) as Record<string, unknown>,
          interpolationCtx
        );

        // Build context for plugin action
        const context: ActionContext = {
          workflowName: workflow.name,
          runId: run.id,
          stepId: step.id,
          config: interpolatedConfig,
          trigger: run.triggerData,
          steps: this.getStepOutputs(run),
          env: workflow.env ?? {},
          memory,
          log: (message: string) => {
            console.log(`[${workflow.name}:${step.id}] ${message}`);
            // Also send to run history via callback
            this.options.onLog?.(run.id, step.id, message);
          },
        };

        // Execute with retry
        const output = await this.executeWithRetry(
          () => action.execute(context),
          step.retry?.attempts ?? 1,
          step.retry?.delay ?? 1000
        );

        stepResult.output = output;
        stepResult.status = 'completed';
      }
    } catch (err) {
      stepResult.status = 'failed';
      stepResult.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      stepResult.completedAt = new Date();
      stepResult.duration =
        stepResult.completedAt.getTime() - (stepResult.startedAt?.getTime() ?? 0);

      this.options.onStepComplete?.(run.id, step.id, stepResult);
    }
  }

  // Build base interpolation context (memory is injected separately)
  private buildBaseInterpolationContext(run: WorkflowRun, workflow: Workflow): Record<string, unknown> {
    const now = new Date();
    return {
      trigger: run.triggerData,
      steps: this.getStepOutputs(run),
      env: workflow.env ?? {},
      // Built-in date/time variables
      currentDate: now.toISOString().split('T')[0], // YYYY-MM-DD
      currentTime: now.toTimeString().split(' ')[0], // HH:MM:SS
      currentTimestamp: now.getTime(), // Unix timestamp in ms
      currentISODate: now.toISOString(), // Full ISO string
    };
  }

  private async buildInterpolationContext(run: WorkflowRun, workflow: Workflow): Promise<Record<string, unknown>> {
    const baseContext = this.buildBaseInterpolationContext(run, workflow);
    const memory = await this.buildMemoryContext(run, workflow, baseContext);
    return { ...baseContext, memory };
  }

  private async buildMemoryContext(
    run: WorkflowRun,
    workflow: Workflow,
    baseContext: Record<string, unknown>
  ): Promise<MemoryContext> {
    const blocks = workflow.memory ?? [];
    if (blocks.length === 0) {
      return { blocks: {}, sources: {} };
    }

    const memoryCache = this.getMemoryCache(run.id);
    const memoryContext: MemoryContext = {
      blocks: {},
      sources: {},
    };

    for (const block of blocks) {
      const sourceValues: Record<string, string> = {};
      const sourceOutputs: string[] = [];

      for (let i = 0; i < block.sources.length; i++) {
        const source = block.sources[i];
        const sourceId = source.id ?? `source_${i + 1}`;
        const cacheKey = `${block.id}:${sourceId}`;
        const value = await this.resolveMemorySource(block, source, baseContext, memoryCache, cacheKey, run.id);
        sourceValues[sourceId] = value;

        if (source.label) {
          sourceOutputs.push(`## ${source.label}\n${value}`);
        } else {
          sourceOutputs.push(value);
        }
      }

      memoryContext.sources[block.id] = sourceValues;

      let blockText = block.template
        ? this.interpolate(block.template, { ...baseContext, sources: sourceValues })
        : sourceOutputs.join(block.separator ?? '\n\n');

      if (block.dedupe) {
        blockText = this.dedupeLines(blockText);
      }

      if (block.maxChars && blockText.length > block.maxChars) {
        blockText = `${blockText.slice(0, block.maxChars)}…`;
      }

      memoryContext.blocks[block.id] = blockText;
    }

    run.memory = memoryContext;
    return memoryContext;
  }

  private async executeBuiltinAction(
    step: Step,
    _run: WorkflowRun,
    workflow: Workflow,
    context: Record<string, unknown>
  ): Promise<unknown> {
    const config = step.config ?? {};
    const ctx = context;

    switch (step.action) {
      case 'transform': {
        const template = config.template as string;
        return this.interpolate(template, ctx);
      }

      case 'log': {
        const message = config.message as string;
        const interpolated = this.interpolate(message, ctx);
        console.log(`[${workflow.name}] ${interpolated}`);
        return { logged: interpolated };
      }

      case 'delay': {
        const ms = config.ms as number;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { delayed: ms };
      }

      case 'condition': {
        const expr = config.if as string;
        const result = this.evaluateCondition(expr, ctx);
        return { result };
      }

      default:
        throw new Error(`Unknown action: ${step.action}`);
    }
  }

  private getStepOutputs(run: WorkflowRun): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const [id, result] of run.steps) {
      if (result.status === 'completed') {
        outputs[id] = result.output;
      }
    }
    return outputs;
  }

  private getMemoryCache(runId: string): Map<string, string> {
    let cache = this.memoryCaches.get(runId);
    if (!cache) {
      cache = new Map<string, string>();
      this.memoryCaches.set(runId, cache);
    }
    return cache;
  }

  private async getConfig(): Promise<WeavrConfig> {
    const now = Date.now();
    if (this.cachedConfig && now - this.cachedConfig.loadedAt < 30000) {
      return this.cachedConfig.value;
    }
    const config = await loadConfig();
    this.cachedConfig = { value: config, loadedAt: now };
    return config;
  }

  private async resolveMemorySource(
    block: MemoryBlock,
    source: MemorySource,
    baseContext: Record<string, unknown>,
    cache: Map<string, string>,
    cacheKey: string,
    runId: string
  ): Promise<string> {
    const cacheable = this.isCacheableMemorySource(source);
    const dynamic = this.hasInterpolationInSource(source);

    if (cacheable && !dynamic && cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? '';
    }

    try {
      let value = '';
      switch (source.type) {
        case 'text': {
          value = this.interpolate(String(source.text), baseContext);
          break;
        }
        case 'file': {
          const path = this.interpolate(String(source.path), baseContext);
          value = readFileSync(path, 'utf-8');
          break;
        }
        case 'url': {
          const url = this.interpolate(String(source.url), baseContext);
          value = await this.fetchUrlContent(url);
          break;
        }
        case 'web_search': {
          const query = this.interpolate(String(source.query), baseContext);
          value = await this.runWebSearch(query, source.maxResults);
          break;
        }
        case 'step': {
          const steps = baseContext.steps as Record<string, unknown> | undefined;
          const stepOutput = steps?.[source.step];
          value = this.resolveMemoryValue(stepOutput, source.path);
          break;
        }
        case 'trigger': {
          const triggerData = baseContext.trigger;
          value = this.resolveMemoryValue(triggerData, source.path);
          break;
        }
        default:
          value = '';
      }

      value = this.normalizeMemoryValue(value);

      if (source.maxChars && value.length > source.maxChars) {
        value = `${value.slice(0, source.maxChars)}…`;
      }

      if (cacheable && !dynamic) {
        cache.set(cacheKey, value);
      }

      return value;
    } catch (err) {
      const message = `[memory:${block.id}] Failed to load ${source.type} source: ${String(err)}`;
      this.options.onLog?.(runId, 'memory', message);
      return message;
    }
  }

  private resolveMemoryValue(data: unknown, path?: string): string {
    if (path && data && typeof data === 'object') {
      const resolved = this.resolvePath(path, data as Record<string, unknown>);
      return this.formatMemoryValue(resolved);
    }
    return this.formatMemoryValue(data);
  }

  private formatMemoryValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private normalizeMemoryValue(value: string): string {
    return value.replace(/\r\n/g, '\n').trim();
  }

  private isCacheableMemorySource(source: MemorySource): boolean {
    return source.type !== 'step' && source.type !== 'trigger';
  }

  private hasInterpolationInSource(source: MemorySource): boolean {
    switch (source.type) {
      case 'text':
        return this.hasInterpolation(source.text);
      case 'file':
        return this.hasInterpolation(source.path);
      case 'url':
        return this.hasInterpolation(source.url);
      case 'web_search':
        return this.hasInterpolation(source.query);
      default:
        return false;
    }
  }

  private hasInterpolation(value?: string): boolean {
    return Boolean(value && value.includes('{{'));
  }

  private dedupeLines(value: string): string {
    const lines = value.split('\n');
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        deduped.push(line);
        continue;
      }
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        deduped.push(line);
      }
    }
    return deduped.join('\n');
  }

  private async fetchUrlContent(url: string): Promise<string> {
    const response = await this.fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Weavr/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    const limited = text.slice(0, 12000);

    if (contentType.includes('text/html')) {
      return this.stripHtml(limited);
    }
    return limited;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async runWebSearch(query: string, maxResults = 5): Promise<string> {
    const config = await this.getConfig();
    const provider = config.webSearch?.provider;
    const configKey = config.webSearch?.apiKey;
    let braveKey = provider === 'brave' ? configKey : process.env.BRAVE_API_KEY;
    let tavilyKey = provider === 'tavily' ? configKey : process.env.TAVILY_API_KEY;

    if (!provider && configKey && !braveKey && !tavilyKey) {
      braveKey = configKey;
    }

    if (braveKey) {
      const response = await this.fetchWithTimeout(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
        {
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': braveKey,
          },
        },
        15000
      );
      if (!response.ok) {
        throw new Error(`Brave search failed: ${response.status} ${response.statusText}`);
      }
      const data = await response.json() as {
        web?: { results?: Array<{ title: string; url: string; description: string }> };
      };
      const results = data.web?.results ?? [];
      if (results.length === 0) return 'No search results found.';
      return results.slice(0, maxResults).map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`
      ).join('\n');
    }

    if (tavilyKey) {
      const response = await this.fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          search_depth: 'basic',
          max_results: maxResults,
        }),
      }, 15000);
      if (!response.ok) {
        throw new Error(`Tavily search failed: ${response.status} ${response.statusText}`);
      }
      const data = await response.json() as {
        results?: Array<{ title: string; url: string; content: string }>;
      };
      const results = data.results ?? [];
      if (results.length === 0) return 'No search results found.';
      return results.slice(0, maxResults).map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content.slice(0, 300)}`
      ).join('\n');
    }

    const fallback = await this.fetchWithTimeout(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
    );
    if (!fallback.ok) {
      throw new Error(`Search failed: ${fallback.status} ${fallback.statusText}`);
    }
    const data = await fallback.json() as { Abstract?: string; RelatedTopics?: Array<{ Text?: string }> };
    const results: string[] = [];
    if (data.Abstract) results.push(`Summary: ${data.Abstract}`);
    if (data.RelatedTopics?.length) {
      for (const topic of data.RelatedTopics.slice(0, maxResults)) {
        if (topic.Text) results.push(`- ${topic.Text}`);
      }
    }
    return results.length > 0 ? results.join('\n') : 'No search results found.';
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private interpolate(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, expr: string) => {
      const value = this.resolvePath(expr.trim(), context);
      return value !== undefined ? String(value) : '';
    });
  }

  private interpolateConfig(
    config: Record<string, unknown>,
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        result[key] = this.interpolate(value, context);
      } else if (Array.isArray(value)) {
        result[key] = value.map((v) =>
          typeof v === 'string' ? this.interpolate(v, context) : v
        );
      } else if (value && typeof value === 'object') {
        result[key] = this.interpolateConfig(value as Record<string, unknown>, context);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private resolvePath(path: string, obj: Record<string, unknown>): unknown {
    // Handle array indexing like "steps.fetch-stories.data[0]"
    const parts = path.split(/\.(?![^\[]*\])/);
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;

      // Check for array index notation like "data[0]"
      const arrayMatch = part.match(/^(.+?)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, key, indexStr] = arrayMatch;
        const index = parseInt(indexStr, 10);
        const arr = (current as Record<string, unknown>)[key];
        if (Array.isArray(arr)) {
          current = arr[index];
        } else {
          return undefined;
        }
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }

    return current;
  }

  private evaluateCondition(expr: string, context: Record<string, unknown>): boolean {
    // Simple expression evaluator for conditions
    const interpolated = this.interpolate(`{{ ${expr} }}`, context);
    return Boolean(interpolated && interpolated !== 'false' && interpolated !== '0');
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    attempts: number,
    delay: number
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
        }
      }
    }

    throw lastError;
  }

  getRun(id: string): WorkflowRun | undefined {
    return this.runs.get(id);
  }

  listRuns(): WorkflowRun[] {
    return Array.from(this.runs.values());
  }
}
