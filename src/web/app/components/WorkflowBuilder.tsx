import { useState, useCallback } from 'react';

interface Step {
  id: string;
  action: string;
  config: Record<string, unknown>;
  depends_on?: string[];
}

interface Trigger {
  type: string;
  config: Record<string, unknown>;
}

interface WorkflowBuilderProps {
  initialWorkflow?: {
    name: string;
    description?: string;
    triggers?: Trigger[];
    steps: Step[];
  };
  onSave?: (yaml: string) => void;
}

const AVAILABLE_ACTIONS = [
  { category: 'Core', actions: ['transform', 'log', 'delay', 'condition'] },
  { category: 'HTTP', actions: ['http.request', 'http.get', 'http.post'] },
  { category: 'GitHub', actions: ['github.create_issue', 'github.create_comment', 'github.add_labels'] },
  { category: 'Slack', actions: ['slack.post', 'slack.update', 'slack.react'] },
  { category: 'Discord', actions: ['discord.send', 'discord.embed'] },
  { category: 'Linear', actions: ['linear.create_issue', 'linear.update_issue', 'linear.add_comment'] },
  { category: 'Notion', actions: ['notion.create_page', 'notion.update_page', 'notion.query_database'] },
  { category: 'Email', actions: ['email.send'] },
  { category: 'AI', actions: ['ai.complete', 'ai.summarize', 'ai.extract', 'ai.classify'] },
  { category: 'JSON', actions: ['json.parse', 'json.get', 'json.filter', 'json.map'] },
];

const AVAILABLE_TRIGGERS = [
  { type: 'http.webhook', label: 'Webhook' },
  { type: 'cron.schedule', label: 'Schedule' },
  { type: 'github.push', label: 'GitHub Push' },
  { type: 'github.pull_request', label: 'GitHub PR' },
  { type: 'github.issue.opened', label: 'GitHub Issue Opened' },
  { type: 'github.issue.labeled', label: 'GitHub Issue Labeled' },
  { type: 'slack.message', label: 'Slack Message' },
  { type: 'linear.issue.created', label: 'Linear Issue Created' },
];

