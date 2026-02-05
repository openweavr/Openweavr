import { useState, useCallback, useMemo } from 'react';

type MemorySourceType = 'text' | 'file' | 'url' | 'web_search' | 'step' | 'trigger';

interface MemorySourceInput {
  id?: string;
  label?: string;
  type: MemorySourceType;
  text?: string;
  path?: string;
  url?: string;
  query?: string;
  step?: string;
  maxResults?: number;
  maxChars?: number;
}

interface MemoryBlockInput {
  id: string;
  description?: string;
  sources: MemorySourceInput[];
  template?: string;
  separator?: string;
  maxChars?: number;
  dedupe?: boolean;
}

interface MemoryBlockEditorProps {
  blocks: MemoryBlockInput[];
  onAddBlock: () => void;
  onUpdateBlock: (index: number, patch: Partial<MemoryBlockInput>) => void;
  onRemoveBlock: (index: number) => void;
  onAddSource: (blockIndex: number) => void;
  onUpdateSource: (blockIndex: number, sourceIndex: number, patch: Partial<MemorySourceInput>) => void;
  onRemoveSource: (blockIndex: number, sourceIndex: number) => void;
}

const SOURCE_TYPE_OPTIONS: Array<{ value: MemorySourceType; label: string; icon: string; description: string }> = [
  { value: 'text', label: 'Text', icon: '📝', description: 'Inline text or instructions you write directly' },
  { value: 'file', label: 'File', icon: '📄', description: 'Contents of a local file (e.g., docs/README.md)' },
  { value: 'url', label: 'URL', icon: '🌐', description: 'Fetch and extract content from a web page' },
  { value: 'web_search', label: 'Web Search', icon: '🔍', description: 'Search the web and include top results' },
  { value: 'step', label: 'Step Output', icon: '⚡', description: 'Output from a previous workflow step' },
  { value: 'trigger', label: 'Trigger Data', icon: '🎯', description: 'Data from the workflow trigger' },
];

