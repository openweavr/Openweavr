import { LogViewer } from '../components/LogViewer';

export function Logs() {
  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Live Logs</h1>
          <p className="page-subtitle">Real-time workflow execution logs</p>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <LogViewer />
      </div>
    </div>
  );
}
