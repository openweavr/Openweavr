import { useState, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

interface Stats {
  totalWorkflows: number;
  activeRuns: number;
  successRate: number;
  totalRuns: number;
}

interface RecentRun {
  id: string;
  workflow: string;
  status: 'success' | 'failed' | 'running';
  startedAt: string;
  duration?: number;
}

export function Dashboard() {
  const { connected, messages } = useWebSocket();
  const [stats, setStats] = useState<Stats>({
    totalWorkflows: 0,
    activeRuns: 0,
    successRate: 100,
    totalRuns: 0,
  });
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);

  useEffect(() => {
    // Fetch initial stats
    fetch('/api/workflows')
      .then((res) => res.json())
      .then((data) => {
        setStats((prev) => ({
          ...prev,
          totalWorkflows: data.workflows?.length ?? 0,
        }));
      })
      .catch(console.error);

    fetch('/api/runs')
      .then((res) => res.json())
      .then((data) => {
        if (data.runs) {
          setRecentRuns(data.runs.slice(0, 10));
        }
      })
      .catch(console.error);
  }, []);

  // Listen for real-time updates
  useEffect(() => {
    const runMessages = messages.filter(
      (m) => m.type === 'workflow.started' || m.type === 'workflow.completed'
    );

    if (runMessages.length > 0) {
      const latest = runMessages[runMessages.length - 1];
      if (latest.type === 'workflow.started') {
        setStats((prev) => ({ ...prev, activeRuns: prev.activeRuns + 1 }));
      } else if (latest.type === 'workflow.completed') {
        setStats((prev) => ({
          ...prev,
          activeRuns: Math.max(0, prev.activeRuns - 1),
          totalRuns: prev.totalRuns + 1,
        }));
      }
    }
  }, [messages]);

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Overview of your workflow automations</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Workflows</div>
          <div className="stat-value">{stats.totalWorkflows}</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Active Runs</div>
          <div className="stat-value">{stats.activeRuns}</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Success Rate</div>
          <div className="stat-value">{stats.successRate}%</div>
          <div className="stat-change positive">All systems operational</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Total Runs</div>
          <div className="stat-value">{stats.totalRuns}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Recent Activity</h2>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {connected ? '🟢 Live' : '🔴 Offline'}
          </span>
        </div>

        {recentRuns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔄</div>
            <div className="empty-title">No recent runs</div>
            <p>Workflow executions will appear here in real-time</p>
          </div>
        ) : (
          <div>
            {recentRuns.map((run) => (
              <div key={run.id} className="run-item">
                <div className={`run-status ${run.status}`}>
                  {run.status === 'success' ? '✓' : run.status === 'failed' ? '✗' : '⏳'}
                </div>
                <div className="run-details">
                  <div className="run-workflow">{run.workflow}</div>
                  <div className="run-time">{formatTime(run.startedAt)}</div>
                </div>
                <div className="run-duration">{formatDuration(run.duration)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Quick Actions</h2>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-primary">
            <span>+</span> New Workflow
          </button>
          <button className="btn btn-secondary">
            <span>📥</span> Import
          </button>
          <button className="btn btn-ghost">
            <span>📖</span> Documentation
          </button>
        </div>
      </div>
    </div>
  );
}
