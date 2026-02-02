import { parse as parseYaml } from 'yaml';
import { WorkflowSchema, type Workflow } from '../types/index.js';

export class WorkflowParser {
  parse(content: string): Workflow {
    const raw = parseYaml(content);

    // Transform YAML-friendly keys to schema keys
    const transformed = this.transform(raw);

    return WorkflowSchema.parse(transformed);
  }

  private transform(raw: Record<string, unknown>): Record<string, unknown> {
    const result = { ...raw };

    // Transform 'with' -> 'config' in steps
    if (Array.isArray(raw.steps)) {
      result.steps = raw.steps.map((step: Record<string, unknown>) => {
        const s = { ...step };
        // Convert 'with' to 'config'
        if ('with' in s) {
          s.config = s.with;
          delete s.with;
        }
        // Convert 'needs' to 'depends_on'
        if ('needs' in s) {
          s.depends_on = s.needs;
          delete s.needs;
        }
        return s;
      });
    }

    // Transform trigger
    if (raw.trigger && typeof raw.trigger === 'object') {
      const trigger = raw.trigger as Record<string, unknown>;
      if ('with' in trigger) {
        result.triggers = [{
          type: trigger.type,
          config: trigger.with,
        }];
      } else {
        result.triggers = [{
          type: trigger.type,
          config: trigger.config,
        }];
      }
      delete result.trigger;
    }

    return result;
  }

  validate(workflow: unknown): { valid: boolean; errors?: string[] } {
    const result = WorkflowSchema.safeParse(workflow);

    if (result.success) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: result.error.errors.map(
        (e) => `${e.path.join('.')}: ${e.message}`
      ),
    };
  }

  stringify(workflow: Workflow): string {
    const { stringify } = require('yaml');
    return stringify(workflow);
  }
}

export const parser = new WorkflowParser();

// Named export for convenience
export const parseWorkflow = parser.parse.bind(parser);
