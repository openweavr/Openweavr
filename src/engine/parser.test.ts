import { describe, it, expect } from 'vitest';
import { WorkflowParser } from './parser.js';

describe('WorkflowParser', () => {
  const parser = new WorkflowParser();

  it('should parse a valid workflow YAML', () => {
    const yaml = `
name: test-workflow
description: A test workflow
steps:
  - id: step1
    action: log
    config:
      message: Hello
`;

    const workflow = parser.parse(yaml);

    expect(workflow.name).toBe('test-workflow');
    expect(workflow.description).toBe('A test workflow');
    expect(workflow.steps).toHaveLength(1);
    expect(workflow.steps[0].id).toBe('step1');
    expect(workflow.steps[0].action).toBe('log');
  });

  it('should parse workflow with triggers', () => {
    const yaml = `
name: triggered-workflow
triggers:
  - type: cron.schedule
    config:
      expression: "0 9 * * *"
steps:
  - id: notify
    action: slack.post
    config:
      channel: "#general"
      text: Good morning!
`;

    const workflow = parser.parse(yaml);

    expect(workflow.triggers).toHaveLength(1);
    expect(workflow.triggers![0].type).toBe('cron.schedule');
    expect(workflow.triggers![0].config?.expression).toBe('0 9 * * *');
  });

  it('should parse workflow with dependencies', () => {
    const yaml = `
name: pipeline
steps:
  - id: build
    action: log
    config:
      message: Building...
  - id: test
    action: log
    depends_on:
      - build
    config:
      message: Testing...
  - id: deploy
    action: log
    depends_on:
      - test
    config:
      message: Deploying...
`;

    const workflow = parser.parse(yaml);

    expect(workflow.steps).toHaveLength(3);
    expect(workflow.steps[1].depends_on).toEqual(['build']);
    expect(workflow.steps[2].depends_on).toEqual(['test']);
  });

  it('should validate workflow structure', () => {
    const validWorkflow = {
      name: 'valid',
      steps: [{ id: 'step1', action: 'log' }],
    };

    const invalidWorkflow = {
      steps: [{ id: 'step1' }], // missing name and action
    };

    expect(parser.validate(validWorkflow).valid).toBe(true);
    expect(parser.validate(invalidWorkflow).valid).toBe(false);
  });

  it('should reject workflow without name', () => {
    const result = parser.validate({
      steps: [{ id: 'step1', action: 'log' }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });
});
