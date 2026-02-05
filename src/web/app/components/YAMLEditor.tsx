import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import YAML from 'yaml';

// YAML syntax highlighting function
function highlightYAML(code: string): string {
  if (!code) return '';

  const lines = code.split('\n');
  const highlightedLines = lines.map(line => {
    // Escape HTML first
    let escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Comment (entire line starting with #, or inline after content)
    if (/^\s*#/.test(escaped)) {
      return `<span class="yaml-comment">${escaped}</span>`;
    }

    // Handle inline comments
    const commentMatch = escaped.match(/^(.+?)(\s*#.*)$/);
    let mainPart = escaped;
    let commentPart = '';
    if (commentMatch) {
      mainPart = commentMatch[1];
      commentPart = `<span class="yaml-comment">${commentMatch[2]}</span>`;
    }

    // Key-value pairs
    const kvMatch = mainPart.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*|"[^"]+"|'[^']+')\s*(:)(.*)$/);
    if (kvMatch) {
      const [, indent, key, colon, valuePart] = kvMatch;
      const highlightedValue = highlightValue(valuePart);
      return `${indent}<span class="yaml-key">${key}</span><span class="yaml-colon">${colon}</span>${highlightedValue}${commentPart}`;
    }

    // Array items (lines starting with -)
    const arrayMatch = mainPart.match(/^(\s*)(-)(\s*)(.*)$/);
    if (arrayMatch) {
      const [, indent, dash, space, rest] = arrayMatch;
      // Check if it's a key-value after the dash
      const restKvMatch = rest.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*(:)(.*)$/);
      if (restKvMatch) {
        const [, key, colon, valuePart] = restKvMatch;
        const highlightedValue = highlightValue(valuePart);
        return `${indent}<span class="yaml-dash">${dash}</span>${space}<span class="yaml-key">${key}</span><span class="yaml-colon">${colon}</span>${highlightedValue}${commentPart}`;
      }
      return `${indent}<span class="yaml-dash">${dash}</span>${space}${highlightValue(rest)}${commentPart}`;
    }

    return mainPart + commentPart;
  });

  return highlightedLines.join('\n');
}

function highlightValue(value: string): string {
  if (!value || !value.trim()) return value;

  const trimmed = value.trim();
  const leadingSpace = value.match(/^(\s*)/)?.[1] || '';

  // Null
  if (trimmed === 'null' || trimmed === '~') {
    return `${leadingSpace}<span class="yaml-null">${trimmed}</span>`;
  }

  // Boolean
  if (/^(true|false|yes|no|on|off)$/i.test(trimmed)) {
    return `${leadingSpace}<span class="yaml-boolean">${trimmed}</span>`;
  }

  // Number
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed) || /^0x[0-9a-fA-F]+$/.test(trimmed)) {
    return `${leadingSpace}<span class="yaml-number">${trimmed}</span>`;
  }

  // Double-quoted string
  if (/^".*"$/.test(trimmed)) {
    return `${leadingSpace}<span class="yaml-string">${trimmed}</span>`;
  }

  // Single-quoted string
  if (/^'.*'$/.test(trimmed)) {
    return `${leadingSpace}<span class="yaml-string">${trimmed}</span>`;
  }

  // Block scalar indicators
  if (/^[|>][+-]?$/.test(trimmed)) {
    return `${leadingSpace}<span class="yaml-scalar">${trimmed}</span>`;
  }

  // Anchor and alias
  if (/^&\w+/.test(trimmed)) {
    return `${leadingSpace}<span class="yaml-anchor">${trimmed}</span>`;
  }
  if (/^\*\w+/.test(trimmed)) {
    return `${leadingSpace}<span class="yaml-alias">${trimmed}</span>`;
  }

  // Arrays inline [...]
  if (/^\[.*\]$/.test(trimmed)) {
    return `${leadingSpace}<span class="yaml-array">${trimmed}</span>`;
  }

  // Objects inline {...}
  if (/^\{.*\}$/.test(trimmed)) {
    return `${leadingSpace}<span class="yaml-object">${trimmed}</span>`;
  }

  // Template variables {{ ... }}
  const templateHighlighted = value.replace(
    /(\{\{[^}]+\}\})/g,
    '<span class="yaml-template">$1</span>'
  );
  if (templateHighlighted !== value) {
    return templateHighlighted;
  }

  // Plain string (unquoted)
  return `${leadingSpace}<span class="yaml-string-plain">${trimmed}</span>`;
}

