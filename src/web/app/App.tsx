import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Onboarding } from './components/Onboarding';
import { Dashboard } from './pages/Dashboard';
import { Workflows } from './pages/Workflows';
import { Runs } from './pages/Runs';
import { Builder } from './pages/Builder';
import { Plugins } from './pages/Plugins';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';

type Page = 'dashboard' | 'workflows' | 'runs' | 'builder' | 'plugins' | 'logs' | 'settings';

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [checkingConfig, setCheckingConfig] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<string | null>(null);
  const [runsWorkflowFilter, setRunsWorkflowFilter] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    // Check URL params for forced onboarding
    const urlParams = new URLSearchParams(window.location.search);
    const forceOnboard = urlParams.get('onboard') === 'true';

    // Check if user has completed onboarding
    fetch('/api/config/status')
      .then((res) => res.json())
      .then((data) => {
        setNeedsOnboarding(forceOnboard || !data.configured);
        setCheckingConfig(false);
        // Clean up URL param after reading it
        if (forceOnboard) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      })
      .catch(() => {
        // If we can't check, assume configured unless forced
        setNeedsOnboarding(forceOnboard);
        setCheckingConfig(false);
      });
  }, []);

  const handleOnboardingComplete = () => {
    setNeedsOnboarding(false);
  };

  const handleNavigate = (page: Page, workflowName?: string) => {
    setCurrentPage(page);
    if (page === 'builder') {
      setEditingWorkflow(workflowName ?? null);
      setRunsWorkflowFilter(null);
      // Auto-collapse sidebar when entering builder for more canvas space
      setSidebarCollapsed(true);
    } else if (page === 'runs') {
      setEditingWorkflow(null);
      setRunsWorkflowFilter(workflowName ?? null);
    } else {
      setEditingWorkflow(null);
      setRunsWorkflowFilter(null);
    }
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onNavigate={handleNavigate} />;
      case 'workflows':
        return <Workflows onNavigate={handleNavigate} />;
      case 'runs':
        return <Runs workflowFilter={runsWorkflowFilter} onClearFilter={() => setRunsWorkflowFilter(null)} />;
      case 'builder':
        return <Builder workflowName={editingWorkflow} onNavigate={handleNavigate} />;
      case 'plugins':
        return <Plugins />;
      case 'logs':
        return <Logs />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard onNavigate={handleNavigate} />;
    }
  };

  // Show loading while checking config
  if (checkingConfig) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg-primary)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🧵</div>
          <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
        </div>
      </div>
    );
  }

  // Show onboarding if needed
  if (needsOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="app">
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}