export function WorkflowBuilder({ initialWorkflow, onSave }: WorkflowBuilderProps) {
  const [name, setName] = useState(initialWorkflow?.name ?? 'new-workflow');
  const [description, setDescription] = useState(initialWorkflow?.description ?? '');
  const [triggers, setTriggers] = useState<Trigger[]>(initialWorkflow?.triggers ?? []);
  const [steps, setSteps] = useState<Step[]>(initialWorkflow?.steps ?? []);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [showActionPicker, setShowActionPicker] = useState(false);

  const addTrigger = useCallback((type: string) => {
    setTriggers([...triggers, { type, config: {} }]);
  }, [triggers]);

  const removeTrigger = useCallback((index: number) => {
    setTriggers(triggers.filter((_, i) => i !== index));
  }, [triggers]);

  const addStep = useCallback((action: string) => {
    const id = `step-${steps.length + 1}`;
    setSteps([...steps, { id, action, config: {} }]);
    setSelectedStep(id);
    setShowActionPicker(false);
  }, [steps]);

  const removeStep = useCallback((id: string) => {
    setSteps(steps.filter((s) => s.id !== id));
    if (selectedStep === id) setSelectedStep(null);
  }, [steps, selectedStep]);

  const updateStep = useCallback((id: string, updates: Partial<Step>) => {
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, [steps]);

  const moveStep = useCallback((id: string, direction: 'up' | 'down') => {
    const index = steps.findIndex((s) => s.id === id);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= steps.length) return;

    const newSteps = [...steps];
    [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
    setSteps(newSteps);
  }, [steps]);

  const generateYaml = useCallback(() => {
    let yaml = `name: ${name}\n`;
    if (description) yaml += `description: ${description}\n`;
    yaml += '\n';

    if (triggers.length > 0) {
      yaml += 'triggers:\n';
      for (const trigger of triggers) {
        yaml += `  - type: ${trigger.type}\n`;
        if (Object.keys(trigger.config).length > 0) {
          yaml += '    config:\n';
          for (const [key, value] of Object.entries(trigger.config)) {
            yaml += `      ${key}: ${JSON.stringify(value)}\n`;
          }
        }
      }
      yaml += '\n';
    }

    yaml += 'steps:\n';
    for (const step of steps) {
      yaml += `  - id: ${step.id}\n`;
      yaml += `    action: ${step.action}\n`;
      if (Object.keys(step.config).length > 0) {
        yaml += '    config:\n';
        for (const [key, value] of Object.entries(step.config)) {
          if (typeof value === 'string' && value.includes('\n')) {
            yaml += `      ${key}: |\n`;
            for (const line of value.split('\n')) {
              yaml += `        ${line}\n`;
            }
          } else {
            yaml += `      ${key}: ${JSON.stringify(value)}\n`;
          }
        }
      }
      if (step.depends_on && step.depends_on.length > 0) {
        yaml += '    depends_on:\n';
        for (const dep of step.depends_on) {
          yaml += `      - ${dep}\n`;
        }
      }
    }

    return yaml;
  }, [name, description, triggers, steps]);

  const handleSave = useCallback(() => {
    const yaml = generateYaml();
    onSave?.(yaml);
  }, [generateYaml, onSave]);

  const currentStep = steps.find((s) => s.id === selectedStep);

  return (
    <div style={{ display: 'flex', gap: '24px', height: '100%' }}>
      {/* Left Panel - Workflow Canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Header */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ fontWeight: 600, fontSize: '18px', flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleSave}>
              💾 Save
            </button>
          </div>
          <input
            type="text"
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Workflow description..."
            style={{ marginTop: '8px' }}
          />
        </div>

        {/* Triggers */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">⚡ Triggers</h3>
            <div className="dropdown" style={{ position: 'relative' }}>
              <button className="btn btn-ghost" onClick={() => {}}>
                + Add Trigger
              </button>
            </div>
          </div>
          {triggers.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px', textAlign: 'center' }}>
              No triggers. Workflow will only run manually.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {triggers.map((trigger, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>⚡</span>
                    <span style={{ fontWeight: 500 }}>{trigger.type}</span>
                  </div>
                  <button
                    className="btn btn-ghost"
                    onClick={() => removeTrigger(index)}
                    style={{ padding: '4px 8px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
            {AVAILABLE_TRIGGERS.slice(0, 4).map((t) => (
              <button
                key={t.type}
                className="btn btn-ghost"
                onClick={() => addTrigger(t.type)}
                style={{ fontSize: '12px', padding: '6px 10px' }}
              >
                + {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Steps */}
        <div className="card" style={{ flex: 1, overflow: 'auto' }}>
          <div className="card-header">
            <h3 className="card-title">📋 Steps</h3>
            <button className="btn btn-secondary" onClick={() => setShowActionPicker(true)}>
              + Add Step
            </button>
          </div>

          {steps.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px' }}>
              <div className="empty-icon">🔧</div>
              <div className="empty-title">No steps yet</div>
              <p>Add steps to build your workflow</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  onClick={() => setSelectedStep(step.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    background: selectedStep === step.id ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    border: selectedStep === step.id ? '1px solid var(--accent-purple)' : '1px solid transparent',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px', width: '24px' }}>
                    {index + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{step.id}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{step.action}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      className="btn btn-ghost"
                      onClick={(e) => { e.stopPropagation(); moveStep(step.id, 'up'); }}
                      style={{ padding: '4px' }}
                      disabled={index === 0}
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={(e) => { e.stopPropagation(); moveStep(step.id, 'down'); }}
                      style={{ padding: '4px' }}
                      disabled={index === steps.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={(e) => { e.stopPropagation(); removeStep(step.id); }}
                      style={{ padding: '4px', color: 'var(--accent-red)' }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Step Editor */}
      <div style={{ width: '360px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {currentStep ? (
          <div className="card" style={{ flex: 1 }}>
            <h3 className="card-title" style={{ marginBottom: '16px' }}>Step: {currentStep.id}</h3>

            <div style={{ marginBottom: '16px' }}>
              <label className="label">Step ID</label>
              <input
                type="text"
                className="input"
                value={currentStep.id}
                onChange={(e) => updateStep(currentStep.id, { id: e.target.value })}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label className="label">Action</label>
              <input
                type="text"
                className="input"
                value={currentStep.action}
                onChange={(e) => updateStep(currentStep.id, { action: e.target.value })}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label className="label">Dependencies</label>
              <select
                className="input"
                multiple
                value={currentStep.depends_on ?? []}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                  updateStep(currentStep.id, { depends_on: selected });
                }}
                style={{ height: '80px' }}
              >
                {steps
                  .filter((s) => s.id !== currentStep.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="label">Config (JSON)</label>
              <textarea
                className="input"
                value={JSON.stringify(currentStep.config, null, 2)}
                onChange={(e) => {
                  try {
                    const config = JSON.parse(e.target.value);
                    updateStep(currentStep.id, { config });
                  } catch {
                    // Invalid JSON, don't update
                  }
                }}
                style={{ minHeight: '200px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
              />
            </div>
          </div>
        ) : (
          <div className="card" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              <p>Select a step to edit</p>
            </div>
          </div>
        )}

        {/* YAML Preview */}
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: '12px' }}>YAML Preview</h3>
          <pre className="code-block" style={{ maxHeight: '200px', overflow: 'auto', fontSize: '11px' }}>
            {generateYaml()}
          </pre>
        </div>
      </div>

      {/* Action Picker Modal */}
      {showActionPicker && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowActionPicker(false)}
        >
          <div
            className="card"
            style={{ width: '500px', maxHeight: '80vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="card-title" style={{ marginBottom: '16px' }}>Add Step</h3>
            {AVAILABLE_ACTIONS.map((category) => (
              <div key={category.category} style={{ marginBottom: '16px' }}>
                <h4 style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  {category.category}
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {category.actions.map((action) => (
                    <button
                      key={action}
                      className="btn btn-secondary"
                      onClick={() => addStep(action)}
                      style={{ fontSize: '13px' }}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
