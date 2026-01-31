import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  workflow?: string;
  stepId?: string;
}

interface LogViewerProps {
  workflowFilter?: string;
  maxEntries?: number;
}

export function LogViewer({ workflowFilter, maxEntries = 200 }: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const { messages } = useWebSocket();

  // Add incoming messages as logs
  useEffect(() => {
    for (const msg of messages) {
      if (msg.type.startsWith('workflow.') || msg.type.startsWith('step.')) {
        const payload = msg.payload as Record<string, unknown>;
        const entry: LogEntry = {
          id: msg.id ?? String(Date.now()),
          timestamp: new Date(msg.timestamp ?? Date.now()),
          level: msg.type.includes('error') || msg.type.includes('failed') ? 'error' : 'info',
          message: `[${msg.type}] ${JSON.stringify(payload)}`,
          workflow: payload.workflow as string,
          stepId: payload.stepId as string,
        };

        setLogs((prev) => [...prev.slice(-(maxEntries - 1)), entry]);
      }
    }
  }, [messages, maxEntries]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((log) => {
    if (workflowFilter && log.workflow !== workflowFilter) return false;
    if (levelFilter !== 'all' && log.level !== levelFilter) return false;
    if (filter && !log.message.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const levelColors: Record<string, string> = {
    info: 'var(--accent-blue)',
    warn: 'var(--accent-yellow)',
    error: 'var(--accent-red)',
    debug: 'var(--text-muted)',
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'center' }}>
        <input
          type="text"
          className="input"
          placeholder="Filter logs..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <select
          className="input"
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          style={{ width: '120px' }}
        >
          <option value="all">All Levels</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
          <option value="debug">Debug</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
        <button className="btn btn-ghost" onClick={() => setLogs([])}>
          Clear
        </button>
      </div>

      {/* Log entries */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '12px',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>
            No logs yet. Workflow events will appear here in real-time.
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              style={{
                display: 'flex',
                gap: '12px',
                padding: '4px 0',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {formatTime(log.timestamp)}
              </span>
              <span
                style={{
                  color: levelColors[log.level],
                  width: '50px',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                }}
              >
                {log.level}
              </span>
              {log.workflow && (
                <span style={{ color: 'var(--accent-purple)' }}>[{log.workflow}]</span>
              )}
              {log.stepId && (
                <span style={{ color: 'var(--accent-blue)' }}>{log.stepId}:</span>
              )}
              <span style={{ color: 'var(--text-primary)', flex: 1, wordBreak: 'break-all' }}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
