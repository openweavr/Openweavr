import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

interface DashboardStats {
  ai: {
    provider: string;
    model: string;
    authMethod: string;
    hasApiKey: boolean;
    hasOAuth: boolean;
  };
  usage: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
    lastUpdated: string;
  };
  workflows: {
    active: number;
    paused: number;
    total: number;
  };
  runs: {
    total: number;
    successRate: number;
    active: number;
  };
}

interface ActiveWorkflow {
  name: string;
  description?: string;
  triggerType?: string;
  scheduled: boolean;
  scheduleStatus: 'active' | 'paused' | 'inactive';
  nextRun?: string;
  lastRun?: string;
  lastStatus?: 'success' | 'failed';
}

interface RecentRun {
  id: string;
  workflow: string;
  status: 'success' | 'failed' | 'running';
  startedAt: string;
  duration?: number;
}

type Page = 'dashboard' | 'workflows' | 'runs' | 'builder' | 'plugins' | 'logs' | 'settings';

interface DashboardProps {
  onNavigate: (page: Page, workflowName?: string) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { connected, messages } = useWebSocket();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [workflows, setWorkflows] = useState<ActiveWorkflow[]>([]);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [runningWorkflow, setRunningWorkflow] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, workflowsRes, runsRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/workflows'),
        fetch('/api/runs'),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (workflowsRes.ok) {
        const workflowsData = await workflowsRes.json();
        setWorkflows(workflowsData.workflows ?? []);
      }

