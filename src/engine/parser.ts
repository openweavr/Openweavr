import { parse as parseYaml } from 'yaml';
import { WorkflowSchema, type Workflow } from '../types/index.js';

export class WorkflowParser {
  parse(content: string): Workflow {
    const raw = parseYaml(content);
    return WorkflowSchema.parse(raw);
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
