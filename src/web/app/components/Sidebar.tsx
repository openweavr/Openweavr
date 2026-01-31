import { useWebSocket } from '../hooks/useWebSocket';

type Page = 'dashboard' | 'workflows' | 'runs' | 'builder' | 'plugins' | 'logs' | 'settings';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: Page, workflowName?: string) => void;
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

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { connected } = useWebSocket();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-icon">🧵</span>
          <span>Weavr</span>
        </div>
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
