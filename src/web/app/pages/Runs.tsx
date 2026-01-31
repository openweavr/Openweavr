import { useState, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'success';
  stepId?: string;
  message: string;
}

interface StepResult {
  id: string;
  status: string;
  duration?: number;
  error?: string;
  output?: unknown;
}

interface Run {
  id: string;
  workflow: string;
  status: 'pending' | 'running' | 'success' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  error?: string;
  logs?: LogEntry[];
  steps?: StepResult[];
}

interface RunsProps {
  workflowFilter?: string | null;
  onClearFilter?: () => void;
}

export function Runs({ workflowFilter, onClearFilter }: RunsProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<Record<string, Run>>({});
  const { messages } = useWebSocket();

  useEffect(() => {
    fetch('/api/runs')
      .then((res) => res.json())
      .then((data) => {
        setRuns(data.runs ?? []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  // Listen for real-time updates
  useEffect(() => {
    for (const message of messages) {
      if (message.type === 'workflow.started') {
        const payload = message.payload as { runId: string; workflow: string };
        setRuns((prev) => [
          {
            id: payload.runId,
            workflow: payload.workflow,
            status: 'running',
            startedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      } else if (message.type === 'workflow.completed') {
        const payload = message.payload as { runId: string; status: string };
        setRuns((prev) =>
          prev.map((run) =>
            run.id === payload.runId
              ? {
                  ...run,
                  status: payload.status as Run['status'],
                  completedAt: new Date().toISOString(),
                }
              : run
          )
        );
        // Refresh details if expanded
        if (expandedRun === payload.runId) {
          fetchRunDetails(payload.runId);
        }
      }
    }
  }, [messages, expandedRun]);

  const fetchRunDetails = async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}`);
      const data = await res.json();
      setRunDetails(prev => ({ ...prev, [runId]: data }));
    } catch (err) {
      console.error('Failed to fetch run details:', err);
    }
  };

  const toggleExpand = async (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
    } else {
      setExpandedRun(runId);
      if (!runDetails[runId]) {
        await fetchRunDetails(runId);
      }
    }
  };

  const filteredRuns = runs.filter((run) => {
    // Apply workflow filter first
    if (workflowFilter && run.workflow !== workflowFilter) return false;
    // Then apply status filter
    if (filter === 'all') return true;
    if (filter === 'success') return run.status === 'success' || run.status === 'completed';
    return run.status === filter;
  });

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  const formatLogTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  };

  const statusIcon = (status: Run['status']) => {
    switch (status) {
      case 'success':
      case 'completed':
        return '✓';
      case 'failed':
        return '✗';
      case 'running':
        return '⏳';
      default:
        return '○';
    }
  };

  const refreshRuns = () => {
    setLoading(true);
    fetch('/api/runs')
      .then((res) => res.json())
      .then((data) => {
        setRuns(data.runs ?? []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Run History
            {workflowFilter && (
              <span style={{ fontWeight: 400, fontSize: '18px', color: 'var(--text-secondary)', marginLeft: '12px' }}>
                for "{workflowFilter}"
              </span>
            )}
          </h1>
          <p className="page-subtitle">
            {workflowFilter
              ? `Showing runs for ${workflowFilter} workflow`
              : 'View and monitor workflow executions'
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {workflowFilter && onClearFilter && (
            <button
              className="btn btn-ghost"
              onClick={onClearFilter}
              style={{ color: 'var(--accent-purple)' }}
            >
              ✕ Clear Filter
            </button>
          )}
          {['all', 'success', 'running', 'failed'].map((f) => (
            <button
              key={f}
              className={`btn ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f)}
              style={{ textTransform: 'capitalize' }}
            >
              {f}
            </button>
          ))}
          <button className="btn btn-secondary" onClick={refreshRuns} style={{ marginLeft: '8px' }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon">⏳</div>
          <div className="empty-title">Loading runs...</div>
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📜</div>
          <div className="empty-title">No runs found</div>
          <p>
            {filter === 'all'
              ? 'Run a workflow to see execution history here'
              : `No ${filter} runs to show`}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredRuns.map((run) => {
            const isExpanded = expandedRun === run.id;
            const details = runDetails[run.id];

            return (
              <div key={run.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Run header - clickable */}
                <div
                  onClick={() => toggleExpand(run.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '16px 20px',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    gap: '20px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span
                    style={{
                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s',
                      color: 'var(--text-muted)',
                    }}
                  >
                    ▶
                  </span>

                  <span
                    className={`badge badge-${
                      run.status === 'success' || run.status === 'completed'
                        ? 'success'
                        : run.status === 'failed'
                          ? 'error'
                          : run.status === 'running'
                            ? 'info'
                            : 'warning'
                    }`}
                    style={{ minWidth: '80px', justifyContent: 'center' }}
                  >
                    {statusIcon(run.status)} {run.status}
                  </span>

                  <span style={{ fontWeight: 600, flex: 1, color: '#fff' }}>
                    {run.workflow}
                  </span>

                  <span style={{ color: 'var(--text-secondary)', minWidth: '100px' }}>
                    {formatTime(run.startedAt)}
                  </span>

                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', minWidth: '80px' }}>
                    {formatDuration(run.duration)}
                  </span>

                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '12px', minWidth: '80px' }}>
                    {run.id.slice(0, 8)}
                  </span>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border-color)' }}>
                    {/* Steps */}
                    {details?.steps && details.steps.length > 0 && (
                      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
                        <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase' }}>
                          Steps
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {details.steps.map((step, idx) => (
                            <div
                              key={step.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '10px 14px',
                                background: 'var(--bg-tertiary)',
                                borderRadius: 'var(--radius-md)',
                                borderLeft: `3px solid ${
                                  step.status === 'completed' ? 'var(--accent-green)'
                                    : step.status === 'failed' ? 'var(--accent-red)'
                                    : step.status === 'running' ? 'var(--accent-blue)'
                                    : 'var(--border-color)'
                                }`,
                              }}
                            >
                              <span style={{ color: 'var(--text-muted)', fontSize: '12px', minWidth: '20px' }}>
                                {idx + 1}.
                              </span>
                              <span style={{
                                color: step.status === 'completed' ? 'var(--accent-green)'
                                  : step.status === 'failed' ? 'var(--accent-red)'
                                  : 'var(--text-muted)',
                                minWidth: '20px',
                              }}>
                                {step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : '○'}
                              </span>
                              <span style={{ fontWeight: 500, flex: 1, color: '#fff' }}>{step.id}</span>
                              {step.duration !== undefined && (
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>
                                  {formatDuration(step.duration)}
                                </span>
                              )}
                              {step.error && (
                                <span style={{ color: 'var(--accent-red)', fontSize: '12px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {step.error}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Logs */}
                    <div style={{ padding: '16px 20px' }}>
                      <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase' }}>
                        Logs
                      </h4>
                      {details?.logs && details.logs.length > 0 ? (
                        <div
                          style={{
                            background: '#0d1117',
                            borderRadius: 'var(--radius-md)',
                            padding: '12px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            maxHeight: '300px',
                            overflow: 'auto',
                          }}
                        >
                          {details.logs.map((log, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: 'flex',
                                gap: '12px',
                                padding: '4px 0',
                                borderBottom: idx < details.logs!.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                              }}
                            >
                              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                                {formatLogTime(log.timestamp)}
                              </span>
                              <span
                                style={{
                                  color: log.level === 'error' ? 'var(--accent-red)'
                                    : log.level === 'success' ? 'var(--accent-green)'
                                    : 'var(--text-secondary)',
                                  flexShrink: 0,
                                  minWidth: '60px',
                                }}
                              >
                                [{log.level.toUpperCase()}]
                              </span>
                              {log.stepId && (
                                <span style={{ color: 'var(--accent-purple)', flexShrink: 0 }}>
                                  [{log.stepId}]
                                </span>
                              )}
                              <span style={{ color: log.level === 'error' ? 'var(--accent-red)' : '#fff', wordBreak: 'break-word' }}>
                                {log.message}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                          {details ? 'No logs available' : 'Loading logs...'}
                        </div>
                      )}
                    </div>

                    {/* Error message */}
                    {details?.error && (
                      <div
                        style={{
                          padding: '12px 20px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          borderTop: '1px solid var(--border-color)',
                          color: 'var(--accent-red)',
                          fontSize: '13px',
                        }}
                      >
                        <strong>Error:</strong> {details.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
