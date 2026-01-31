import { useState, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

interface Run {
  id: string;
  workflow: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  error?: string;
}

export function Runs() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
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
      }
    }
  }, [messages]);

  const filteredRuns = runs.filter((run) => {
    if (filter === 'all') return true;
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

  const statusIcon = (status: Run['status']) => {
    switch (status) {
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Run History</h1>
          <p className="page-subtitle">View and monitor workflow executions</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['all', 'completed', 'running', 'failed'].map((f) => (
            <button
              key={f}
              className={`btn ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f)}
              style={{ textTransform: 'capitalize' }}
            >
              {f}
            </button>
          ))}
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
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Workflow</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Run ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => (
                <tr key={run.id}>
                  <td>
                    <span
                      className={`badge badge-${
                        run.status === 'completed'
                          ? 'success'
                          : run.status === 'failed'
                            ? 'error'
                            : run.status === 'running'
                              ? 'info'
                              : 'warning'
                      }`}
                    >
                      {statusIcon(run.status)} {run.status}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{run.workflow}</span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {formatTime(run.startedAt)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {formatDuration(run.duration)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '12px' }}>
                    {run.id.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
