import { useState, useCallback, useRef, useEffect } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  toolStatus?: 'running' | 'completed' | 'error';
}

interface AIChatPanelProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  onWorkflowGenerated: (yaml: string) => void;
}

// Simple markdown-like rendering for code blocks and formatting
function renderContent(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, i) => {
    if (part.startsWith('```')) {
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
              fontSize: '12px',
              margin: '8px 0',
              border: '1px solid var(--border-color)',
            }}
          >
            {lang && (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                {lang}
              </div>
            )}
            <code>{code.trim()}</code>
          </pre>
        );
      }
    }

    return (
      <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
        {part.split('\n').map((line, j) => {
          const boldParts = line.split(/\*\*(.*?)\*\*/g);
          const formattedLine = boldParts.map((p, k) =>
            k % 2 === 1 ? <strong key={k}>{p}</strong> : p
          );

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

export function AIChatPanel({
  messages,
  setMessages,
  sessionId,
  setSessionId,
  onWorkflowGenerated,
}: AIChatPanelProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [planReady, setPlanReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedSessionId = localStorage.getItem('weavr-chat-session-id');
    if (savedSessionId && !sessionId && messages.length === 0) {
      // Try to restore the session from the server
      fetch(`/api/ai/chat/session/${savedSessionId}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.messages?.length > 0) {
            setSessionId(savedSessionId);
            // Convert server messages to ChatMessage format
            const restoredMessages: ChatMessage[] = data.messages.map((m: { role: 'user' | 'assistant' | 'tool'; content: string; toolName?: string; timestamp: number }, i: number) => ({
              id: `restored-${i}`,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
              toolName: m.toolName,
              toolStatus: m.role === 'tool' ? 'completed' as const : undefined,
            }));
            setMessages(restoredMessages);
            if (data.session?.planReady) {
              setPlanReady(true);
            }
          } else {
            // Session doesn't exist or has no messages, clear the stored ID
            localStorage.removeItem('weavr-chat-session-id');
          }
        })
        .catch(() => {
          // Session doesn't exist, clear the stored ID
          localStorage.removeItem('weavr-chat-session-id');
        });
    }
  }, []);

  // Save session ID to localStorage when it changes
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('weavr-chat-session-id', sessionId);
    }
  }, [sessionId]);

  // Check if plan is ready on mount (for restored sessions)
  useEffect(() => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) {
      const hasYaml = /```ya?ml\s*\n[\s\S]*?(?:trigger|steps):/i.test(lastAssistant.content);
      if (hasYaml) {
        setPlanReady(true);
      }
    }
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
              setMessages(prev =>
                prev.map(m =>
                  m.toolName === event.toolName && m.toolStatus === 'running'
                    ? { ...m, content: event.result || `${event.toolName} completed`, toolStatus: 'completed' as const }
                    : m
                )
              );
            } else if (event.type === 'plan_ready') {
              setPlanReady(true);
            } else if (event.type === 'error') {
              setError(event.error);
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      if (fullContent) {
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: fullContent,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMessage]);
        setStreamingContent('');

        const hasYaml = /```ya?ml\s*\n[\s\S]*?(?:trigger|steps):/i.test(fullContent);
        if (hasYaml && !planReady) {
          setPlanReady(true);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, sessionId, setMessages, setSessionId, planReady]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  const handleGenerateWorkflow = useCallback(async () => {
    if (!sessionId) return;

    setIsGenerating(true);
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
        onWorkflowGenerated(data.yaml);
      } else {
        throw new Error('No workflow generated');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate workflow');
    } finally {
      setIsGenerating(false);
    }
  }, [sessionId, onWorkflowGenerated]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setPlanReady(false);
    setError(null);
    setStreamingContent('');
    localStorage.removeItem('weavr-chat-session-id');
  }, [setMessages, setSessionId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-primary)',
        }}
      >
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {messages.length > 0 ? `${messages.filter(m => m.role !== 'tool').length} messages` : 'New conversation'}
        </div>
        {messages.length > 0 && (
          <button className="btn btn-ghost" onClick={handleNewChat} style={{ padding: '4px 8px', fontSize: '11px' }}>
            New Chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {messages.length === 0 && !streamingContent && (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>💡</div>
            <div style={{ fontSize: '13px', marginBottom: '4px' }}>Describe your workflow</div>
            <div style={{ fontSize: '11px' }}>I'll help you build it step by step</div>

            <div
              style={{
                marginTop: '16px',
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: '10px', fontWeight: 500, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                Examples:
              </div>
              <ul style={{ fontSize: '11px', color: 'var(--text-muted)', paddingLeft: '14px', margin: 0, lineHeight: 1.6 }}>
                <li>Daily digest of GitHub issues</li>
                <li>Summarize news and send to Slack</li>
                <li>Monitor file changes and notify</li>
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
              gap: '8px',
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background:
                  message.role === 'user'
                    ? 'var(--accent-purple)'
                    : message.role === 'tool'
                    ? 'var(--accent-blue)'
                    : 'var(--gradient-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                flexShrink: 0,
              }}
            >
              {message.role === 'user' ? '👤' : message.role === 'tool' ? '🔧' : '✨'}
            </div>

            <div
              style={{
                maxWidth: '90%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                background:
                  message.role === 'user'
                    ? 'var(--accent-purple)'
                    : message.role === 'tool'
                    ? 'var(--bg-tertiary)'
                    : 'var(--bg-primary)',
                border: message.role !== 'user' ? '1px solid var(--border-color)' : 'none',
                fontSize: '13px',
                lineHeight: '1.4',
              }}
            >
              {message.role === 'tool' && message.toolStatus === 'running' && (
                <span
                  style={{
                    display: 'inline-block',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: 'var(--accent-blue)',
                    marginRight: '6px',
                    animation: 'pulse 1s ease-in-out infinite',
                  }}
                />
              )}
              {renderContent(message.content)}
            </div>
          </div>
        ))}

        {streamingContent && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: 'var(--gradient-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                flexShrink: 0,
              }}
            >
              ✨
            </div>
            <div
              style={{
                maxWidth: '90%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                fontSize: '13px',
                lineHeight: '1.4',
              }}
            >
              {renderContent(streamingContent)}
              <span
                style={{
                  display: 'inline-block',
                  width: '4px',
                  height: '12px',
                  background: 'var(--accent-purple)',
                  marginLeft: '2px',
                  animation: 'blink 1s step-end infinite',
                }}
              />
            </div>
          </div>
        )}

        {isLoading && !streamingContent && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: 'var(--gradient-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                flexShrink: 0,
              }}
            >
              ✨
            </div>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                fontSize: '13px',
                color: 'var(--text-muted)',
              }}
            >
              Thinking...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            margin: '0 12px',
            padding: '8px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid var(--accent-red)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--accent-red)',
            fontSize: '12px',
          }}
        >
          {error}
        </div>
      )}

      {/* Generate button */}
      {planReady && (
        <div
          style={{
            margin: '8px 12px 0',
            padding: '8px',
            background: isGenerating ? 'rgba(99, 102, 241, 0.1)' : 'rgba(16, 185, 129, 0.1)',
            border: `1px solid ${isGenerating ? 'var(--accent-purple)' : 'var(--accent-green)'}`,
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '11px', color: isGenerating ? 'var(--accent-purple)' : 'var(--accent-green)' }}>
            {isGenerating ? 'Generating...' : 'Ready to generate'}
          </div>
          <button
            className="btn btn-primary"
            onClick={handleGenerateWorkflow}
            disabled={isGenerating || isLoading}
            style={{ padding: '4px 12px', fontSize: '11px' }}
          >
            {isGenerating ? '...' : 'Generate'}
          </button>
        </div>
      )}

      {/* Input */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-end',
        }}
      >
        <textarea
          ref={inputRef}
          className="input"
          value={input}
          onChange={e => {
            setInput(e.target.value);
            // Auto-expand textarea
            if (inputRef.current) {
              inputRef.current.style.height = 'auto';
              inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Describe your workflow..."
          disabled={isLoading}
          style={{
            flex: 1,
            minHeight: '36px',
            maxHeight: '120px',
            resize: 'none',
            fontSize: '12px',
            padding: '8px 10px',
            lineHeight: '1.4',
          }}
          rows={1}
        />
        <button
          className="btn btn-primary"
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
          style={{ padding: '8px 12px', fontSize: '12px' }}
        >
          Send
        </button>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