interface ValidationError {
  line: number;
  message: string;
  severity?: 'error' | 'warning';
}

interface ServerValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

interface YAMLEditorProps {
  value: string;
  onChange: (yaml: string) => void;
  onValidationChange?: (errors: ValidationError[]) => void;
  readOnly?: boolean;
}

export function YAMLEditor({ value, onChange, onValidationChange, readOnly = false }: YAMLEditorProps) {
  const [localValue, setLocalValue] = useState(value);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [warnings, setWarnings] = useState<ValidationError[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const validationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Memoized syntax highlighted code
  const highlightedCode = useMemo(() => highlightYAML(localValue), [localValue]);

  // Sync scroll between textarea and highlighted pre
  const handleScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current && lineNumbersRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  // Sync external value changes (but not if we have local edits)
  useEffect(() => {
    if (!isDirty) {
      setLocalValue(value);
    }
  }, [value, isDirty]);

  // Quick local validation for immediate feedback
  const quickValidate = useCallback((yaml: string): ValidationError[] => {
    const validationErrors: ValidationError[] = [];

    if (!yaml.trim()) {
      return validationErrors;
    }

    try {
      const parsed = YAML.parse(yaml);

      // Check for required fields
      if (!parsed) {
        validationErrors.push({ line: 1, message: 'Empty or invalid YAML', severity: 'error' });
      } else {
        if (!parsed.name) {
          validationErrors.push({ line: 1, message: 'Missing required field: name', severity: 'error' });
        }
        if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
          validationErrors.push({ line: 1, message: 'Workflow must have at least one step', severity: 'error' });
        }

        // Validate steps
        if (Array.isArray(parsed.steps)) {
          parsed.steps.forEach((step: { id?: string; action?: string }, index: number) => {
            if (!step.id) {
              validationErrors.push({
                line: 1,
                message: `Step ${index + 1}: Missing required field 'id'`,
                severity: 'error',
              });
            }
            if (!step.action) {
              validationErrors.push({
                line: 1,
                message: `Step ${index + 1}: Missing required field 'action'`,
                severity: 'error',
              });
            }
          });
        }

        // Validate trigger if present
        if (parsed.trigger && !parsed.trigger.type) {
          validationErrors.push({ line: 1, message: 'Trigger missing required field: type', severity: 'error' });
        }
      }
    } catch (err) {
      const yamlError = err as { mark?: { line?: number }; message?: string };
      const line = yamlError.mark?.line ?? 1;
      const message = yamlError.message ?? 'Invalid YAML syntax';
      validationErrors.push({ line, message, severity: 'error' });
    }

    return validationErrors;
  }, []);

  // Server-side validation for comprehensive checks (action/trigger validity, variable references)
  const serverValidate = useCallback(async (yaml: string): Promise<{ errors: ValidationError[]; warnings: ValidationError[] }> => {
    if (!yaml.trim()) {
      return { errors: [], warnings: [] };
    }

    try {
      const response = await fetch('/api/workflows/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml }),
      });

      if (!response.ok) {
        return { errors: [], warnings: [] };
      }

      const result = await response.json() as {
        valid: boolean;
        errors: ServerValidationError[];
        warnings: ServerValidationError[];
      };

      // Convert server errors to our format
      const errors: ValidationError[] = (result.errors || []).map(err => ({
        line: 1, // Server doesn't track line numbers, use 1
        message: err.path ? `${err.path}: ${err.message}` : err.message,
        severity: 'error' as const,
      }));

      const warnings: ValidationError[] = (result.warnings || []).map(warn => ({
        line: 1,
        message: warn.path ? `${warn.path}: ${warn.message}` : warn.message,
        severity: 'warning' as const,
      }));

      return { errors, warnings };
    } catch {
      // Silently fail server validation - don't block the user
      return { errors: [], warnings: [] };
    }
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);
      setIsDirty(true);

      // Quick local validation for immediate feedback
      const quickErrors = quickValidate(newValue);
      setErrors(quickErrors);
      onValidationChange?.(quickErrors);

      // Debounced server validation for comprehensive checks
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }

      if (quickErrors.length === 0 && newValue.trim()) {
        validationTimeoutRef.current = setTimeout(async () => {
          setIsValidating(true);
          const { errors: serverErrors, warnings: serverWarnings } = await serverValidate(newValue);
          setIsValidating(false);

          // Only add server errors if they're not duplicates
          if (serverErrors.length > 0) {
            setErrors(prev => {
              const existingMessages = new Set(prev.map(e => e.message));
              const newErrors = serverErrors.filter(e => !existingMessages.has(e.message));
              return [...prev, ...newErrors];
            });
            onValidationChange?.([...quickErrors, ...serverErrors]);
          }
          setWarnings(serverWarnings);
        }, 500); // 500ms debounce
      } else {
        setWarnings([]);
      }
    },
    [quickValidate, serverValidate, onValidationChange]
  );

  const handleBlur = useCallback(() => {
    if (isDirty && errors.length === 0) {
      onChange(localValue);
      setIsDirty(false);
    }
  }, [isDirty, errors.length, localValue, onChange]);

  const handleApply = useCallback(() => {
    if (errors.length === 0) {
      onChange(localValue);
      setIsDirty(false);
    }
  }, [errors.length, localValue, onChange]);

  const handleReset = useCallback(() => {
    setLocalValue(value);
    setIsDirty(false);
    setErrors([]);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab key for indentation
      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        if (e.shiftKey) {
          // Remove indentation
          const lines = localValue.split('\n');
          let charCount = 0;
          let newValue = '';
          let newStart = start;
          let newEnd = end;

          for (let i = 0; i < lines.length; i++) {
            const lineStart = charCount;
            const lineEnd = charCount + lines[i].length;

            if (lineEnd >= start && lineStart <= end) {
              // This line is in selection
              if (lines[i].startsWith('  ')) {
                lines[i] = lines[i].slice(2);
                if (lineStart < start) {
                  newStart = Math.max(start - 2, lineStart);
                }
                newEnd -= 2;
              }
            }
            charCount = lineEnd + 1;
          }

          newValue = lines.join('\n');
          setLocalValue(newValue);

          // Restore selection
          setTimeout(() => {
            textarea.selectionStart = newStart;
            textarea.selectionEnd = Math.max(newStart, newEnd);
          }, 0);
        } else {
          // Add indentation
          if (start === end) {
            // No selection, just insert spaces
            const newValue = localValue.slice(0, start) + '  ' + localValue.slice(end);
            setLocalValue(newValue);
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = start + 2;
            }, 0);
          } else {
            // Indent selected lines
            const lines = localValue.split('\n');
            let charCount = 0;
            let newStart = start;
            let newEnd = end;

            for (let i = 0; i < lines.length; i++) {
              const lineStart = charCount;
              const lineEnd = charCount + lines[i].length;

              if (lineEnd >= start && lineStart <= end) {
                lines[i] = '  ' + lines[i];
                if (lineStart <= start) {
                  newStart += 2;
                }
                newEnd += 2;
              }
              charCount = lineEnd + 1;
            }

            const newValue = lines.join('\n');
            setLocalValue(newValue);

            setTimeout(() => {
              textarea.selectionStart = newStart;
              textarea.selectionEnd = newEnd;
            }, 0);
          }
        }

        setIsDirty(true);
        const validationErrors = quickValidate(localValue);
        setErrors(validationErrors);
      }

      // Cmd/Ctrl+S to apply changes
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleApply();
      }
    },
    [localValue, quickValidate, handleApply]
  );

  // Count lines for line numbers
  const lineCount = localValue.split('\n').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
        }}
      >
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{lineCount} line{lineCount !== 1 ? 's' : ''}</span>
          {isValidating && (
            <span style={{ color: 'var(--text-muted)' }}>Validating...</span>
          )}
          {isDirty && !isValidating && (
            <span style={{ color: 'var(--accent-yellow)' }}>• Unsaved</span>
          )}
          {errors.length === 0 && warnings.length > 0 && (
            <span style={{ color: 'var(--accent-yellow)' }}>
              {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isDirty && (
            <>
              <button
                className="btn btn-ghost"
                onClick={handleReset}
                style={{ padding: '4px 8px', fontSize: '11px' }}
              >
                Reset
              </button>
              <button
                className="btn btn-primary"
                onClick={handleApply}
                disabled={errors.length > 0}
                style={{ padding: '4px 12px', fontSize: '11px' }}
              >
                Apply Changes
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error display */}
      {errors.length > 0 && (
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderBottom: '1px solid var(--accent-red)',
          }}
        >
          {errors.map((error, i) => (
            <div
              key={i}
              style={{
                fontSize: '12px',
                color: 'var(--accent-red)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ fontWeight: 600 }}>Line {error.line}:</span>
              <span>{error.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Warning display */}
      {errors.length === 0 && warnings.length > 0 && (
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(251, 191, 36, 0.1)',
            borderBottom: '1px solid var(--accent-yellow)',
          }}
        >
          {warnings.map((warning, i) => (
            <div
              key={i}
              style={{
                fontSize: '12px',
                color: 'var(--accent-yellow)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ fontWeight: 600 }}>Warning:</span>
              <span>{warning.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Line numbers */}
        <div
          ref={lineNumbersRef}
          style={{
            width: '40px',
            background: 'var(--bg-tertiary)',
            borderRight: '1px solid var(--border-color)',
            overflow: 'hidden',
            paddingTop: '12px',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              lineHeight: '1.5',
              color: 'var(--text-muted)',
              textAlign: 'right',
              paddingRight: '8px',
              whiteSpace: 'pre',
            }}
          >
            {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
          </div>
        </div>

        {/* Editor container with highlighting */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Syntax highlighted pre (behind textarea) */}
          <pre
            ref={highlightRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              padding: '12px',
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              lineHeight: '1.5',
              background: 'var(--bg-primary)',
              color: 'var(--text-muted)',
              border: 'none',
              overflow: 'auto',
              whiteSpace: 'pre',
              wordWrap: 'normal',
              pointerEvents: 'none',
            }}
            dangerouslySetInnerHTML={{ __html: highlightedCode + '\n' }}
          />

          {/* Transparent textarea for editing */}
          <textarea
            ref={textareaRef}
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            readOnly={readOnly}
            spellCheck={false}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              padding: '12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              lineHeight: '1.5',
              background: 'transparent',
              color: 'transparent',
              caretColor: '#fff',
              border: 'none',
              resize: 'none',
              outline: 'none',
              overflow: 'auto',
              whiteSpace: 'pre',
              wordWrap: 'normal',
            }}
            placeholder="# Your workflow YAML will appear here
name: my-workflow

trigger:
  type: cron.schedule
  with:
    expression: '0 9 * * *'

steps:
  - id: example
    action: http.get
    with:
      url: https://api.example.com"
          />
        </div>
      </div>

      {/* Syntax highlighting styles */}
      <style>{`
        .yaml-key { color: #7dd3fc; }
        .yaml-colon { color: #94a3b8; }
        .yaml-string { color: #86efac; }
        .yaml-string-plain { color: #e2e8f0; }
        .yaml-number { color: #fbbf24; }
        .yaml-boolean { color: #c4b5fd; }
        .yaml-null { color: #f87171; }
        .yaml-comment { color: #64748b; font-style: italic; }
        .yaml-dash { color: #f472b6; }
        .yaml-anchor { color: #fb923c; }
        .yaml-alias { color: #fb923c; }
        .yaml-template { color: #a78bfa; background: rgba(167, 139, 250, 0.15); border-radius: 2px; padding: 0 2px; }
        .yaml-array { color: #94a3b8; }
        .yaml-object { color: #94a3b8; }
        .yaml-scalar { color: #f472b6; }
      `}</style>

      {/* Help */}
      <div
        style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
          fontSize: '10px',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Tab to indent • Shift+Tab to outdent</span>
        <span>Cmd/Ctrl+S to apply</span>
      </div>
    </div>
  );
}

// Simplified read-only YAML viewer
export function YAMLViewer({ value }: { value: string }) {
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px' }}>
      <pre
        style={{
          background: 'var(--bg-primary)',
          padding: '12px',
          borderRadius: '6px',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'pre-wrap',
          margin: 0,
          lineHeight: '1.5',
        }}
      >
        {value}
      </pre>
    </div>
  );
}