export function MemoryBlockEditor({
  blocks,
  onAddBlock,
  onUpdateBlock,
  onRemoveBlock,
  onAddSource,
  onUpdateSource,
  onRemoveSource,
}: MemoryBlockEditorProps) {
  const [expandedBlock, setExpandedBlock] = useState<number | null>(blocks.length > 0 ? 0 : null);
  const [previewingBlock, setPreviewingBlock] = useState<number | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const handlePreviewBlock = useCallback(async (index: number) => {
    const block = blocks[index];
    if (!block) return;

    setPreviewingBlock(index);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewContent(null);

    try {
      const response = await fetch('/api/memory/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ block }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to preview');
      }

      const data = await response.json();
      setPreviewContent(data.content || '(empty)');
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }, [blocks]);

  const closePreview = useCallback(() => {
    setPreviewingBlock(null);
    setPreviewContent(null);
    setPreviewError(null);
  }, []);

  // Calculate total estimated chars
  const totalChars = useMemo(() => {
    let total = 0;
    for (const block of blocks) {
      for (const source of block.sources) {
        if (source.type === 'text' && source.text) {
          total += source.text.length;
        } else if (source.maxChars) {
          total += source.maxChars;
        } else {
          total += 5000; // Default estimate
        }
      }
    }
    return total;
  }, [blocks]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontSize: '14px', margin: 0 }}>Memory Blocks</h3>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Assemble context from files, URLs, and search results
          </div>
        </div>
        <button className="btn btn-secondary" onClick={onAddBlock} style={{ padding: '6px 12px', fontSize: '12px' }}>
          + Add Block
        </button>
      </div>

      {/* Summary */}
      {blocks.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '16px',
            padding: '8px 12px',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '11px',
          }}
        >
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Blocks: </span>
            <span style={{ color: 'var(--accent-purple)', fontWeight: 500 }}>{blocks.length}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Sources: </span>
            <span style={{ color: 'var(--accent-blue)', fontWeight: 500 }}>
              {blocks.reduce((sum, b) => sum + b.sources.length, 0)}
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Est. chars: </span>
            <span
              style={{
                color: totalChars > 50000 ? 'var(--accent-red)' : totalChars > 20000 ? 'var(--accent-yellow)' : 'var(--accent-green)',
                fontWeight: 500,
              }}
            >
              ~{(totalChars / 1000).toFixed(1)}k
            </span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {blocks.length === 0 && (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border-color)',
          }}
        >
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🧠</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            No memory blocks yet
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Memory blocks let you assemble context from multiple sources for AI agents
          </div>
          <button className="btn btn-secondary" onClick={onAddBlock} style={{ fontSize: '12px' }}>
            Create Memory Block
          </button>
        </div>
      )}

      {/* Blocks list */}
      {blocks.map((block, index) => (
        <BlockCard
          key={`${block.id}-${index}`}
          block={block}
          index={index}
          expanded={expandedBlock === index}
          onToggleExpand={() => setExpandedBlock(expandedBlock === index ? null : index)}
          onUpdate={(patch) => onUpdateBlock(index, patch)}
          onRemove={() => onRemoveBlock(index)}
          onAddSource={() => onAddSource(index)}
          onUpdateSource={(sourceIndex, patch) => onUpdateSource(index, sourceIndex, patch)}
          onRemoveSource={(sourceIndex) => onRemoveSource(index, sourceIndex)}
          onPreview={() => handlePreviewBlock(index)}
        />
      ))}

      {/* Preview modal */}
      {previewingBlock !== null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={closePreview}
        >
          <div
            className="card"
            style={{
              width: '600px',
              maxWidth: '90vw',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '16px' }}>
                Memory Block Preview: {blocks[previewingBlock]?.id}
              </h3>
              <button className="btn btn-ghost" onClick={closePreview}>
                ×
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
              {previewLoading && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                  Loading preview...
                </div>
              )}
              {previewError && (
                <div
                  style={{
                    padding: '12px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid var(--accent-red)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--accent-red)',
                  }}
                >
                  {previewError}
                </div>
              )}
              {previewContent && (
                <pre
                  style={{
                    background: 'var(--bg-primary)',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    margin: 0,
                  }}
                >
                  {previewContent}
                </pre>
              )}
            </div>
            {previewContent && (
              <div
                style={{
                  padding: '12px 16px',
                  borderTop: '1px solid var(--border-color)',
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                }}
              >
                {previewContent.length.toLocaleString()} characters
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BlockCard({
  block,
  index,
  expanded,
  onToggleExpand,
  onUpdate,
  onRemove,
  onAddSource,
  onUpdateSource,
  onRemoveSource,
  onPreview,
}: {
  block: MemoryBlockInput;
  index: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (patch: Partial<MemoryBlockInput>) => void;
  onRemove: () => void;
  onAddSource: () => void;
  onUpdateSource: (sourceIndex: number, patch: Partial<MemorySourceInput>) => void;
  onRemoveSource: (sourceIndex: number) => void;
  onPreview: () => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: expanded ? 'var(--bg-secondary)' : 'var(--bg-primary)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px',
          cursor: 'pointer',
        }}
        onClick={onToggleExpand}
      >
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {expanded ? '▼' : '▶'}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--accent-purple)' }}>
              {block.id || `block-${index + 1}`}
            </span>
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                background: 'var(--bg-tertiary)',
                borderRadius: '4px',
                color: 'var(--text-muted)',
              }}
            >
              {block.sources.length} source{block.sources.length !== 1 ? 's' : ''}
            </span>
          </div>
          {block.description && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {block.description}
            </div>
          )}
        </div>
        <button
          className="btn btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
          style={{ padding: '4px 8px', fontSize: '11px' }}
          title="Preview assembled content"
        >
          Preview
        </button>
        <button
          className="btn btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{ padding: '4px 8px', color: 'var(--accent-red)' }}
        >
          ×
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border-color)', marginTop: '-1px', paddingTop: '12px' }}>
          {/* Block settings */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Block ID *
              </label>
              <input
                className="input"
                value={block.id}
                onChange={(e) => onUpdate({ id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                placeholder="project-context"
                style={{ fontSize: '12px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Description
              </label>
              <input
                className="input"
                value={block.description ?? ''}
                onChange={(e) => onUpdate({ description: e.target.value })}
                placeholder="Short description"
                style={{ fontSize: '12px' }}
              />
            </div>
          </div>

          {/* Advanced settings */}
          <details style={{ marginBottom: '16px' }}>
            <summary style={{ fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '8px' }}>
              Advanced Settings
            </summary>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', paddingLeft: '8px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Separator
                </label>
                <input
                  className="input"
                  value={block.separator ?? ''}
                  onChange={(e) => onUpdate({ separator: e.target.value })}
                  placeholder="\n---\n"
                  style={{ fontSize: '12px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Max Chars
                </label>
                <input
                  type="number"
                  className="input"
                  value={block.maxChars ?? ''}
                  onChange={(e) => onUpdate({ maxChars: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="12000"
                  style={{ fontSize: '12px' }}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Template (optional)
                </label>
                <textarea
                  className="input"
                  value={block.template ?? ''}
                  onChange={(e) => onUpdate({ template: e.target.value })}
                  placeholder="Combine sources: {{ sources.docs }}\n\n{{ sources.web }}"
                  style={{ fontSize: '12px', minHeight: '60px' }}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={Boolean(block.dedupe)}
                  onChange={(e) => onUpdate({ dedupe: e.target.checked })}
                />
                <span style={{ fontSize: '12px' }}>Deduplicate content</span>
              </label>
            </div>
          </details>

          {/* Sources */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 500 }}>Sources</div>
            <button
              className="btn btn-ghost"
              onClick={onAddSource}
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              + Add Source
            </button>
          </div>

          {block.sources.length === 0 ? (
            <div
              style={{
                padding: '16px',
                textAlign: 'center',
                background: 'var(--bg-primary)',
                borderRadius: 'var(--radius-sm)',
                border: '1px dashed var(--border-color)',
                fontSize: '12px',
                color: 'var(--text-muted)',
              }}
            >
              No sources yet. Add a source to include content in this memory block.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {block.sources.map((source, sourceIndex) => (
                <SourceCard
                  key={`${source.type}-${sourceIndex}`}
                  source={source}
                  sourceIndex={sourceIndex}
                  onUpdate={(patch) => onUpdateSource(sourceIndex, patch)}
                  onRemove={() => onRemoveSource(sourceIndex)}
                />
              ))}
            </div>
          )}

          {/* Usage hint */}
          <div
            style={{
              marginTop: '12px',
              padding: '8px',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              color: 'var(--text-muted)',
            }}
          >
            <strong>Usage:</strong>{' '}
            <code style={{ color: 'var(--accent-purple)' }}>{'{{ memory.blocks.' + (block.id || 'block-id') + ' }}'}</code>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceCard({
  source,
  sourceIndex,
  onUpdate,
  onRemove,
}: {
  source: MemorySourceInput;
  sourceIndex: number;
  onUpdate: (patch: Partial<MemorySourceInput>) => void;
  onRemove: () => void;
}) {
  const typeInfo = SOURCE_TYPE_OPTIONS.find((t) => t.value === source.type);

  return (
    <div
      style={{
        padding: '10px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '14px' }} title={typeInfo?.description}>{typeInfo?.icon || '📄'}</span>
        <select
          className="input"
          value={source.type}
          onChange={(e) => onUpdate({ type: e.target.value as MemorySourceType })}
          style={{ flex: 1, fontSize: '12px', padding: '4px 8px' }}
          title={typeInfo?.description}
        >
          {SOURCE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} title={opt.description}>
              {opt.icon} {opt.label}
            </option>
          ))}
        </select>
        <button className="btn btn-ghost" onClick={onRemove} style={{ padding: '2px 6px', color: 'var(--accent-red)' }}>
          ×
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
        <input
          className="input"
          value={source.id ?? ''}
          onChange={(e) => onUpdate({ id: e.target.value })}
          placeholder="Source ID"
          style={{ fontSize: '11px', padding: '4px 8px' }}
        />
        <input
          className="input"
          value={source.label ?? ''}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Label (optional)"
          style={{ fontSize: '11px', padding: '4px 8px' }}
        />
      </div>

      {/* Type-specific fields */}
      {source.type === 'text' && (
        <textarea
          className="input"
          value={source.text ?? ''}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="Enter text content..."
          style={{ fontSize: '11px', minHeight: '60px' }}
        />
      )}

      {source.type === 'file' && (
        <input
          className="input"
          value={source.path ?? ''}
          onChange={(e) => onUpdate({ path: e.target.value })}
          placeholder="/path/to/file.md"
          style={{ fontSize: '11px' }}
        />
      )}

      {source.type === 'url' && (
        <input
          className="input"
          value={source.url ?? ''}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/docs"
          style={{ fontSize: '11px' }}
        />
      )}

      {source.type === 'web_search' && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            className="input"
            value={source.query ?? ''}
            onChange={(e) => onUpdate({ query: e.target.value })}
            placeholder="Search query"
            style={{ flex: 1, fontSize: '11px' }}
          />
          <input
            type="number"
            className="input"
            value={source.maxResults ?? ''}
            onChange={(e) => onUpdate({ maxResults: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Max results"
            style={{ width: '80px', fontSize: '11px' }}
          />
        </div>
      )}

      {source.type === 'step' && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            className="input"
            value={source.step ?? ''}
            onChange={(e) => onUpdate({ step: e.target.value })}
            placeholder="step-id"
            style={{ flex: 1, fontSize: '11px' }}
          />
          <input
            className="input"
            value={source.path ?? ''}
            onChange={(e) => onUpdate({ path: e.target.value })}
            placeholder="output.path"
            style={{ flex: 1, fontSize: '11px' }}
          />
        </div>
      )}

      {source.type === 'trigger' && (
        <input
          className="input"
          value={source.path ?? ''}
          onChange={(e) => onUpdate({ path: e.target.value })}
          placeholder="trigger.data.field"
          style={{ fontSize: '11px' }}
        />
      )}

      {/* Max chars */}
      <div style={{ marginTop: '8px' }}>
        <input
          type="number"
          className="input"
          value={source.maxChars ?? ''}
          onChange={(e) => onUpdate({ maxChars: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="Max chars (optional)"
          style={{ fontSize: '11px', width: '120px' }}
        />
      </div>
    </div>
  );
}