      if (runsRes.ok) {
        const runsData = await runsRes.json();
        setRecentRuns(runsData.runs?.slice(0, 5) ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for real-time updates
  useEffect(() => {
    const runMessages = messages.filter(
      (m) => m.type === 'workflow.started' || m.type === 'workflow.completed'
    );

    if (runMessages.length > 0) {
      // Refresh data when workflow events occur
      fetchData();
    }
  }, [messages, fetchData]);

  const formatTokens = (count: number): string => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatRelativeTime = (isoString?: string) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const formatNextRun = (isoString?: string) => {
    if (!isoString) return 'Not scheduled';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getTriggerIcon = (triggerType?: string) => {
    if (!triggerType) return '🔗';
    if (triggerType.startsWith('cron')) return '⏰';
    if (triggerType.startsWith('github')) return '🐙';
    if (triggerType.startsWith('http') || triggerType.includes('webhook')) return '🔗';
    if (triggerType.startsWith('telegram')) return '💬';
    if (triggerType.startsWith('discord')) return '🎮';
    if (triggerType.startsWith('slack')) return '💼';
    return '🔗';
  };

  const getStatusDotClass = (status: string) => {
    switch (status) {
      case 'active': return 'status-dot active';
      case 'paused': return 'status-dot paused';
      default: return 'status-dot inactive';
    }
  };

  const handleRunWorkflow = async (name: string) => {
    setRunningWorkflow(name);
    try {
      await fetch(`/api/workflows/${name}/run`, { method: 'POST' });
      // Refresh data after a short delay
      setTimeout(fetchData, 500);
    } catch (err) {
      console.error('Failed to run workflow:', err);
    } finally {
      setRunningWorkflow(null);
    }
  };

  const handlePauseWorkflow = async (name: string) => {
    try {
      await fetch(`/api/scheduler/${name}/pause`, { method: 'POST' });
      fetchData();
    } catch (err) {
      console.error('Failed to pause workflow:', err);
    }
  };

  const handleResumeWorkflow = async (name: string) => {
    try {
      await fetch(`/api/scheduler/${name}/resume`, { method: 'POST' });
      fetchData();
    } catch (err) {
      console.error('Failed to resume workflow:', err);
    }
  };

  const getModelDisplayName = (model?: string) => {
    if (!model || model === 'not configured') return 'Not configured';
    // Shorten common model names
    if (model.includes('claude')) {
      const match = model.match(/claude-([a-z0-9.-]+)/i);
      return match ? `Claude ${match[1]}` : model;
    }
    if (model.includes('gpt-4')) return model.replace('gpt-', 'GPT-');
    return model;
  };

  const getProviderDisplayName = (provider?: string) => {
    switch (provider) {
      case 'anthropic': return 'Anthropic';
      case 'openai': return 'OpenAI';
      case 'ollama': return 'Ollama';
      case 'none': return 'Not configured';
      default: return provider ?? 'Unknown';
    }
  };

  // Filter to show only deployed/scheduled workflows
  const deployedWorkflows = workflows.filter(w => w.scheduled);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Overview of your workflow automations</p>
        </div>
        <span className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '🟢 Connected' : '🔴 Offline'}
        </span>
      </div>

      {/* Stats Cards */}
      <div className="dashboard-stats-grid">
        {/* AI Model Card */}
        <div className="dashboard-card model-card">
          <div className="dashboard-card-header">
            <span className="dashboard-card-icon">🤖</span>
            <span className="dashboard-card-title">AI Model</span>
          </div>
          <div className="dashboard-card-content">
            <div className="model-name">{getModelDisplayName(stats?.ai?.model)}</div>
            <div className="model-details">
              <span>Provider: {getProviderDisplayName(stats?.ai?.provider)}</span>
              <span className="auth-status">
                {stats?.ai?.hasApiKey || stats?.ai?.hasOAuth ? (
                  <span className="auth-ok">✓ Authenticated</span>
                ) : (
                  <span className="auth-missing">⚠ No API key</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Token Usage Card */}
        <div className="dashboard-card usage-card">
          <div className="dashboard-card-header">
            <span className="dashboard-card-icon">📊</span>
            <span className="dashboard-card-title">Token Usage</span>
          </div>
          <div className="dashboard-card-content">
            <div className="usage-stats">
              <div className="usage-stat">
                <span className="usage-label">Input</span>
                <span className="usage-value">{formatTokens(stats?.usage?.totalInputTokens ?? 0)}</span>
              </div>
              <div className="usage-stat">
                <span className="usage-label">Output</span>
                <span className="usage-value">{formatTokens(stats?.usage?.totalOutputTokens ?? 0)}</span>
              </div>
              <div className="usage-stat">
                <span className="usage-label">Requests</span>
                <span className="usage-value">{stats?.usage?.totalRequests ?? 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Active Workflows Summary Card */}
        <div className="dashboard-card workflows-summary-card">
          <div className="dashboard-card-header">
            <span className="dashboard-card-icon">⚡</span>
            <span className="dashboard-card-title">Workflows</span>
          </div>
          <div className="dashboard-card-content">
            <div className="workflow-counts">
              <div className="workflow-count active">
                <span className="count-value">{stats?.workflows?.active ?? 0}</span>
                <span className="count-label">active</span>
              </div>
              <div className="workflow-count paused">
                <span className="count-value">{stats?.workflows?.paused ?? 0}</span>
                <span className="count-label">paused</span>
              </div>
              <div className="workflow-count total">
                <span className="count-value">{stats?.runs?.successRate ?? 100}%</span>
                <span className="count-label">success</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Workflows Section */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Active Workflows</h2>
          <button className="btn btn-primary btn-sm" onClick={() => onNavigate('builder')}>
            + New Workflow
          </button>
        </div>

        {deployedWorkflows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔄</div>
            <div className="empty-title">No active workflows</div>
            <p>Deploy a workflow to start automating tasks</p>
            <button className="btn btn-secondary" onClick={() => onNavigate('workflows')}>
              View All Workflows
            </button>
          </div>
        ) : (
          <div className="workflow-list">
            {deployedWorkflows.map((workflow) => (
              <div key={workflow.name} className="workflow-list-item">
                <div className="workflow-list-left">
                  <div className={getStatusDotClass(workflow.scheduleStatus)} />
                  <div className="workflow-list-info">
                    <div className="workflow-list-name">
                      {workflow.name}
                      {workflow.scheduleStatus === 'paused' && (
                        <span className="workflow-paused-badge">(paused)</span>
                      )}
                    </div>
                    <div className="workflow-list-meta">
                      <span className="workflow-last-run">
                        Last run: {formatRelativeTime(workflow.lastRun)}
                        {workflow.lastStatus && (
                          <span className={`run-status-indicator ${workflow.lastStatus}`}>
                            {workflow.lastStatus === 'success' ? ' • Success' : ' • Failed'}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="workflow-list-right">
                  <div className="workflow-trigger-info">
                    <span className="trigger-icon">{getTriggerIcon(workflow.triggerType)}</span>
                    <span className="trigger-schedule">
                      {workflow.scheduleStatus === 'active' && workflow.nextRun
                        ? `Next: ${formatNextRun(workflow.nextRun)}`
                        : workflow.triggerType?.startsWith('github')
                          ? 'Listening'
                          : workflow.scheduleStatus === 'paused'
                            ? 'Paused'
                            : 'Manual'}
                    </span>
                  </div>
                  <div className="workflow-actions">
                    {workflow.scheduleStatus === 'paused' ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleResumeWorkflow(workflow.name)}
                      >
                        Resume
                      </button>
                    ) : (
                      <>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleRunWorkflow(workflow.name)}
                          disabled={runningWorkflow === workflow.name}
                        >
                          {runningWorkflow === workflow.name ? 'Running...' : 'Run Now'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handlePauseWorkflow(workflow.name)}
                        >
                          Pause
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Runs Section */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Recent Runs</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('runs')}>
            View All
          </button>
        </div>

        {recentRuns.length === 0 ? (
          <div className="empty-state small">
            <p>No recent runs yet</p>
          </div>
        ) : (
          <div className="recent-runs-list">
            {recentRuns.map((run) => (
              <div key={run.id} className="recent-run-item">
                <div className={`run-status-icon ${run.status}`}>
                  {run.status === 'success' ? '✓' : run.status === 'failed' ? '✗' : '⏳'}
                </div>
                <div className="recent-run-info">
                  <span className="recent-run-workflow">{run.workflow}</span>
                  <span className="recent-run-time">{formatRelativeTime(run.startedAt)}</span>
                </div>
                <div className="recent-run-duration">{formatDuration(run.duration)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Quick Actions</h2>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => onNavigate('builder')}>
            <span>+</span> New Workflow
          </button>
          <button className="btn btn-secondary" onClick={() => onNavigate('workflows')}>
            <span>📋</span> All Workflows
          </button>
          <button className="btn btn-secondary" onClick={() => onNavigate('settings')}>
            <span>⚙️</span> Settings
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => window.open('https://github.com/AIMC-Inc/weavr#readme', '_blank')}
          >
            <span>📖</span> Documentation
          </button>
        </div>
      </div>
    </div>
  );
}
