import { useState, useEffect } from 'react';

// Models that support OAuth (ChatGPT backend API via Codex)
const OAUTH_SUPPORTED_MODELS = ['gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5.2', 'gpt-5.1', 'gpt-5-codex'];

// Check if a model supports OAuth
const isOAuthSupportedModel = (model: string | undefined): boolean => {
  if (!model) return false;
  return OAUTH_SUPPORTED_MODELS.includes(model);
};

interface Config {
  server: {
    port: number;
    host: string;
  };
  ai?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    hasApiKey?: boolean;
    authMethod?: 'apikey' | 'oauth';
    hasOAuth?: boolean;
  };
  webSearch?: {
    provider?: string;
    apiKey?: string;
    hasApiKey?: boolean;
  };
  messaging?: {
    telegram?: {
      botToken?: string;
      hasBotToken?: boolean;
      chatId?: string;
    };
    whatsapp?: {
      connected?: boolean;
      phoneNumber?: string;
    };
    imessage?: {
      available?: boolean;
    };
  };
}

export function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Web Search state
  const [braveApiKey, setBraveApiKey] = useState('');
  const [showBraveApiKey, setShowBraveApiKey] = useState(false);

  // OpenAI OAuth state
  const [oauthConnected, setOauthConnected] = useState(false);
  const [oauthConnecting, setOauthConnecting] = useState(false);

  // Messaging state
  const [telegramToken, setTelegramToken] = useState('');
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [whatsappQR, setWhatsappQR] = useState<string | null>(null);
  const [whatsappConnecting, setWhatsappConnecting] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        setConfig(data.config);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load config:', err);
        setLoading(false);
      });

    // Check WhatsApp connection status
    fetch('/api/messaging/whatsapp/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.connected) {
          setWhatsappStatus('connected');
        }
      })
      .catch(() => {
        // WhatsApp API may not be available
      });

    // Check OpenAI OAuth status
    fetch('/api/oauth/openai/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.connected) {
          setOauthConnected(true);
        }
      })
      .catch(() => {
        // OAuth API may not be available
      });
  }, []);

  // Listen for OAuth popup messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'oauth-success') {
        setOauthConnected(true);
        setOauthConnecting(false);
        setMessage({ type: 'success', text: 'Connected to OpenAI via OAuth!' });
        // Reload config
        fetch('/api/config')
          .then((res) => res.json())
          .then((data) => setConfig(data.config));
      } else if (event.data?.type === 'oauth-error') {
        setOauthConnecting(false);
        setMessage({ type: 'error', text: event.data.error ?? 'OAuth authentication failed' });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // WebSocket for WhatsApp QR code updates
  useEffect(() => {
    if (!whatsappConnecting) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'whatsapp:qr') {
          setWhatsappQR(msg.payload.qr);
        } else if (msg.type === 'whatsapp:connected') {
          setWhatsappStatus('connected');
          setWhatsappConnecting(false);
          setWhatsappQR(null);
          setMessage({ type: 'success', text: 'WhatsApp connected successfully!' });
        } else if (msg.type === 'whatsapp:disconnected') {
          setWhatsappStatus('disconnected');
          setWhatsappConnecting(false);
          setWhatsappQR(null);
        }
      } catch (e) {
        // Ignore non-JSON messages
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', payload: { channel: 'whatsapp' } }));
    };

    return () => ws.close();
  }, [whatsappConnecting]);

  const handleSave = async () => {
    if (!config) return;

    setSaving(true);
    setMessage(null);

    try {
      const saveConfig = {
        ...config,
        ai: config.ai?.provider ? {
          ...config.ai,
          apiKey: apiKey || undefined,
        } : undefined,
        webSearch: braveApiKey ? {
          provider: 'brave',
          apiKey: braveApiKey,
        } : config.webSearch,
        messaging: {
          ...config.messaging,
          telegram: (telegramToken || telegramChatId) ? {
            ...config.messaging?.telegram,
            ...(telegramToken ? { botToken: telegramToken } : {}),
            ...(telegramChatId ? { chatId: telegramChatId } : {}),
          } : config.messaging?.telegram,
        },
      };

      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: saveConfig }),
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Settings saved successfully!' });
        setApiKey(''); // Clear the API key field after saving
        setBraveApiKey(''); // Clear the Brave API key field after saving
        setTelegramToken(''); // Clear the telegram token field after saving
        setTelegramChatId(''); // Clear the telegram chat ID field after saving
        // Reload config to get updated hasApiKey status
        const reloadRes = await fetch('/api/config');
        const reloadData = await reloadRes.json();
        setConfig(reloadData.config);
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error ?? 'Failed to save settings' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error: Could not save settings' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleProviderChange = (provider: string) => {
    setConfig((prev) =>
      prev ? {
        ...prev,
        ai: provider ? { provider, model: getDefaultModel(provider) } : undefined
      } : null
    );
    setApiKey(''); // Reset API key when changing provider
  };

  const getDefaultModel = (provider: string): string => {
    switch (provider) {
      case 'anthropic': return 'claude-sonnet-4-20250514';
      case 'openai': return 'gpt-5.2-codex'; // Default to OAuth-compatible model
      case 'ollama': return 'llama3.2';
      default: return '';
    }
  };

  const getApiKeyPlaceholder = (): string => {
    if (config?.ai?.hasApiKey) {
      return 'API key is set (enter new key to change)';
    }
    switch (config?.ai?.provider) {
      case 'anthropic': return 'sk-ant-...';
      case 'openai': return 'sk-...';
      default: return 'Enter your API key';
    }
  };

  const canUseOAuth = config?.ai?.provider === 'openai' && isOAuthSupportedModel(config?.ai?.model);
  const isOpenAIWithOAuth = config?.ai?.provider === 'openai' && config?.ai?.authMethod === 'oauth';
  const needsApiKey = config?.ai?.provider && config.ai.provider !== 'ollama' && !(isOpenAIWithOAuth && canUseOAuth);

  const handleOAuthConnect = async () => {
    setOauthConnecting(true);
    try {
      const response = await fetch('/api/oauth/openai/authorize');
      const data = await response.json() as { authUrl?: string; error?: string };

      if (data.authUrl) {
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        window.open(
          data.authUrl,
          'openai-oauth',
          `width=${width},height=${height},left=${left},top=${top},popup=yes`
        );
      } else {
        setMessage({ type: 'error', text: data.error ?? 'Failed to start OAuth flow' });
        setOauthConnecting(false);
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error: Could not start OAuth flow' });
      setOauthConnecting(false);
    }
  };

  const handleOAuthDisconnect = async () => {
    try {
      const response = await fetch('/api/oauth/openai/disconnect', { method: 'POST' });
      if (response.ok) {
        setOauthConnected(false);
        setConfig((prev) =>
          prev ? {
            ...prev,
            ai: prev.ai ? { ...prev.ai, authMethod: undefined } : undefined
          } : null
        );
        setMessage({ type: 'success', text: 'Disconnected from OpenAI OAuth' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to disconnect OAuth' });
    }
  };

  const handleWhatsAppConnect = async () => {
    setWhatsappConnecting(true);
    setWhatsappStatus('connecting');
    try {
      await fetch('/api/messaging/whatsapp/connect', { method: 'POST' });
    } catch (err) {
      console.error('Failed to initiate WhatsApp connection:', err);
      setWhatsappConnecting(false);
      setWhatsappStatus('disconnected');
      setMessage({ type: 'error', text: 'Failed to connect to WhatsApp' });
    }
  };

  const handleWhatsAppDisconnect = async () => {
    try {
      await fetch('/api/messaging/whatsapp/disconnect', { method: 'POST' });
      setWhatsappStatus('disconnected');
      setWhatsappQR(null);
      setMessage({ type: 'success', text: 'WhatsApp disconnected' });
    } catch (err) {
      console.error('Failed to disconnect WhatsApp:', err);
      setMessage({ type: 'error', text: 'Failed to disconnect WhatsApp' });
    }
  };

  const isMacOS = navigator.platform.toLowerCase().includes('mac');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure your Openweavr instance</p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon">...</div>
          <div className="empty-title">Loading settings...</div>
        </div>
      ) : (
        <>
          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '20px' }}>Gateway Server</h2>

            <div style={{ display: 'grid', gap: '20px', maxWidth: '400px' }}>
              <div>
                <label className="label">Host</label>
                <input
                  type="text"
                  className="input"
                  value={config?.server.host ?? ''}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev ? { ...prev, server: { ...prev.server, host: e.target.value } } : null
                    )
                  }
                />
              </div>

              <div>
                <label className="label">Port</label>
                <input
                  type="number"
                  className="input"
                  value={config?.server.port ?? 3847}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev
                        ? { ...prev, server: { ...prev.server, port: parseInt(e.target.value) } }
                        : null
                    )
                  }
                />
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '20px' }}>AI Configuration</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Configure an AI provider to enable workflow generation and AI-powered actions.
            </p>

            <div style={{ display: 'grid', gap: '20px', maxWidth: '400px' }}>
              <div>
                <label className="label">Provider</label>
                <select
                  className="input"
                  value={config?.ai?.provider ?? ''}
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  <option value="">None</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="ollama">Ollama (Local)</option>
                </select>
              </div>

              {config?.ai?.provider && (
                <div>
                  <label className="label">Model</label>
                  <select
                    className="input"
                    value={config?.ai?.model ?? ''}
                    onChange={(e) =>
                      setConfig((prev) =>
                        prev ? { ...prev, ai: { ...prev.ai, model: e.target.value } } : null
                      )
                    }
                  >
                    {config.ai.provider === 'anthropic' && (
                      <>
                        <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                        <option value="claude-opus-4-20250514">Claude Opus 4</option>
                        <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
                      </>
                    )}
                    {config.ai.provider === 'openai' && (
                      <>
                        <optgroup label="ChatGPT OAuth (Plus/Pro subscription)">
                          <option value="gpt-5.2-codex">GPT-5.2 Codex (Latest)</option>
                          <option value="gpt-5.1-codex">GPT-5.1 Codex</option>
                          <option value="gpt-5.2">GPT-5.2</option>
                          <option value="gpt-5.1">GPT-5.1</option>
                        </optgroup>
                        <optgroup label="API Key Required">
                          <option value="gpt-4o">GPT-4o</option>
                          <option value="gpt-4o-mini">GPT-4o Mini</option>
                          <option value="gpt-4-turbo">GPT-4 Turbo</option>
                          <option value="o1-preview">o1 Preview</option>
                          <option value="o1-mini">o1 Mini</option>
                        </optgroup>
                      </>
                    )}
                    {config.ai.provider === 'ollama' && (
                      <>
                        <option value="llama3.2">Llama 3.2</option>
                        <option value="mistral">Mistral</option>
                        <option value="codellama">Code Llama</option>
                      </>
                    )}
                  </select>
                </div>
              )}

              {needsApiKey && (
                <div>
                  <label className="label">
                    API Key
                    {config?.ai?.hasApiKey && (
                      <span style={{ color: 'var(--accent-green)', marginLeft: '8px', fontSize: '12px' }}>
                        (configured)
                      </span>
                    )}
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      className="input"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={getApiKeyPlaceholder()}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() => setShowApiKey(!showApiKey)}
                      style={{ padding: '8px 12px' }}
                    >
                      {showApiKey ? '🙈' : '👁️'}
                    </button>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    {config?.ai?.provider === 'anthropic' && (
                      <>Get your API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-purple)' }}>Anthropic Console</a></>
                    )}
                    {config?.ai?.provider === 'openai' && (
                      <>Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-purple)' }}>OpenAI Platform</a></>
                    )}
                  </p>
                </div>
              )}

              {config?.ai?.provider === 'ollama' && (
                <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                    Ollama runs locally and doesn't require an API key. Make sure Ollama is running on your machine.
                  </p>
                </div>
              )}

              {/* OpenAI OAuth Section - Only for OAuth-compatible models */}
              {config?.ai?.provider === 'openai' && canUseOAuth && (
                <div style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', marginTop: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '24px' }}>🔐</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>Sign in with ChatGPT</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Use your ChatGPT Plus/Pro subscription
                      </div>
                    </div>
                    {(oauthConnected || isOpenAIWithOAuth) ? (
                      <span className="badge badge-success">connected</span>
                    ) : (
                      <span className="badge badge-default">not connected</span>
                    )}
                  </div>

                  {(oauthConnected || isOpenAIWithOAuth) ? (
                    <div>
                      <p style={{ fontSize: '13px', color: 'var(--accent-green)', marginBottom: '12px' }}>
                        ✓ Connected via ChatGPT OAuth. No API credits needed!
                      </p>
                      <button
                        className="btn btn-ghost"
                        onClick={handleOAuthDisconnect}
                        style={{ color: 'var(--accent-red)' }}
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                        Sign in with your ChatGPT Plus or Pro account. No API key or credits required!
                      </p>
                      <button
                        className="btn btn-secondary"
                        onClick={handleOAuthConnect}
                        disabled={oauthConnecting}
                        style={{ width: '100%' }}
                      >
                        {oauthConnecting ? 'Connecting...' : 'Sign in with ChatGPT'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Warning if OAuth connected but model not supported */}
              {config?.ai?.provider === 'openai' && !canUseOAuth && (oauthConnected || isOpenAIWithOAuth) && (
                <div style={{ padding: '12px 16px', background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', borderRadius: 'var(--radius-md)', marginTop: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ fontSize: '16px' }}>⚠️</span>
                    <div>
                      <div style={{ fontWeight: 600, color: 'rgb(251, 191, 36)', marginBottom: '4px' }}>
                        Model not compatible with OAuth
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                        The selected model requires an API key. OAuth works with: GPT-4o, GPT-5, GPT-5 Codex, Codex Mini.
                      </p>
                      <button
                        className="btn btn-ghost"
                        onClick={handleOAuthDisconnect}
                        style={{ color: 'var(--accent-red)', marginTop: '8px', padding: '4px 8px', fontSize: '12px' }}
                      >
                        Disconnect OAuth
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '20px' }}>Web Search</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Enable web search for AI agents. Required for workflows that need to search the internet.
            </p>

            {/* Status Banner */}
            <div style={{
              padding: '12px 16px',
              marginBottom: '16px',
              borderRadius: 'var(--radius-md)',
              background: config?.webSearch?.hasApiKey ? 'rgba(34, 197, 94, 0.1)' : 'rgba(251, 191, 36, 0.1)',
              border: `1px solid ${config?.webSearch?.hasApiKey ? 'rgba(34, 197, 94, 0.3)' : 'rgba(251, 191, 36, 0.3)'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <span style={{ fontSize: '20px' }}>
                {config?.webSearch?.hasApiKey ? '✅' : '⚠️'}
              </span>
              <div>
                <div style={{ fontWeight: 600, color: config?.webSearch?.hasApiKey ? 'var(--accent-green)' : 'rgb(251, 191, 36)' }}>
                  {config?.webSearch?.hasApiKey ? 'Web Search Active' : 'Web Search Not Configured'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {config?.webSearch?.hasApiKey
                    ? 'AI agents can search the web using Brave Search API'
                    : 'Add a Brave API key to enable web search in workflows'}
                </div>
              </div>
            </div>

            <div style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <span style={{ fontSize: '24px' }}>🔍</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>Brave Search API</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Free tier: 2,000 queries/month
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type={showBraveApiKey ? 'text' : 'password'}
                  className="input"
                  value={braveApiKey}
                  onChange={(e) => setBraveApiKey(e.target.value)}
                  placeholder={config?.webSearch?.hasApiKey ? '••••••••••••••••' : 'Enter your Brave Search API key'}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowBraveApiKey(!showBraveApiKey)}
                  style={{ padding: '8px 12px' }}
                >
                  {showBraveApiKey ? '🙈' : '👁️'}
                </button>
              </div>

              {config?.webSearch?.hasApiKey && (
                <p style={{ fontSize: '12px', color: 'var(--accent-green)', marginTop: '8px' }}>
                  ✓ API key saved. Enter a new key above to replace it.
                </p>
              )}

              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                Get a free API key from <a href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-purple)' }}>Brave Search API</a>.
                Choose the "Data for Search" plan.
              </p>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '20px' }}>Messaging Configuration</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Connect messaging apps to enable notifications and messaging actions in your workflows.
            </p>

            <div style={{ display: 'grid', gap: '24px' }}>
              {/* Telegram */}
              <div style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '24px' }}>📱</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>Telegram</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Send messages via Telegram Bot API
                    </div>
                  </div>
                  {config?.messaging?.telegram?.hasBotToken && (
                    <span className="badge badge-success" style={{ marginLeft: 'auto' }}>configured</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <input
                    type={showTelegramToken ? 'text' : 'password'}
                    className="input"
                    value={telegramToken}
                    onChange={(e) => setTelegramToken(e.target.value)}
                    placeholder={config?.messaging?.telegram?.hasBotToken ? 'Bot token is set (enter new to change)' : 'Enter your Telegram bot token'}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-ghost"
                    onClick={() => setShowTelegramToken(!showTelegramToken)}
                    style={{ padding: '8px 12px' }}
                  >
                    {showTelegramToken ? '🙈' : '👁️'}
                  </button>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: '12px' }}>
                  Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-purple)' }}>@BotFather</a> to get your token
                </p>

                <input
                  type="text"
                  className="input"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder={config?.messaging?.telegram?.chatId ? `Chat ID: ${config.messaging.telegram.chatId} (enter new to change)` : 'Your Telegram chat ID (optional)'}
                  style={{ width: '100%' }}
                />
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Message <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-purple)' }}>@userinfobot</a> on Telegram to get your chat ID. Required for receiving messages.
                </p>
              </div>

              {/* WhatsApp */}
              <div style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '24px' }}>💬</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>WhatsApp</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Send messages via WhatsApp Web
                    </div>
                  </div>
                  <span
                    className={`badge badge-${whatsappStatus === 'connected' ? 'success' : whatsappStatus === 'connecting' ? 'warning' : 'default'}`}
                    style={{ marginLeft: 'auto' }}
                  >
                    {whatsappStatus === 'connected' ? 'connected' : whatsappStatus === 'connecting' ? 'connecting...' : 'disconnected'}
                  </span>
                </div>

                {whatsappStatus === 'disconnected' && !whatsappConnecting && (
                  <button
                    className="btn btn-secondary"
                    onClick={handleWhatsAppConnect}
                    style={{ width: '100%' }}
                  >
                    Connect WhatsApp
                  </button>
                )}

                {whatsappConnecting && whatsappQR && (
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                      Scan this QR code with WhatsApp on your phone
                    </p>
                    <div
                      style={{
                        display: 'inline-block',
                        padding: '16px',
                        background: 'white',
                        borderRadius: 'var(--radius-md)',
                        marginBottom: '12px'
                      }}
                    >
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(whatsappQR)}`}
                        alt="WhatsApp QR Code"
                        style={{ display: 'block' }}
                      />
                    </div>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setWhatsappConnecting(false);
                        setWhatsappQR(null);
                      }}
                      style={{ display: 'block', margin: '0 auto' }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {whatsappConnecting && !whatsappQR && (
                  <div style={{ textAlign: 'center', padding: '20px' }}>
                    <div className="spinner" style={{ fontSize: '24px', marginBottom: '8px' }}>◌</div>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      Waiting for QR code...
                    </p>
                  </div>
                )}

                {whatsappStatus === 'connected' && (
                  <div>
                    <p style={{ fontSize: '13px', color: 'var(--accent-green)', marginBottom: '12px' }}>
                      ✓ WhatsApp is connected and ready to send messages
                    </p>
                    <button
                      className="btn btn-ghost"
                      onClick={handleWhatsAppDisconnect}
                      style={{ color: 'var(--accent-red)' }}
                    >
                      Disconnect
                    </button>
                  </div>
                )}

                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
                  Uses WhatsApp Web protocol. Your phone must stay connected to the internet.
                </p>
              </div>

              {/* iMessage */}
              <div style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '24px' }}>💭</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>iMessage</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Send messages via macOS Messages app
                    </div>
                  </div>
                  {isMacOS ? (
                    <span className="badge badge-success">available</span>
                  ) : (
                    <span className="badge badge-default">macOS only</span>
                  )}
                </div>
                {isMacOS && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
                    No configuration needed. iMessage will use the Messages app on this Mac.
                  </p>
                )}
                {!isMacOS && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
                    iMessage is only available when running Weavr on macOS.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '20px' }}>Built-in Plugins</h2>

            <div style={{ display: 'grid', gap: '12px' }}>
              {[
                { name: 'http', version: '1.0.0', icon: '🌐', description: 'HTTP requests and webhooks' },
                { name: 'cron', version: '1.0.0', icon: '⏰', description: 'Scheduled triggers' },
                { name: 'github', version: '1.0.0', icon: '🐙', description: 'GitHub integration' },
                { name: 'slack', version: '1.0.0', icon: '💬', description: 'Slack messaging' },
                { name: 'discord', version: '1.0.0', icon: '🎮', description: 'Discord webhooks' },
                { name: 'linear', version: '1.0.0', icon: '📐', description: 'Linear project management' },
                { name: 'notion', version: '1.0.0', icon: '📝', description: 'Notion pages & databases' },
                { name: 'email', version: '1.0.0', icon: '📧', description: 'Email via SMTP' },
                { name: 'ai', version: '1.0.0', icon: '🤖', description: 'AI/LLM actions' },
                { name: 'json', version: '1.0.0', icon: '{ }', description: 'JSON manipulation' },
              ].map((plugin) => (
                <div
                  key={plugin.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <span style={{ fontSize: '20px' }}>{plugin.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>
                      {plugin.name}
                      <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '12px' }}>
                        v{plugin.version}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {plugin.description}
                    </div>
                  </div>
                  <span className="badge badge-success">active</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button className="btn btn-ghost" onClick={() => window.location.reload()}>
              Reset
            </button>
          </div>

          {message && (
            <div
              style={{
                position: 'fixed',
                bottom: '24px',
                right: '24px',
                padding: '12px 20px',
                borderRadius: '8px',
                background: message.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
                color: 'white',
                fontWeight: 500,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                zIndex: 1000,
              }}
            >
              {message.type === 'success' ? '✓' : '✗'} {message.text}
            </div>
          )}
        </>
      )}
    </div>
  );
}
