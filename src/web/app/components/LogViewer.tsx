import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug' | 'success';
  message: string;
  workflow?: string;
  stepId?: string;
  runId?: string;
}

interface LogViewerProps {
  workflowFilter?: string;
  maxEntries?: number;
}

export function LogViewer({ workflowFilter, maxEntries = 500 }: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const processedIds = useRef<Set<string>>(new Set());
  const { messages } = useWebSocket();

  // Add incoming messages as logs
  useEffect(() => {
    const newLogs: LogEntry[] = [];

    for (const msg of messages) {
      // Generate a unique ID for deduplication
      const msgId = msg.id ?? `${msg.type}-${msg.timestamp}-${JSON.stringify(msg.payload).slice(0, 50)}`;

      // Skip already processed messages
      if (processedIds.current.has(msgId)) continue;
      processedIds.current.add(msgId);

      // Process workflow and step messages
      if (msg.type.startsWith('workflow.') || msg.type.startsWith('step.') || msg.type.startsWith('plugin')) {
        const payload = msg.payload as Record<string, unknown>;

        // Determine the log level
        let level: LogEntry['level'] = 'info';
        if (msg.type.includes('error') || msg.type.includes('failed')) {
          level = 'error';
        } else if (msg.type.includes('success') || msg.type.includes('completed')) {
          level = 'success';
        } else if (msg.type.includes('warn')) {
          level = 'warn';
        }

        // Extract the actual message - handle different payload structures
        let message: string;
        if (msg.type === 'step.log' && typeof payload.message === 'string') {
          // step.log messages have the actual log in payload.message
          message = payload.message;
        } else if (typeof payload.message === 'string') {
          message = payload.message;
        } else if (msg.type === 'workflow.started') {
          message = `Workflow started: ${payload.workflow ?? payload.runId ?? 'unknown'}`;
        } else if (msg.type === 'workflow.completed') {
          message = `Workflow completed: ${payload.workflow ?? payload.runId ?? 'unknown'}`;
        } else if (msg.type === 'step.started') {
          message = `Step started: ${payload.stepId ?? 'unknown'}`;
        } else if (msg.type === 'step.completed') {
          const status = payload.status ?? 'completed';
          const duration = payload.duration ? ` (${payload.duration}ms)` : '';
          message = `Step ${status}${duration}`;
        } else {
          // Fallback: show type and simplified payload
          const simplified = Object.entries(payload)
            .filter(([k]) => !['runId', 'timestamp'].includes(k))
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
            .join(', ');
          message = simplified || msg.type;
        }

        const entry: LogEntry = {
          id: msgId,
          timestamp: new Date(msg.timestamp ?? Date.now()),
          level,
          message,
          workflow: (payload.workflow ?? payload.workflowName) as string | undefined,
          stepId: payload.stepId as string | undefined,
          runId: payload.runId as string | undefined,
        };

        newLogs.push(entry);
      }
    }

    if (newLogs.length > 0) {
      setLogs((prev) => [...prev, ...newLogs].slice(-maxEntries));
    }
  }, [messages, maxEntries]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((log) => {
    // Filter by workflow if specified (but don't filter out logs without workflow)
    if (workflowFilter && log.workflow && log.workflow !== workflowFilter) return false;
    if (levelFilter !== 'all' && log.level !== levelFilter) return false;
    if (filter && !log.message.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const levelColors: Record<string, string> = {
    info: 'var(--accent-blue)',
    warn: 'var(--accent-yellow)',
    error: 'var(--accent-red)',
    debug: 'var(--text-muted)',
    success: 'var(--accent-green)',
  };

  const levelLabels: Record<string, string> = {
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR',
    debug: 'DEBUG',
    success: 'OK',
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
          <option value="success">Success</option>
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
        <button className="btn btn-ghost" onClick={() => {
          setLogs([]);
          processedIds.current.clear();
        }}>
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
            No logs yet. Run a workflow to see real-time logs here.
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
                alignItems: 'flex-start',
              }}
            >
              <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {formatTime(log.timestamp)}
              </span>
              <span
                style={{
                  color: levelColors[log.level],
                  width: '45px',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  fontSize: '11px',
                  flexShrink: 0,
                }}
              >
                {levelLabels[log.level]}
              </span>
              {log.stepId && (
                <span style={{
                  color: 'var(--accent-purple)',
                  flexShrink: 0,
                  background: 'var(--bg-secondary)',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                }}>
                  {log.stepId}
                </span>
              )}
              <span style={{ color: 'var(--text-primary)', flex: 1, wordBreak: 'break-word' }}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Status bar */}
      <div style={{
        marginTop: '8px',
        fontSize: '11px',
        color: 'var(--text-muted)',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>{filteredLogs.length} logs shown</span>
        <span>{logs.length} total</span>
      </div>
    </div>
  );
}
