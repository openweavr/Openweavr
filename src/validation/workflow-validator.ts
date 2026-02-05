import { parse as parseYaml } from 'yaml';
import { WorkflowSchema, type Workflow, type Step } from '../types/index.js';

export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  workflow?: Workflow;
}

// Variable reference patterns
const VARIABLE_PATTERN = /\{\{\s*([^}]+)\s*\}\}/g;
const STEP_REFERENCE_PATTERN = /^steps\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\.(.+))?$/;
const TRIGGER_REFERENCE_PATTERN = /^trigger(?:\.(.+))?$/;
const MEMORY_BLOCK_PATTERN = /^memory\.blocks\.([a-zA-Z_][a-zA-Z0-9_-]*)$/;
const MEMORY_SOURCE_PATTERN = /^memory\.sources\.([a-zA-Z_][a-zA-Z0-9_-]*)\.([a-zA-Z_][a-zA-Z0-9_-]*)$/;
const CURRENT_DATE_PATTERN = /^currentDate$/;

/**
 * Validates a workflow YAML string
 */
export function validateWorkflow(
  yamlContent: string,
  availableActions?: string[],
  availableTriggers?: string[]
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Step 1: Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlContent);
  } catch (err) {
    return {
      valid: false,
      errors: [{
        path: '',
        message: `YAML parsing error: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      errors: [{
        path: '',
        message: 'Workflow must be a YAML object',
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // Step 2: Validate against Zod schema
  const result = WorkflowSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        path: issue.path.join('.'),
        message: issue.message,
        severity: 'error',
      });
    }
    return { valid: false, errors, warnings };
  }

  const workflow = result.data;

  // Step 3: Validate action and trigger references
  if (availableTriggers && workflow.triggers) {
    for (let i = 0; i < workflow.triggers.length; i++) {
      const trigger = workflow.triggers[i];
      if (!availableTriggers.includes(trigger.type)) {
        errors.push({
          path: `triggers[${i}].type`,
          message: `Unknown trigger type: "${trigger.type}". Available triggers: ${availableTriggers.slice(0, 5).join(', ')}${availableTriggers.length > 5 ? '...' : ''}`,
          severity: 'error',
        });
      }
    }
  }

  if (availableActions && workflow.steps) {
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      if (!availableActions.includes(step.action)) {
        errors.push({
          path: `steps[${i}].action`,
          message: `Unknown action: "${step.action}". Available actions: ${availableActions.slice(0, 5).join(', ')}${availableActions.length > 5 ? '...' : ''}`,
          severity: 'error',
        });
      }
    }
  }

  // Step 4: Validate variable references
  const stepIds = new Set(workflow.steps.map(s => s.id));
  const memoryBlockIds = new Set((workflow.memory ?? []).map(m => m.id));
  const memorySourceIds = new Map<string, Set<string>>();

  for (const block of workflow.memory ?? []) {
    const sourceIds = new Set<string>();
    for (const source of block.sources) {
      if (source.id) {
        sourceIds.add(source.id);
      }
    }
    memorySourceIds.set(block.id, sourceIds);
  }

  // Check each step for variable references
  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const stepPath = `steps[${i}]`;

    // Get all steps that come before this one
    const precedingStepIds = new Set(workflow.steps.slice(0, i).map(s => s.id));

    // Also add steps that are explicitly listed in depends_on
    const deps = step.depends_on ?? [];
    for (const dep of deps) {
      if (!stepIds.has(dep)) {
        errors.push({
          path: `${stepPath}.depends_on`,
          message: `Step "${step.id}" depends on unknown step "${dep}"`,
          severity: 'error',
        });
      }
    }

    // Validate variable references in config
    if (step.config) {
      validateVariableReferences(
        step.config,
        `${stepPath}.config`,
        precedingStepIds,
        memoryBlockIds,
        memorySourceIds,
        !!(workflow.triggers && workflow.triggers.length > 0),
        errors,
        warnings
      );
    }
  }

  // Step 5: Check for duplicate step IDs
  const seenIds = new Set<string>();
  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    if (seenIds.has(step.id)) {
      errors.push({
        path: `steps[${i}].id`,
        message: `Duplicate step ID: "${step.id}"`,
        severity: 'error',
      });
    }
    seenIds.add(step.id);
  }

  // Step 6: Check for circular dependencies
  const circularDeps = findCircularDependencies(workflow.steps);
  if (circularDeps.length > 0) {
    for (const cycle of circularDeps) {
      errors.push({
        path: 'steps',
        message: `Circular dependency detected: ${cycle.join(' -> ')}`,
        severity: 'error',
      });
    }
  }

  // Step 7: Additional warnings
  if (!workflow.description) {
    warnings.push({
      path: 'description',
      message: 'Workflow has no description',
      severity: 'warning',
    });
  }

  if (workflow.steps.length === 0) {
    warnings.push({
      path: 'steps',
      message: 'Workflow has no steps',
      severity: 'warning',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    workflow: errors.length === 0 ? workflow : undefined,
  };
}

/**
 * Recursively validates variable references in a config object
 */
function validateVariableReferences(
  value: unknown,
  path: string,
  precedingStepIds: Set<string>,
  memoryBlockIds: Set<string>,
  memorySourceIds: Map<string, Set<string>>,
  hasTrigger: boolean,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (typeof value === 'string') {
    // Find all variable references
    let match: RegExpExecArray | null;
    while ((match = VARIABLE_PATTERN.exec(value)) !== null) {
      const varRef = match[1].trim();
      validateSingleReference(
        varRef,
        path,
        precedingStepIds,
        memoryBlockIds,
        memorySourceIds,
        hasTrigger,
        errors,
        warnings
      );
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateVariableReferences(
        value[i],
        `${path}[${i}]`,
        precedingStepIds,
        memoryBlockIds,
        memorySourceIds,
        hasTrigger,
        errors,
        warnings
      );
    }
  } else if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      validateVariableReferences(
        val,
        `${path}.${key}`,
        precedingStepIds,
        memoryBlockIds,
        memorySourceIds,
        hasTrigger,
        errors,
        warnings
      );
    }
  }
}

/**
 * Validates a single variable reference
 */
function validateSingleReference(
  varRef: string,
  path: string,
  precedingStepIds: Set<string>,
  memoryBlockIds: Set<string>,
  memorySourceIds: Map<string, Set<string>>,
  hasTrigger: boolean,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  // Check for step reference
  const stepMatch = STEP_REFERENCE_PATTERN.exec(varRef);
  if (stepMatch) {
    const [, stepId] = stepMatch;
    if (!precedingStepIds.has(stepId)) {
      errors.push({
        path,
        message: `Variable reference "{{ ${varRef} }}" refers to step "${stepId}" which doesn't exist or comes after this step`,
        severity: 'error',
      });
    }
    return;
  }

  // Check for trigger reference
  const triggerMatch = TRIGGER_REFERENCE_PATTERN.exec(varRef);
  if (triggerMatch) {
    if (!hasTrigger) {
      warnings.push({
        path,
        message: `Variable reference "{{ ${varRef} }}" refers to trigger data but no trigger is defined`,
        severity: 'warning',
      });
    }
    return;
  }

  // Check for memory block reference
  const memoryBlockMatch = MEMORY_BLOCK_PATTERN.exec(varRef);
  if (memoryBlockMatch) {
    const [, blockId] = memoryBlockMatch;
    if (!memoryBlockIds.has(blockId)) {
      errors.push({
        path,
        message: `Variable reference "{{ ${varRef} }}" refers to memory block "${blockId}" which doesn't exist`,
        severity: 'error',
      });
    }
    return;
  }

  // Check for memory source reference
  const memorySourceMatch = MEMORY_SOURCE_PATTERN.exec(varRef);
  if (memorySourceMatch) {
    const [, blockId, sourceId] = memorySourceMatch;
    if (!memoryBlockIds.has(blockId)) {
      errors.push({
        path,
        message: `Variable reference "{{ ${varRef} }}" refers to memory block "${blockId}" which doesn't exist`,
        severity: 'error',
      });
    } else {
      const sources = memorySourceIds.get(blockId);
      if (sources && !sources.has(sourceId)) {
        errors.push({
          path,
          message: `Variable reference "{{ ${varRef} }}" refers to source "${sourceId}" which doesn't exist in memory block "${blockId}"`,
          severity: 'error',
        });
      }
    }
    return;
  }

  // Check for currentDate
  if (CURRENT_DATE_PATTERN.test(varRef)) {
    return; // Valid
  }

  // Unknown variable reference format
  warnings.push({
    path,
    message: `Unrecognized variable reference format: "{{ ${varRef} }}"`,
    severity: 'warning',
  });
}

