import { useState, useEffect } from 'react';

interface Config {
  server: {
    port: number;
    host: string;
  };
  ai?: {
    provider?: string;
    model?: string;
  };
}

export function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real app, this would fetch from the API
    setConfig({
      server: { port: 3847, host: 'localhost' },
    });
    setLoading(false);
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure your Weavr instance</p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon">⏳</div>
          <div className="empty-title">Loading settings...</div>
        </div>
      ) : (
        <>
          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '20px' }}>Gateway Server</h2>

            <div style={{ display: 'grid', gap: '20px', maxWidth: '400px' }}>
              <div>
                <label className="label">Host</label>
                <input
                  type="text"
                  className="input"
                  value={config?.server.host ?? ''}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev ? { ...prev, server: { ...prev.server, host: e.target.value } } : null
                    )
                  }
                />
              </div>

              <div>
                <label className="label">Port</label>
                <input
                  type="number"
                  className="input"
                  value={config?.server.port ?? 3847}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev
                        ? { ...prev, server: { ...prev.server, port: parseInt(e.target.value) } }
                        : null
                    )
                  }
                />
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '20px' }}>AI Configuration</h2>

            <div style={{ display: 'grid', gap: '20px', maxWidth: '400px' }}>
              <div>
                <label className="label">Provider</label>
                <select
                  className="input"
                  value={config?.ai?.provider ?? ''}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev ? { ...prev, ai: { ...prev.ai, provider: e.target.value } } : null
                    )
                  }
                >
                  <option value="">None</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="ollama">Ollama (Local)</option>
                </select>
              </div>

              <div>
                <label className="label">API Key</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Enter your API key"
                />
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '20px' }}>Plugins</h2>

            <div style={{ display: 'grid', gap: '12px' }}>
              {[
                { name: 'http', version: '1.0.0', description: 'HTTP requests and webhooks', status: 'active' },
                { name: 'cron', version: '1.0.0', description: 'Scheduled triggers', status: 'active' },
                { name: 'github', version: '1.0.0', description: 'GitHub integration', status: 'active' },
                { name: 'slack', version: '1.0.0', description: 'Slack messaging', status: 'active' },
              ].map((plugin) => (
                <div
                  key={plugin.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {plugin.name}
                      <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '12px' }}>
                        v{plugin.version}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {plugin.description}
                    </div>
                  </div>
                  <span className="badge badge-success">{plugin.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
            <button className="btn btn-primary">Save Changes</button>
            <button className="btn btn-ghost">Reset to Defaults</button>
          </div>
        </>
      )}
    </div>
  );
}
