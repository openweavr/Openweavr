import { useWebSocket } from '../hooks/useWebSocket';

type Page = 'dashboard' | 'workflows' | 'runs' | 'builder' | 'plugins' | 'logs' | 'settings';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: Page, workflowName?: string) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'workflows', label: 'Workflows', icon: '🔄' },
  { id: 'builder', label: 'Builder', icon: '🔧' },
  { id: 'runs', label: 'Run History', icon: '📜' },
  { id: 'logs', label: 'Live Logs', icon: '📋' },
  { id: 'plugins', label: 'Plugins', icon: '🔌' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
] as const;

export function Sidebar({ currentPage, onNavigate, collapsed = false, onToggleCollapsed }: SidebarProps) {
  const { connected } = useWebSocket();

  if (collapsed) {
    return (
      <aside
        className="sidebar"
        style={{
          width: '56px',
          minWidth: '56px',
          padding: '12px 8px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          {/* Expand button */}
          <button
            onClick={onToggleCollapsed}
            style={{
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              cursor: 'pointer',
              marginBottom: '8px',
            }}
            title="Expand sidebar"
          >
            <span style={{ fontSize: '16px' }}>→</span>
          </button>

          {/* Icon-only nav items */}
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id as typeof currentPage)}
              style={{
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: currentPage === item.id ? 'var(--bg-hover)' : 'transparent',
                border: currentPage === item.id ? '1px solid var(--accent-purple)' : '1px solid transparent',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '18px',
              }}
              title={item.label}
            >
              {item.icon}
            </button>
          ))}
        </div>

        {/* Status dot at bottom */}
        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center', paddingTop: '12px' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: connected ? 'var(--accent-green)' : 'var(--accent-red)',
            }}
            title={connected ? 'Gateway connected' : 'Disconnected'}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <svg className="logo-icon" viewBox="0 0 100 100" width="32" height="32">
            <defs>
              <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{stopColor:'#8B5CF6'}}/>
                <stop offset="100%" style={{stopColor:'#EC4899'}}/>
              </linearGradient>
            </defs>
            <rect x="8" y="8" width="84" height="84" rx="22" fill="url(#logoGrad)"/>
            <g transform="translate(50, 50)">
              <rect x="-28" y="-20" width="56" height="10" rx="5" fill="white" opacity="0.9"/>
              <rect x="-28" y="10" width="56" height="10" rx="5" fill="white" opacity="0.9"/>
              <rect x="-20" y="-28" width="10" height="18" rx="5" fill="white" opacity="0.6"/>
              <rect x="-20" y="0" width="10" height="10" rx="5" fill="white" opacity="0.9"/>
              <rect x="-20" y="20" width="10" height="8" rx="5" fill="white" opacity="0.6"/>
              <rect x="10" y="-28" width="10" height="10" rx="5" fill="white" opacity="0.9"/>
              <rect x="10" y="-8" width="10" height="18" rx="5" fill="white" opacity="0.6"/>
              <rect x="10" y="20" width="10" height="8" rx="5" fill="white" opacity="0.9"/>
            </g>
          </svg>
          <span>Openweavr</span>
        </div>
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 8px',
              color: 'var(--text-muted)',
              fontSize: '14px',
            }}
            title="Collapse sidebar"
          >
            ←
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <a
            key={item.id}
            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id as typeof currentPage)}
            href="#"
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        ))}
      </nav>

      <div className="status-indicator">
        <span className="status-dot" style={{ background: connected ? 'var(--accent-green)' : 'var(--accent-red)' }} />
        <span>{connected ? 'Gateway connected' : 'Disconnected'}</span>
      </div>
    </aside>
  );
}
