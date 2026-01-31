import { useState, useEffect } from 'react';

interface Workflow {
  name: string;
  description?: string;
  triggerCount: number;
  stepCount: number;
  lastRun?: string;
  status: 'active' | 'inactive';
}

interface WorkflowsProps {
  onNavigate: (page: 'dashboard' | 'workflows' | 'runs' | 'builder' | 'plugins' | 'logs' | 'settings') => void;
}

export function Workflows({ onNavigate }: WorkflowsProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/workflows')
      .then((res) => res.json())
      .then((data) => {
        setWorkflows(data.workflows ?? []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const handleRun = async (workflowName: string) => {
    try {
      const res = await fetch(`/api/workflows/${workflowName}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      alert(`Started run: ${data.runId}`);
    } catch (err) {
      console.error(err);
      alert('Failed to start workflow');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Workflows</h1>
          <p className="page-subtitle">Manage your automation workflows</p>
        </div>
        <button className="btn btn-primary" onClick={() => onNavigate('builder')}>
          <span>+</span> New Workflow
        </button>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon">⏳</div>
          <div className="empty-title">Loading workflows...</div>
        </div>
      ) : workflows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🧵</div>
          <div className="empty-title">No workflows yet</div>
          <p>Create your first workflow to get started</p>
          <button className="btn btn-primary" style={{ marginTop: '20px' }} onClick={() => onNavigate('builder')}>
            <span>+</span> Create Workflow
          </button>
        </div>
      ) : (
        <div>
          {workflows.map((workflow) => (
            <div key={workflow.name} className="workflow-item">
              <div className="workflow-info">
                <div className="workflow-icon">🔄</div>
                <div>
                  <div className="workflow-name">{workflow.name}</div>
                  <div className="workflow-description">
                    {workflow.description ?? 'No description'}
                  </div>
                </div>
              </div>
              <div className="workflow-meta">
                <span className="workflow-stat">
                  {workflow.triggerCount} trigger{workflow.triggerCount !== 1 ? 's' : ''}
                </span>
                <span className="workflow-stat">
                  {workflow.stepCount} step{workflow.stepCount !== 1 ? 's' : ''}
                </span>
                <span className={`badge badge-${workflow.status === 'active' ? 'success' : 'info'}`}>
                  {workflow.status}
                </span>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleRun(workflow.name)}
                >
                  ▶ Run
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
