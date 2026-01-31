import { PluginBrowser } from '../components/PluginBrowser';

export function Plugins() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Plugins</h1>
          <p className="page-subtitle">Browse and manage integrations</p>
        </div>
      </div>
      <div style={{ height: 'calc(100vh - 180px)' }}>
        <PluginBrowser />
      </div>
    </div>
  );
}
