import { useState, useCallback, ReactNode } from 'react';

export type ContextPanelTab = 'properties' | 'memory' | 'yaml' | 'ai';

interface ContextPanelProps {
  activeTab: ContextPanelTab;
  onTabChange: (tab: ContextPanelTab) => void;
  propertiesContent: ReactNode;
  memoryContent: ReactNode;
  yamlContent: ReactNode;
  aiContent: ReactNode;
  hasSelectedNode: boolean;
  chatMessageCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function ContextPanel({
  activeTab,
  onTabChange,
  propertiesContent,
  memoryContent,
  yamlContent,
  aiContent,
  hasSelectedNode,
  chatMessageCount,
  collapsed,
  onToggleCollapsed,
}: ContextPanelProps) {
  if (collapsed) {
    return (
      <div
        style={{
          width: '48px',
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 0',
          gap: '8px',
        }}
      >
        <button
          className="btn btn-ghost"
          onClick={onToggleCollapsed}
          style={{ padding: '8px', marginBottom: '8px' }}
          title="Expand panel"
        >
          <span style={{ fontSize: '16px' }}>←</span>
        </button>

        <TabButton
          icon="⚙️"
          active={activeTab === 'properties'}
          onClick={() => {
            onToggleCollapsed();
            onTabChange('properties');
          }}
          title="Properties"
          badge={hasSelectedNode ? '1' : undefined}
        />
        <TabButton
          icon="🧠"
          active={activeTab === 'memory'}
          onClick={() => {
            onToggleCollapsed();
            onTabChange('memory');
          }}
          title="Memory"
        />
        <TabButton
          icon="📄"
          active={activeTab === 'yaml'}
          onClick={() => {
            onToggleCollapsed();
            onTabChange('yaml');
          }}
          title="YAML"
        />
        <TabButton
          icon="✨"
          active={activeTab === 'ai'}
          onClick={() => {
            onToggleCollapsed();
            onTabChange('ai');
          }}
          title="AI Assistant"
          badge={chatMessageCount > 0 ? String(chatMessageCount) : undefined}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: '400px',
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Tab Bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
        }}
      >
        <TabHeader
          label="Properties"
          icon="⚙️"
          active={activeTab === 'properties'}
          onClick={() => onTabChange('properties')}
          badge={hasSelectedNode ? '•' : undefined}
        />
        <TabHeader
          label="Memory"
          icon="🧠"
          active={activeTab === 'memory'}
          onClick={() => onTabChange('memory')}
        />
        <TabHeader
          label="YAML"
          icon="📄"
          active={activeTab === 'yaml'}
          onClick={() => onTabChange('yaml')}
        />
        <TabHeader
          label="AI"
          icon="✨"
          active={activeTab === 'ai'}
          onClick={() => onTabChange('ai')}
          badge={chatMessageCount > 0 ? String(chatMessageCount) : undefined}
        />
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-ghost"
          onClick={onToggleCollapsed}
          style={{ padding: '8px', alignSelf: 'center', marginRight: '4px' }}
          title="Collapse panel"
        >
          <span style={{ fontSize: '14px' }}>→</span>
        </button>
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'properties' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
            {propertiesContent}
          </div>
        )}
        {activeTab === 'memory' && (
          <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
            {memoryContent}
          </div>
        )}
        {activeTab === 'yaml' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {yamlContent}
          </div>
        )}
        {activeTab === 'ai' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {aiContent}
          </div>
        )}
      </div>
    </div>
  );
}

function TabHeader({
  label,
  icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '10px 12px',
        fontSize: '12px',
        fontWeight: 500,
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent-purple)' : '2px solid transparent',
        color: active ? '#fff' : 'var(--text-muted)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
      }}
    >
      <span style={{ fontSize: '14px' }}>{icon}</span>
      <span>{label}</span>
      {badge && (
        <span
          style={{
            background: 'var(--accent-purple)',
            color: 'white',
            fontSize: '10px',
            padding: '1px 5px',
            borderRadius: '10px',
            minWidth: '16px',
            textAlign: 'center',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function TabButton({
  icon,
  active,
  onClick,
  title,
  badge,
}: {
  icon: string;
  active: boolean;
  onClick: () => void;
  title: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '36px',
        height: '36px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '16px',
        background: active ? 'var(--bg-hover)' : 'transparent',
        border: active ? '1px solid var(--accent-purple)' : '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        position: 'relative',
      }}
      title={title}
    >
      {icon}
      {badge && (
        <span
          style={{
            position: 'absolute',
            top: '-2px',
            right: '-2px',
            background: 'var(--accent-purple)',
            color: 'white',
            fontSize: '9px',
            padding: '1px 4px',
            borderRadius: '8px',
            minWidth: '14px',
            textAlign: 'center',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// Default properties content when no node is selected
export function DefaultPropertiesContent({
  onAddTrigger,
  onAddAction,
  onOpenAI,
  hasTrigger,
  hasNodes,
}: {
  onAddTrigger: () => void;
  onAddAction: () => void;
  onOpenAI: () => void;
  hasTrigger: boolean;
  hasNodes: boolean;
}) {
  return (
    <div>
      <h3 style={{ fontSize: '14px', marginBottom: '16px' }}>Getting Started</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {!hasTrigger && (
          <ActionButton
            icon="⚡"
            title="Add a Trigger"
            description="Start your workflow"
            onClick={onAddTrigger}
          />
        )}
        <ActionButton
          icon="➕"
          title="Add an Action"
          description="HTTP, Slack, AI, etc."
          onClick={onAddAction}
        />
        <ActionButton
          icon="✨"
          title="Generate with AI"
          description="Describe what you want"
          onClick={onOpenAI}
          ghost
        />
      </div>

      {hasNodes && (
        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Click on a node to edit its properties
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon,
  title,
  description,
  onClick,
  ghost,
}: {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
  ghost?: boolean;
}) {
  return (
    <button
      className={ghost ? 'btn btn-ghost' : 'btn btn-secondary'}
      onClick={onClick}
      style={{
        justifyContent: 'flex-start',
        padding: '12px 16px',
        textAlign: 'left',
      }}
    >
      <span style={{ marginRight: '10px', fontSize: '16px' }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{description}</div>
      </div>
    </button>
  );
}
