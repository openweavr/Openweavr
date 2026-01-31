import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
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

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onNavigate={setCurrentPage} />;
      case 'workflows':
        return <Workflows onNavigate={setCurrentPage} />;
      case 'runs':
        return <Runs />;
      case 'builder':
        return <Builder />;
      case 'plugins':
        return <Plugins />;
      case 'logs':
        return <Logs />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="app">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}
