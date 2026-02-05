import { useState, useMemo } from 'react';
import { IntegrationIcon } from './IntegrationIcon';

interface ActionSchema {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: string;
}

interface NodeLibraryProps {
  actionSchemas: ActionSchema[];
  triggerSchemas: ActionSchema[];
  onSelectAction: (schema: ActionSchema) => void;
  onSelectTrigger: (schema: ActionSchema) => void;
  hasTrigger: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function NodeLibrary({
  actionSchemas,
  triggerSchemas,
  onSelectAction,
  onSelectTrigger,
  hasTrigger,
  collapsed,
  onToggleCollapsed,
}: NodeLibraryProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'triggers' | 'actions'>('actions');

  const filteredActions = useMemo(() => {
    if (!search) return actionSchemas;
    const lower = search.toLowerCase();
    return actionSchemas.filter(
      s => s.label.toLowerCase().includes(lower) || s.description.toLowerCase().includes(lower)
    );
  }, [actionSchemas, search]);

  const filteredTriggers = useMemo(() => {
    if (!search) return triggerSchemas;
    const lower = search.toLowerCase();
    return triggerSchemas.filter(
      s => s.label.toLowerCase().includes(lower) || s.description.toLowerCase().includes(lower)
    );
  }, [triggerSchemas, search]);

  const groupedItems = useMemo(() => {
    const items = activeTab === 'triggers' ? filteredTriggers : filteredActions;
    const groups: Record<string, ActionSchema[]> = {};
    for (const item of items) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return groups;
  }, [activeTab, filteredTriggers, filteredActions]);

  if (collapsed) {
    return (
      <div
        style={{
          width: '48px',
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 0',
        }}
      >
        <button
          className="btn btn-ghost"
          onClick={onToggleCollapsed}
          style={{ padding: '8px', marginBottom: '12px' }}
          title="Expand node library"
        >
          <span style={{ fontSize: '16px' }}>→</span>
        </button>
        <div
          style={{
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            fontSize: '12px',
            color: 'var(--text-muted)',
            letterSpacing: '1px',
          }}
        >
          NODES
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '240px',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600 }}>Node Library</span>
        <button
          className="btn btn-ghost"
          onClick={onToggleCollapsed}
          style={{ padding: '4px 8px' }}
          title="Collapse"
        >
          <span style={{ fontSize: '14px' }}>←</span>
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 12px' }}>
        <input
          type="text"
          className="input"
          placeholder="Search nodes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ fontSize: '12px', padding: '6px 10px' }}
        />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-color)',
          padding: '0 12px',
        }}
      >
        {!hasTrigger && (
          <button
            onClick={() => setActiveTab('triggers')}
            style={{
              flex: 1,
              padding: '8px',
              fontSize: '12px',
              fontWeight: 500,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'triggers' ? '2px solid var(--accent-yellow)' : '2px solid transparent',
              color: activeTab === 'triggers' ? 'var(--accent-yellow)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            ⚡ Triggers
          </button>
        )}
        <button
          onClick={() => setActiveTab('actions')}
          style={{
            flex: 1,
            padding: '8px',
            fontSize: '12px',
            fontWeight: 500,
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'actions' ? '2px solid var(--accent-purple)' : '2px solid transparent',
            color: activeTab === 'actions' ? 'var(--accent-purple)' : 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          ➕ Actions
        </button>
      </div>

      {/* Node List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
        {Object.entries(groupedItems).map(([category, items]) => (
          <div key={category} style={{ marginBottom: '12px' }}>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                padding: '4px 8px',
                marginBottom: '4px',
              }}
            >
              {category}
            </div>
            {items.map(schema => (
              <button
                key={schema.id}
                onClick={() =>
                  activeTab === 'triggers' ? onSelectTrigger(schema) : onSelectAction(schema)
                }
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('application/json', JSON.stringify({
                    type: activeTab === 'triggers' ? 'trigger' : 'step',
                    schema,
                  }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'grab',
                  textAlign: 'left',
                  marginBottom: '4px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = activeTab === 'triggers' ? 'var(--accent-yellow)' : 'var(--accent-purple)';
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.background = 'var(--bg-primary)';
                }}
              >
                <IntegrationIcon name={schema.icon} size={16} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 500, color: '#fff' }}>
                    {schema.label}
                  </div>
                  <div
                    style={{
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {schema.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ))}

        {Object.keys(groupedItems).length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              padding: '20px',
              fontSize: '12px',
            }}
          >
            No nodes found
          </div>
        )}
      </div>

      {/* Help text */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border-color)',
          fontSize: '10px',
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        Click or drag nodes to add them
      </div>
    </div>
  );
}
