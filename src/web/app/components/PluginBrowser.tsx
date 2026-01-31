import { useState } from 'react';

interface Plugin {
  name: string;
  version: string;
  description: string;
  category: string;
  actions: string[];
  triggers: string[];
  status: 'builtin' | 'installed' | 'available';
  icon: string;
}

const PLUGINS: Plugin[] = [
  {
    name: 'http',
    version: '1.0.0',
    description: 'HTTP requests and webhook triggers',
    category: 'Core',
    actions: ['request', 'get', 'post'],
    triggers: ['webhook'],
    status: 'builtin',
    icon: '🌐',
  },
  {
    name: 'cron',
    version: '1.0.0',
    description: 'Scheduled triggers using cron expressions',
    category: 'Core',
    actions: ['wait', 'next'],
    triggers: ['schedule'],
    status: 'builtin',
    icon: '⏰',
  },
  {
    name: 'github',
    version: '1.0.0',
    description: 'GitHub integration for issues, PRs, and webhooks',
    category: 'DevTools',
    actions: ['create_issue', 'create_comment', 'create_pr', 'add_labels', 'list_issues'],
    triggers: ['push', 'pull_request', 'issue.opened', 'issue.labeled'],
    status: 'builtin',
    icon: '🐙',
  },
  {
    name: 'slack',
    version: '1.0.0',
    description: 'Slack messaging and notifications',
    category: 'Communication',
    actions: ['post', 'update', 'react', 'upload_file'],
    triggers: ['message', 'slash_command', 'reaction_added'],
    status: 'builtin',
    icon: '💬',
  },
  {
    name: 'discord',
    version: '1.0.0',
    description: 'Discord webhooks and embeds',
    category: 'Communication',
    actions: ['send', 'embed'],
    triggers: ['webhook'],
    status: 'builtin',
    icon: '🎮',
  },
  {
    name: 'linear',
    version: '1.0.0',
    description: 'Linear project management integration',
    category: 'DevTools',
    actions: ['create_issue', 'update_issue', 'add_comment', 'get_issue', 'list_issues'],
    triggers: ['issue.created', 'issue.updated'],
    status: 'builtin',
    icon: '📐',
  },
  {
    name: 'notion',
    version: '1.0.0',
    description: 'Notion pages and databases',
    category: 'Productivity',
    actions: ['create_page', 'update_page', 'get_page', 'query_database', 'append_block', 'search'],
    triggers: ['page.updated'],
    status: 'builtin',
    icon: '📝',
  },
  {
    name: 'email',
    version: '1.0.0',
    description: 'Send emails via SMTP or API',
    category: 'Communication',
    actions: ['send', 'send_template'],
    triggers: [],
    status: 'builtin',
    icon: '📧',
  },
  {
    name: 'ai',
    version: '1.0.0',
    description: 'AI/LLM actions for text processing',
    category: 'AI',
    actions: ['complete', 'summarize', 'extract', 'classify'],
    triggers: [],
    status: 'builtin',
    icon: '🤖',
  },
  {
    name: 'json',
    version: '1.0.0',
    description: 'JSON manipulation utilities',
    category: 'Utilities',
    actions: ['parse', 'stringify', 'get', 'set', 'merge', 'filter', 'map', 'sort'],
    triggers: [],
    status: 'builtin',
    icon: '{ }',
  },
];

const CATEGORIES = ['All', 'Core', 'DevTools', 'Communication', 'Productivity', 'AI', 'Utilities'];

export function PluginBrowser() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);

  const filteredPlugins = PLUGINS.filter((p) => {
    if (category !== 'All' && p.category !== category) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', gap: '24px', height: '100%' }}>
      {/* Plugin List */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Search and filters */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <input
            type="text"
            className="input"
            placeholder="Search plugins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>

        {/* Category tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`btn ${category === cat ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setCategory(cat)}
              style={{ padding: '6px 12px', fontSize: '13px' }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Plugin grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {filteredPlugins.map((plugin) => (
            <div
              key={plugin.name}
              onClick={() => setSelectedPlugin(plugin)}
              style={{
                padding: '16px',
                background: selectedPlugin?.name === plugin.name ? 'var(--bg-hover)' : 'var(--bg-secondary)',
                border: `1px solid ${selectedPlugin?.name === plugin.name ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                <span style={{ fontSize: '24px' }}>{plugin.icon}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{plugin.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>v{plugin.version}</div>
                </div>
                <span
                  className={`badge badge-${plugin.status === 'builtin' ? 'success' : plugin.status === 'installed' ? 'info' : 'warning'}`}
                  style={{ marginLeft: 'auto' }}
                >
                  {plugin.status}
                </span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                {plugin.description}
              </p>
              <div style={{ marginTop: '12px', display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>{plugin.actions.length} actions</span>
                {plugin.triggers.length > 0 && <span>• {plugin.triggers.length} triggers</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Plugin Details */}
      {selectedPlugin && (
        <div style={{ width: '320px' }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <span style={{ fontSize: '32px' }}>{selectedPlugin.icon}</span>
              <div>
                <h3 style={{ margin: 0 }}>{selectedPlugin.name}</h3>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>v{selectedPlugin.version}</div>
              </div>
            </div>

            <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
              {selectedPlugin.description}
            </p>

            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>Actions</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {selectedPlugin.actions.map((action) => (
                  <code
                    key={action}
                    style={{
                      padding: '4px 8px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12px',
                    }}
                  >
                    {selectedPlugin.name}.{action}
                  </code>
                ))}
              </div>
            </div>

            {selectedPlugin.triggers.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>Triggers</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {selectedPlugin.triggers.map((trigger) => (
                    <code
                      key={trigger}
                      style={{
                        padding: '4px 8px',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '12px',
                      }}
                    >
                      {selectedPlugin.name}.{trigger}
                    </code>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }}>
                📖 Docs
              </button>
              {selectedPlugin.status === 'available' && (
                <button className="btn btn-primary" style={{ flex: 1 }}>
                  Install
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
