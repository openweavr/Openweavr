import { useState, useEffect } from 'react';
import { WorkflowBuilder } from '../components/WorkflowBuilder';

type Page = 'dashboard' | 'workflows' | 'runs' | 'builder' | 'plugins' | 'logs' | 'settings';

interface BuilderProps {
  workflowName?: string | null;
  onNavigate: (page: Page) => void;
}

export function Builder({ workflowName, onNavigate }: BuilderProps) {
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [initialYaml, setInitialYaml] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!workflowName);
  const [originalName, setOriginalName] = useState<string | null>(null);

  useEffect(() => {
    if (workflowName) {
      setLoading(true);
      setOriginalName(workflowName);
      fetch(`/api/workflows/${workflowName}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.content) {
            setInitialYaml(data.content);
          }
          setLoading(false);
        })
        .catch((err) => {
          console.error('Failed to load workflow:', err);
          setLoading(false);
        });
    } else {
      setInitialYaml(null);
      setOriginalName(null);
      setLoading(false);
    }
  }, [workflowName]);

  const handleSave = async (yaml: string, name: string) => {
    setSaving(true);
    setSaveMessage(null);

    try {
      // Pass originalName so server can handle rename (delete old file)
      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, yaml, originalName }),
      });

      const data = await response.json();

      if (response.ok) {
        setSaveMessage({ type: 'success', text: `Workflow "${data.name}" saved successfully!` });
        setOriginalName(data.name); // Update original name after successful save
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        setSaveMessage({ type: 'error', text: data.error ?? 'Failed to save workflow' });
      }
    } catch (err) {
      setSaveMessage({ type: 'error', text: 'Network error: Could not save workflow' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>...</div>
          <div style={{ color: 'var(--text-muted)' }}>Loading workflow...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: 'calc(100vh - 64px)', position: 'relative' }}>
      <WorkflowBuilder
        onSave={handleSave}
        saving={saving}
        initialYaml={initialYaml}
        initialName={workflowName}
        onBack={() => onNavigate('workflows')}
      />

      {saveMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            padding: '12px 20px',
            borderRadius: '8px',
            background: saveMessage.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
            color: 'white',
            fontWeight: 500,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 1000,
          }}
        >
          {saveMessage.type === 'success' ? '✓' : '✗'} {saveMessage.text}
        </div>
      )}
    </div>
  );
}
