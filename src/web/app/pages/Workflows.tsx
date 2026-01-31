import { useState, useEffect } from 'react';

interface Workflow {
  name: string;
  description?: string;
  triggerCount: number;
  stepCount: number;
  triggerType?: string;
  scheduled?: boolean;
  scheduleStatus?: 'active' | 'paused' | 'inactive';
  nextRun?: string;
  lastRun?: string;
  lastStatus?: 'success' | 'failed';
}

interface RunStatus {
  workflow: string;
  status: 'running' | 'success' | 'failed';
  message?: string;
}

type Page = 'dashboard' | 'workflows' | 'runs' | 'builder' | 'plugins' | 'logs' | 'settings';

interface WorkflowsProps {
  onNavigate: (page: Page, workflowName?: string) => void;
}

export function Workflows({ onNavigate }: WorkflowsProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [runStatus, setRunStatus] = useState<Record<string, RunStatus>>({});

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

  const handleRun = async (e: React.MouseEvent, workflowName: string) => {
    e.stopPropagation();

    // Set running status
    setRunStatus(prev => ({
      ...prev,
      [workflowName]: { workflow: workflowName, status: 'running' }
    }));

    try {
      const res = await fetch(`/api/workflows/${workflowName}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (res.ok) {
        setRunStatus(prev => ({
          ...prev,
          [workflowName]: { workflow: workflowName, status: 'success', message: `Run started: ${data.runId.slice(0, 8)}...` }
        }));

        // Clear success status after 3 seconds
        setTimeout(() => {
          setRunStatus(prev => {
            const newStatus = { ...prev };
            delete newStatus[workflowName];
            return newStatus;
          });
        }, 3000);
      } else {
        setRunStatus(prev => ({
          ...prev,
          [workflowName]: { workflow: workflowName, status: 'failed', message: data.error ?? 'Failed to start' }
        }));
      }
    } catch (err) {
      console.error(err);
      setRunStatus(prev => ({
        ...prev,
        [workflowName]: { workflow: workflowName, status: 'failed', message: 'Network error' }
      }));
    }
  };

  const handleEdit = (workflowName: string) => {
    onNavigate('builder', workflowName);
  };

  const handleScheduleAction = async (e: React.MouseEvent, workflowName: string, action: 'deploy' | 'undeploy' | 'pause' | 'resume') => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/scheduler/${workflowName}/${action}`, {
        method: 'POST',
      });
      if (res.ok) {
        // Refresh workflows list
        const workflowsRes = await fetch('/api/workflows');
        const data = await workflowsRes.json();
        setWorkflows(data.workflows ?? []);
      }
    } catch (err) {
      console.error(`Failed to ${action} workflow:`, err);
    }
  };

  const handleDelete = async (e: React.MouseEvent, workflowName: string) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete "${workflowName}"? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/workflows/${workflowName}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setWorkflows(prev => prev.filter(w => w.name !== workflowName));
      } else {
        const data = await res.json();
        alert(data.error ?? 'Failed to delete workflow');
      }
    } catch (err) {
      console.error('Failed to delete workflow:', err);
      alert('Failed to delete workflow');
    }
  };

  const formatRelativeTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffSec = Math.abs(Math.round(diffMs / 1000));
    const isPast = diffMs < 0;

    if (diffSec < 60) return isPast ? 'just now' : 'in < 1m';
    if (diffSec < 3600) {
      const mins = Math.round(diffSec / 60);
      return isPast ? `${mins}m ago` : `in ${mins}m`;
    }
    if (diffSec < 86400) {
      const hours = Math.round(diffSec / 3600);
      return isPast ? `${hours}h ago` : `in ${hours}h`;
    }
    const days = Math.round(diffSec / 86400);
    return isPast ? `${days}d ago` : `in ${days}d`;
  };

  const getRunButtonContent = (workflowName: string) => {
    const status = runStatus[workflowName];
    if (!status) {
      return (
        <>
          <span style={{ marginRight: '6px' }}>▶</span>
          Run Now
        </>
      );
    }

    switch (status.status) {
      case 'running':
        return (
          <>
            <span className="spinner" style={{ marginRight: '6px' }}>◌</span>
            Running...
          </>
        );
      case 'success':
        return (
          <>
            <span style={{ marginRight: '6px', color: 'var(--accent-green)' }}>✓</span>
            Started
          </>
        );
      case 'failed':
        return (
          <>
            <span style={{ marginRight: '6px', color: 'var(--accent-red)' }}>✗</span>
            Failed
          </>
        );
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Workflows</h1>
          <p className="page-subtitle">Manage and run your automation workflows</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={() => onNavigate('runs')}>
            View Run History
          </button>
          <button className="btn btn-primary" onClick={() => onNavigate('builder')}>
            <span>+</span> New Workflow
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon">...</div>
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
        <div style={{ display: 'grid', gap: '16px' }}>
          {workflows.map((workflow) => {
            const status = runStatus[workflow.name];
            return (
              <div
                key={workflow.name}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  border: status?.status === 'running' ? '1px solid var(--accent-blue)' : undefined,
                }}
              >
                {/* Main content - clickable to edit */}
                <div
                  onClick={() => handleEdit(workflow.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '16px 20px',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '10px',
                      background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-blue))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '20px',
                      flexShrink: 0,
                    }}
                  >
                    🔄
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600, fontSize: '15px', color: '#fff' }}>
                        {workflow.name}
                      </span>
                      {workflow.scheduled && (
                        <span
                          className={`badge badge-${workflow.scheduleStatus === 'active' ? 'success' : 'warning'}`}
                          style={{ fontSize: '10px', padding: '2px 6px' }}
                        >
                          {workflow.scheduleStatus === 'active' ? '● Active' : '○ Paused'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      {workflow.description ?? 'No description'}
                    </div>
                    <div style={{ display: 'flex', gap: '14px', fontSize: '11px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                      {workflow.triggerType && (
                        <span style={{ color: 'var(--accent-yellow)' }}>
                          ⚡ {workflow.triggerType}
                        </span>
                      )}
                      <span>
                        📦 {workflow.stepCount} step{workflow.stepCount !== 1 ? 's' : ''}
                      </span>
                      {workflow.nextRun && workflow.scheduleStatus === 'active' && (
                        <span style={{ color: 'var(--accent-blue)' }}>
                          ⏰ Next: {formatRelativeTime(workflow.nextRun)}
                        </span>
                      )}
                      {workflow.lastRun && (
                        <span style={{ color: workflow.lastStatus === 'success' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                          {workflow.lastStatus === 'success' ? '✓' : '✗'} Last: {formatRelativeTime(workflow.lastRun)}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '18px' }}>→</span>
                </div>

                {/* Action bar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 16px',
                    borderTop: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                  }}
                >
                  {/* Left side - secondary actions */}
                  <button
                    className="btn btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate('runs', workflow.name);
                    }}
                    style={{
                      padding: '8px 12px',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                    }}
                    title="View run history"
                  >
                    📜 History
                  </button>

                  <button
                    className="btn btn-ghost"
                    onClick={(e) => handleDelete(e, workflow.name)}
                    style={{
                      padding: '8px 12px',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                    }}
                    title="Delete workflow"
                  >
                    🗑 Delete
                  </button>

                  {/* Spacer */}
                  <div style={{ flex: 1 }} />

                  {/* Right side - primary actions */}
                  {workflow.triggerType && (
                    <>
                      {workflow.scheduled && workflow.scheduleStatus === 'active' ? (
                        <button
                          className="btn btn-ghost"
                          onClick={(e) => handleScheduleAction(e, workflow.name, 'pause')}
                          style={{
                            padding: '8px 14px',
                            fontSize: '12px',
                            color: 'var(--accent-yellow)',
                          }}
                          title="Pause scheduled runs"
                        >
                          ⏸ Pause
                        </button>
                      ) : workflow.scheduled && workflow.scheduleStatus === 'paused' ? (
                        <button
                          className="btn btn-ghost"
                          onClick={(e) => handleScheduleAction(e, workflow.name, 'resume')}
                          style={{
                            padding: '8px 14px',
                            fontSize: '12px',
                            color: 'var(--accent-green)',
                          }}
                          title="Resume scheduled runs"
                        >
                          ▶ Resume
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost"
                          onClick={(e) => handleScheduleAction(e, workflow.name, 'deploy')}
                          style={{
                            padding: '8px 14px',
                            fontSize: '12px',
                            color: 'var(--accent-blue)',
                          }}
                          title="Deploy and start scheduling"
                        >
                          🚀 Deploy
                        </button>
                      )}
                    </>
                  )}

                  <button
                    className="btn btn-primary"
                    onClick={(e) => handleRun(e, workflow.name)}
                    disabled={status?.status === 'running'}
                    style={{
                      padding: '8px 16px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: status?.status === 'running'
                        ? 'rgba(59, 130, 246, 0.3)'
                        : status?.status === 'success'
                        ? 'rgba(34, 197, 94, 0.3)'
                        : status?.status === 'failed'
                        ? 'rgba(239, 68, 68, 0.3)'
                        : undefined,
                      color: status?.status === 'running' ? 'var(--accent-blue)' : undefined,
                    }}
                  >
                    {getRunButtonContent(workflow.name)}
                  </button>
                </div>

                {/* Status message */}
                {status?.message && (
                  <div
                    style={{
                      padding: '8px 20px',
                      fontSize: '12px',
                      background: status.status === 'success'
                        ? 'rgba(34, 197, 94, 0.1)'
                        : 'rgba(239, 68, 68, 0.1)',
                      color: status.status === 'success'
                        ? 'var(--accent-green)'
                        : 'var(--accent-red)',
                      borderTop: '1px solid var(--border-color)',
                    }}
                  >
                    {status.message}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spinner {
          display: inline-block;
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
