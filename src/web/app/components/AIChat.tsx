import { useState, useCallback, useRef, useEffect } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  toolStatus?: 'running' | 'completed' | 'error';
}

interface AIChatProps {
  onClose: () => void;
  onGenerateWorkflow: (yaml: string) => void;
}

// Simple markdown-like rendering for code blocks and formatting
function renderContent(content: string) {
  // Split by code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      // Extract language and code
      const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
      if (match) {
        const [, lang, code] = match;
        return (
          <pre
            key={i}
            style={{
              background: 'var(--bg-primary)',
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              overflow: 'auto',
              fontSize: '13px',
              margin: '8px 0',
              border: '1px solid var(--border-color)',
            }}
          >
            {lang && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                {lang}
              </div>
            )}
            <code>{code.trim()}</code>
          </pre>
        );
      }
    }

    // Render regular text with basic formatting
    return (
      <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
        {part.split('\n').map((line, j) => {
          // Bold text
          const boldParts = line.split(/\*\*(.*?)\*\*/g);
          const formattedLine = boldParts.map((p, k) =>
            k % 2 === 1 ? <strong key={k}>{p}</strong> : p
          );

          // List items
          if (line.trim().startsWith('- ') || line.trim().match(/^\d+\./)) {
            return (
              <div key={j} style={{ paddingLeft: '16px', marginBottom: '4px' }}>
                {formattedLine}
              </div>
            );
          }

          return (
            <span key={j}>
              {formattedLine}
              {j < line.length - 1 && '\n'}
            </span>
          );
        })}
      </span>
    );
  });
}