/**
 * Finds circular dependencies in steps
 */
function findCircularDependencies(steps: Step[]): string[][] {
  const cycles: string[][] = [];
  const stepMap = new Map<string, Step>();

  for (const step of steps) {
    stepMap.set(step.id, step);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(stepId: string): boolean {
    visited.add(stepId);
    recursionStack.add(stepId);
    path.push(stepId);

    const step = stepMap.get(stepId);
    if (step?.depends_on) {
      for (const dep of step.depends_on) {
        if (!visited.has(dep)) {
          if (dfs(dep)) {
            return true;
          }
        } else if (recursionStack.has(dep)) {
          // Found a cycle
          const cycleStart = path.indexOf(dep);
          const cycle = [...path.slice(cycleStart), dep];
          cycles.push(cycle);
          return true;
        }
      }
    }

    path.pop();
    recursionStack.delete(stepId);
    return false;
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      dfs(step.id);
    }
  }

  return cycles;
}

/**
 * Quick validation that just checks YAML syntax and basic schema
 */
export function quickValidate(yamlContent: string): { valid: boolean; error?: string } {
  try {
    const parsed = parseYaml(yamlContent);
    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, error: 'Workflow must be a YAML object' };
    }

    const result = WorkflowSchema.safeParse(parsed);
    if (!result.success) {
      const firstError = result.error.issues[0];
      return {
        valid: false,
        error: `${firstError.path.join('.')}: ${firstError.message}`,
      };
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: `YAML parsing error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