export function AIChat({ onClose, onGenerateWorkflow }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [planReady, setPlanReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);
    setStreamingContent('');

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          sessionId,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to send message');
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';
      let currentSessionId = sessionId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            if (event.sessionId && !currentSessionId) {
              currentSessionId = event.sessionId;
              setSessionId(event.sessionId);
            }

            if (event.type === 'delta') {
              fullContent += event.content || '';
              setStreamingContent(fullContent);
            } else if (event.type === 'tool_start') {
              // Add tool message
              const toolMsg: ChatMessage = {
                id: `tool-${Date.now()}`,
                role: 'tool',
                content: `Using ${event.toolName}...`,
                timestamp: Date.now(),
                toolName: event.toolName,
                toolStatus: 'running',
              };
              setMessages(prev => [...prev, toolMsg]);
            } else if (event.type === 'tool_end') {
              // Update tool message status
              setMessages(prev => prev.map(m =>
                m.toolName === event.toolName && m.toolStatus === 'running'
                  ? { ...m, content: event.result || `${event.toolName} completed`, toolStatus: 'completed' as const }
                  : m
              ));
            } else if (event.type === 'plan_ready') {
              setPlanReady(true);
            } else if (event.type === 'error') {
              setError(event.error);
            }
          } catch {
            // Ignore parse errors for incomplete chunks
          }
        }
      }

      // Add final assistant message
      if (fullContent) {
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: fullContent,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMessage]);
        setStreamingContent('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, sessionId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const handleGenerateWorkflow = useCallback(async () => {
    if (!sessionId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/chat/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to generate workflow');
      }

      const data = await response.json();
      if (data.yaml) {
        onGenerateWorkflow(data.yaml);
      } else {
        throw new Error('No workflow generated');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate workflow');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, onGenerateWorkflow]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: '680px',
          maxWidth: '90vw',
          height: '80vh',
          maxHeight: '700px',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h3 style={{ marginBottom: '4px' }}>AI Workflow Assistant</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
              Describe your workflow and I'll help you build it
            </p>
          </div>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            style={{ padding: '8px' }}
          >
            <span style={{ fontSize: '18px' }}>&times;</span>
          </button>
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {messages.length === 0 && !streamingContent && (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>💡</div>
              <div style={{ fontSize: '15px', marginBottom: '8px' }}>
                Tell me what you want to automate
              </div>
              <div style={{ fontSize: '13px' }}>
                I'll research, plan, and help you build the perfect workflow
              </div>
              <div
                style={{
                  marginTop: '24px',
                  padding: '16px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px', color: 'var(--text-secondary)' }}>
                  Example prompts:
                </div>
                <ul style={{ fontSize: '12px', color: 'var(--text-muted)', paddingLeft: '16px', margin: 0, listStyle: 'disc' }}>
                  <li style={{ marginBottom: '6px' }}>
                    Monitor my GitHub repo and summarize new issues in Slack
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    Every morning, fetch the weather and send me a notification
                  </li>
                  <li>
                    When a file changes in my folder, back it up to another location
                  </li>
                </ul>
              </div>
            </div>
          )}

          {messages.map(message => (
            <div
              key={message.id}
              style={{
                display: 'flex',
                flexDirection: message.role === 'user' ? 'row-reverse' : 'row',
                gap: '12px',
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: message.role === 'user'
                    ? 'var(--accent-purple)'
                    : message.role === 'tool'
                    ? 'var(--accent-blue)'
                    : 'var(--gradient-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  flexShrink: 0,
                }}
              >
                {message.role === 'user' ? '👤' : message.role === 'tool' ? '🔧' : '✨'}
              </div>

              {/* Content */}
              <div
                style={{
                  maxWidth: '85%',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  background: message.role === 'user'
                    ? 'var(--accent-purple)'
                    : message.role === 'tool'
                    ? 'var(--bg-tertiary)'
                    : 'var(--bg-secondary)',
                  border: message.role !== 'user' ? '1px solid var(--border-color)' : 'none',
                  fontSize: '14px',
                  lineHeight: '1.5',
                }}
              >
                {message.role === 'tool' && message.toolStatus === 'running' && (
                  <span
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: 'var(--accent-blue)',
                      marginRight: '8px',
                      animation: 'pulse 1s ease-in-out infinite',
                    }}
                  />
                )}
                {renderContent(message.content)}
              </div>
            </div>
          ))}

          {/* Streaming content */}
          {streamingContent && (
            <div style={{ display: 'flex', gap: '12px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'var(--gradient-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  flexShrink: 0,
                }}
              >
                ✨
              </div>
              <div
                style={{
                  maxWidth: '85%',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  fontSize: '14px',
                  lineHeight: '1.5',
                }}
              >
                {renderContent(streamingContent)}
                <span
                  style={{
                    display: 'inline-block',
                    width: '6px',
                    height: '14px',
                    background: 'var(--accent-purple)',
                    marginLeft: '2px',
                    animation: 'blink 1s step-end infinite',
                  }}
                />
              </div>
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && !streamingContent && (
            <div style={{ display: 'flex', gap: '12px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'var(--gradient-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  flexShrink: 0,
                }}
              >
                ✨
              </div>
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  fontSize: '14px',
                  color: 'var(--text-muted)',
                }}
              >
                Thinking...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error display */}
        {error && (
          <div
            style={{
              margin: '0 20px',
              padding: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid var(--accent-red)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--accent-red)',
              fontSize: '13px',
            }}
          >
            {error}
          </div>
        )}

        {/* Generate workflow button */}
        {planReady && (
          <div
            style={{
              margin: '12px 20px 0',
              padding: '12px',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid var(--accent-green)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontWeight: 500, color: 'var(--accent-green)', marginBottom: '2px' }}>
                Plan Ready!
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Generate the workflow when you're satisfied with the plan
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleGenerateWorkflow}
              disabled={isLoading}
            >
              Generate Workflow
            </button>
          </div>
        )}

        {/* Input */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            gap: '12px',
          }}
        >
          <textarea
            ref={inputRef}
            className="input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your workflow or ask questions..."
            disabled={isLoading}
            style={{
              flex: 1,
              minHeight: '44px',
              maxHeight: '120px',
              resize: 'none',
              fontSize: '14px',
            }}
            rows={1}
          />
          <button
            className="btn btn-primary"
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            style={{ alignSelf: 'flex-end' }}
          >
            Send
          </button>
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
