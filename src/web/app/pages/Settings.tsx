import { useState, useEffect } from 'react';
import { IntegrationIcon } from '../components/IntegrationIcon';

// Models that support OAuth (ChatGPT backend API via Codex)
const OAUTH_SUPPORTED_MODELS = ['gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5.2', 'gpt-5.1', 'gpt-5-codex'];

// Check if a model supports OAuth
const isOAuthSupportedModel = (model: string | undefined): boolean => {
  if (!model) return false;
  return OAUTH_SUPPORTED_MODELS.includes(model);
};

// Types for dynamic model registry
interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  supportsImages: boolean;
  supportsReasoning: boolean;
  cost?: {
    input: number;
    output: number;
  };
}

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  envVar?: string;
  authType: 'api_key' | 'oauth' | 'local' | 'cli' | 'aws' | 'gcloud';
  setupUrl?: string;
  models: ModelInfo[];
  hasCredentials?: boolean;
}

// Types for MCP catalog
interface MCPServerEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  package: string;
  official?: boolean;
  tools?: string[];
  requiredEnv?: string[];
  setupUrl?: string;
}

interface Config {
  server: {
    port: number;
    host: string;
  };
  timezone?: string;
  email?: {
    smtp?: {
      host?: string;
      port?: number;
      secure?: boolean;
      user?: string;
      pass?: string;
      authMethod?: 'login' | 'plain';
      hasPass?: boolean;
    };
  };
  calendar?: {
    caldav?: {
      calendarUrl?: string;
      username?: string;
      password?: string;
      bearerToken?: string;
      hasPassword?: boolean;
      hasBearerToken?: boolean;
    };
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

  // Dynamic model registry
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);

  // MCP server catalog
  const [mcpCatalog, setMcpCatalog] = useState<MCPServerEntry[]>([]);
  const [enabledMcpServers, setEnabledMcpServers] = useState<string[]>([]);
  const [connectedMcpServers, setConnectedMcpServers] = useState<string[]>([]);
  const [loadingMcp, setLoadingMcp] = useState(true);
  const [mcpCategoryFilter, setMcpCategoryFilter] = useState<string>('all');
  const [expandedMcpServer, setExpandedMcpServer] = useState<string | null>(null);
  const [mcpServerConfigs, setMcpServerConfigs] = useState<Record<string, Record<string, string>>>({});
  const [togglingMcp, setTogglingMcp] = useState<string | null>(null);

  // Messaging state
  const [telegramToken, setTelegramToken] = useState('');
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [whatsappQR, setWhatsappQR] = useState<string | null>(null);
  const [whatsappConnecting, setWhatsappConnecting] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  // Email SMTP state
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [smtpAuthMethod, setSmtpAuthMethod] = useState<'login' | 'plain'>('login');

  // Calendar (CalDAV) state
  const [caldavUrl, setCaldavUrl] = useState('');
  const [caldavUsername, setCaldavUsername] = useState('');
  const [caldavPassword, setCaldavPassword] = useState('');
  const [showCaldavPassword, setShowCaldavPassword] = useState(false);
  const [caldavBearer, setCaldavBearer] = useState('');
  const [showCaldavBearer, setShowCaldavBearer] = useState(false);
  const [caldavAuthMode, setCaldavAuthMode] = useState<'basic' | 'bearer'>('basic');

  // Timezone - detect system default
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Common timezones grouped by region
  const timezones = [
    { group: 'Americas', zones: [
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
      'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo',
    ]},
    { group: 'Europe', zones: [
      'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam',
      'Europe/Rome', 'Europe/Madrid', 'Europe/Moscow', 'Europe/Zurich',
    ]},
    { group: 'Asia/Pacific', zones: [
      'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore',
      'Asia/Seoul', 'Asia/Kolkata', 'Asia/Dubai', 'Australia/Sydney',
      'Australia/Melbourne', 'Pacific/Auckland',
    ]},
  ];

  const applyEmailCalendarConfig = (nextConfig: Config | null) => {
    if (!nextConfig) return;

    const smtp = nextConfig.email?.smtp;
    setSmtpHost(smtp?.host ?? '');
    setSmtpPort(smtp?.port ? String(smtp.port) : '');
    setSmtpSecure(Boolean(smtp?.secure));
    setSmtpUser(smtp?.user ?? '');
    setSmtpAuthMethod(smtp?.authMethod ?? 'login');
    setSmtpPass('');

    const caldav = nextConfig.calendar?.caldav;
    setCaldavUrl(caldav?.calendarUrl ?? '');
    setCaldavUsername(caldav?.username ?? '');
    setCaldavAuthMode(caldav?.bearerToken ? 'bearer' : 'basic');
    setCaldavPassword('');
    setCaldavBearer('');
  };

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        setConfig(data.config);
        applyEmailCalendarConfig(data.config);
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

    // Load dynamic model registry
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => {
        setProviders(data.providers ?? []);
        setLoadingProviders(false);
      })
      .catch((err) => {
        console.error('Failed to load model registry:', err);
        setLoadingProviders(false);
      });

    // Load MCP catalog and enabled servers
    Promise.all([
      fetch('/api/mcp/catalog').then(res => res.json()),
      fetch('/api/mcp/enabled').then(res => res.json()),
    ])
      .then(([catalogData, enabledData]) => {
        // API returns 'servers' field
        setMcpCatalog(catalogData.servers ?? catalogData.catalog ?? []);
        setEnabledMcpServers(enabledData.servers ?? enabledData.enabled ?? []);
        setConnectedMcpServers(enabledData.connected ?? []);
        setLoadingMcp(false);
      })
      .catch((err) => {
        console.error('Failed to load MCP catalog:', err);
        setLoadingMcp(false);
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
      const smtpPortValue = smtpPort ? parseInt(smtpPort, 10) : undefined;
      const smtpConfig = (smtpHost || smtpUser || smtpPass || smtpPort || config?.email?.smtp) ? {
        host: smtpHost,
        port: smtpPortValue,
        secure: smtpSecure,
        user: smtpUser || undefined,
        pass: smtpPass || undefined,
        authMethod: smtpAuthMethod,
      } : undefined;

      const caldavConfig = (caldavUrl || caldavUsername || caldavPassword || caldavBearer || config?.calendar?.caldav) ? {
        calendarUrl: caldavUrl,
        ...(caldavAuthMode === 'basic'
          ? {
            username: caldavUsername || undefined,
            password: caldavPassword || undefined,
            bearerToken: undefined,
          }
          : {
            username: undefined,
            password: undefined,
            bearerToken: caldavBearer || undefined,
          }),
      } : undefined;

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
        email: smtpConfig ? { smtp: smtpConfig } : config.email,
        calendar: caldavConfig ? { caldav: caldavConfig } : config.calendar,
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
        setSmtpPass('');
        setCaldavPassword('');
        setCaldavBearer('');
        // Reload config to get updated hasApiKey status
        const reloadRes = await fetch('/api/config');
        const reloadData = await reloadRes.json();
        setConfig(reloadData.config);
        applyEmailCalendarConfig(reloadData.config);
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

  const getDefaultModel = (providerId: string): string => {
    const provider = providers.find(p => p.id === providerId);
    if (provider && provider.models.length > 0) {
      return provider.models[0].id;
    }
    // Fallbacks for when providers haven't loaded yet
    switch (providerId) {
      case 'anthropic': return 'claude-sonnet-4-20250514';
      case 'openai': return 'gpt-4o';
      case 'ollama': return 'llama3.3';
      default: return '';
    }
  };

  // Get models for the currently selected provider
  const getCurrentProviderModels = (): ModelInfo[] => {
    if (!config?.ai?.provider) return [];
    const provider = providers.find(p => p.id === config.ai?.provider);
    return provider?.models ?? [];
  };

  // Get current provider info
  const getCurrentProvider = (): ProviderInfo | undefined => {
    if (!config?.ai?.provider) return undefined;
    return providers.find(p => p.id === config.ai?.provider);
  };

  // Toggle MCP server
  const handleMcpToggle = async (serverId: string, enable: boolean) => {
    setTogglingMcp(serverId);
    try {
      const endpoint = enable ? `/api/mcp/enable/${serverId}` : `/api/mcp/disable/${serverId}`;
      const body = enable ? {
        env: mcpServerConfigs[serverId] ?? {},
      } : undefined;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();

      if (response.ok) {
        setEnabledMcpServers(prev =>
          enable ? [...prev, serverId] : prev.filter(id => id !== serverId)
        );
        // Update connection status based on response
        if (enable && data.connected) {
          setConnectedMcpServers(prev => [...prev, serverId]);
        } else if (!enable) {
          setConnectedMcpServers(prev => prev.filter(id => id !== serverId));
        }
        if (enable) {
          setExpandedMcpServer(null); // Collapse config panel after enabling
        }
        setMessage({
          type: data.connected !== false ? 'success' : 'error',
          text: data.message ?? `MCP server ${enable ? 'enabled' : 'disabled'}.`
        });
      } else {
        setMessage({ type: 'error', text: data.error ?? 'Failed to toggle MCP server' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error: Could not toggle MCP server' });
    }
    setTogglingMcp(null);
    setTimeout(() => setMessage(null), 4000);
  };

  // Get unique MCP categories
  const mcpCategories = ['all', ...new Set(mcpCatalog.map(s => s.category))];

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

  // Determine if API key is needed based on provider auth type
  const currentProvider = getCurrentProvider();
  const providerNeedsApiKey = currentProvider?.authType === 'api_key';
  const providerIsLocal = currentProvider?.authType === 'local' || currentProvider?.authType === 'cli';
  const needsApiKey = config?.ai?.provider && providerNeedsApiKey && !(isOpenAIWithOAuth && canUseOAuth);

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
  const webhookBaseUrl = typeof window !== 'undefined' ? window.location.origin : '';

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

              <div>
                <label className="label">
                  Timezone
                  {!config?.timezone && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '12px' }}>
                      (using system: {systemTimezone})
                    </span>
                  )}
                </label>
                <select
                  className="input"
                  value={config?.timezone ?? ''}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev ? { ...prev, timezone: e.target.value || undefined } : null
                    )
                  }
                >
                  <option value="">System default ({systemTimezone})</option>
                  {timezones.map(({ group, zones }) => (
                    <optgroup key={group} label={group}>
                      {zones.map((tz) => (
                        <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Used for scheduled workflows (cron). Individual workflows can override this.
                </p>
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
                  {providers.length > 0 ? (
                    <>
                      {/* API-based providers (with API key or cloud auth) */}
                      <optgroup label="API Providers">
                        {providers
                          .filter(p => ['api_key', 'aws', 'gcloud'].includes(p.authType))
                          .map(provider => (
                            <option key={provider.id} value={provider.id}>
                              {provider.name}
                              {provider.hasCredentials && ' ✓'}
                            </option>
                          ))}
                      </optgroup>
                      {/* Local/CLI providers */}
                      <optgroup label="Local / CLI">
                        {providers
                          .filter(p => ['local', 'cli'].includes(p.authType))
                          .map(provider => (
                            <option key={provider.id} value={provider.id}>
                              {provider.name}
                            </option>
                          ))}
                      </optgroup>
                    </>
                  ) : (
                    /* Fallback while loading or if API failed */
                    <>
                      <optgroup label="API Providers">
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="openai">OpenAI (GPT)</option>
                        <option value="google">Google (Gemini)</option>
                        <option value="groq">Groq</option>
                        <option value="mistral">Mistral AI</option>
                        <option value="xai">xAI (Grok)</option>
                        <option value="openrouter">OpenRouter</option>
                      </optgroup>
                      <optgroup label="Local / CLI">
                        <option value="ollama">Ollama (Local)</option>
                        <option value="claude-cli">Claude CLI</option>
                        <option value="llm-cli">LLM CLI</option>
                      </optgroup>
                    </>
                  )}
                </select>
                {loadingProviders && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Loading provider details...
                  </p>
                )}
                {!loadingProviders && getCurrentProvider()?.description && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {getCurrentProvider()?.description}
                  </p>
                )}
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
                    {getCurrentProviderModels().length > 0 ? (
                      <>
                        {getCurrentProviderModels().map(model => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                            {model.supportsReasoning && ' (Reasoning)'}
                            {model.supportsImages && ' (Vision)'}
                          </option>
                        ))}
                        {/* Keep current model visible if not in the list */}
                        {config.ai?.model && !getCurrentProviderModels().find(m => m.id === config.ai?.model) && (
                          <option value={config.ai.model}>{config.ai.model} (current)</option>
                        )}
                      </>
                    ) : (
                      /* Fallback for when dynamic models haven't loaded */
                      <>
                        {/* Always show current model first */}
                        {config.ai?.model && (
                          <option value={config.ai.model}>{config.ai.model}</option>
                        )}
                        {config.ai.provider === 'anthropic' && (
                          <>
                            {config.ai?.model !== 'claude-sonnet-4-20250514' && <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>}
                            {config.ai?.model !== 'claude-opus-4-20250514' && <option value="claude-opus-4-20250514">Claude Opus 4</option>}
                            {config.ai?.model !== 'claude-3-5-haiku-20241022' && <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>}
                          </>
                        )}
                        {config.ai.provider === 'openai' && (
                          <>
                            {config.ai?.model !== 'gpt-4o' && <option value="gpt-4o">GPT-4o</option>}
                            {config.ai?.model !== 'gpt-4o-mini' && <option value="gpt-4o-mini">GPT-4o Mini</option>}
                            {config.ai?.model !== 'o1' && <option value="o1">o1</option>}
                          </>
                        )}
                        {config.ai.provider === 'google' && (
                          <>
                            {config.ai?.model !== 'gemini-2.0-flash' && <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>}
                            {config.ai?.model !== 'gemini-1.5-pro' && <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>}
                          </>
                        )}
                        {config.ai.provider === 'ollama' && (
                          <>
                            {config.ai?.model !== 'llama3.3' && <option value="llama3.3">Llama 3.3 70B</option>}
                            {config.ai?.model !== 'llama3.2' && <option value="llama3.2">Llama 3.2</option>}
                            {config.ai?.model !== 'mistral' && <option value="mistral">Mistral</option>}
                            {config.ai?.model !== 'qwen2.5-coder' && <option value="qwen2.5-coder">Qwen 2.5 Coder</option>}
                          </>
                        )}
                      </>
                    )}
                  </select>
                  {/* Show model details */}
                  {(() => {
                    const model = getCurrentProviderModels().find(m => m.id === config.ai?.model);
                    if (!model) return null;
                    return (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Context: {(model.contextWindow / 1000).toFixed(0)}K tokens
                        {model.cost && ` • $${model.cost.input}/M input, $${model.cost.output}/M output`}
                      </p>
                    );
                  })()}
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
                    {(() => {
                      const provider = getCurrentProvider();
                      if (provider?.setupUrl) {
                        return (
                          <>Get your API key from <a href={provider.setupUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-purple)' }}>{provider.name}</a></>
                        );
                      }
                      if (provider?.envVar) {
                        return <>Or set the {provider.envVar} environment variable</>;
                      }
                      return null;
                    })()}
                  </p>
                </div>
              )}

              {providerIsLocal && (
                <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                    {currentProvider?.authType === 'local' && (
                      <>{currentProvider?.name} runs locally and doesn't require an API key. Make sure it's running on your machine.</>
                    )}
                    {currentProvider?.authType === 'cli' && (
                      <>{currentProvider?.name} uses a command-line tool. Make sure it's installed and configured.</>
                    )}
                    {currentProvider?.setupUrl && (
                      <> <a href={currentProvider.setupUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-purple)' }}>Setup guide</a></>
                    )}
                  </p>
                </div>
              )}

              {/* OpenAI OAuth Section - Show for all OpenAI users */}
              {config?.ai?.provider === 'openai' && (
                <div style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', marginTop: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '24px' }}>🔐</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>Sign in with ChatGPT</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Use your ChatGPT Plus/Pro subscription for GPT-5 models
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
                      <p style={{ fontSize: '13px', color: 'var(--accent-green)', marginBottom: '8px' }}>
                        ✓ Connected via ChatGPT OAuth. GPT-5 models are now available!
                      </p>
                      {!canUseOAuth && (
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                          Select a GPT-5 model above to use your ChatGPT subscription.
                        </p>
                      )}
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
                        Sign in with your ChatGPT Plus or Pro account to unlock GPT-5 models. No API credits required!
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
                  <IntegrationIcon name="telegram" size={24} />
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
                  <IntegrationIcon name="whatsapp" size={24} />
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
                  <IntegrationIcon name="imessage" size={24} />
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
            <h2 className="card-title" style={{ marginBottom: '20px' }}>Email Configuration</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Configure SMTP credentials for <code>email.send</code> actions. You can also use API keys in workflows.
            </p>

            <div style={{ display: 'grid', gap: '16px', maxWidth: '520px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <IntegrationIcon name="email" size={24} />
                <div>
                  <div style={{ fontWeight: 600 }}>SMTP</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Used when provider is <code>smtp</code> or <code>auto</code>
                  </div>
                </div>
                {config?.email?.smtp?.host && (
                  <span className="badge badge-success" style={{ marginLeft: 'auto' }}>configured</span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <div>
                  <label className="label">SMTP Host</label>
                  <input
                    type="text"
                    className="input"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.example.com"
                  />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input
                    type="number"
                    className="input"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    placeholder="587"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="label">Auth Method</label>
                  <select
                    className="input"
                    value={smtpAuthMethod}
                    onChange={(e) => setSmtpAuthMethod(e.target.value as 'login' | 'plain')}
                  >
                    <option value="login">LOGIN</option>
                    <option value="plain">PLAIN</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '24px' }}>
                  <input
                    type="checkbox"
                    checked={smtpSecure}
                    onChange={(e) => setSmtpSecure(e.target.checked)}
                    style={{ width: '14px', height: '14px' }}
                  />
                  <span style={{ fontSize: '12px' }}>Use TLS (secure)</span>
                </div>
              </div>

              <div>
                <label className="label">Username</label>
                <input
                  type="text"
                  className="input"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  placeholder="your-email@example.com"
                />
              </div>

              <div>
                <label className="label">
                  Password
                  {config?.email?.smtp?.hasPass && (
                    <span style={{ color: 'var(--accent-green)', marginLeft: '8px', fontSize: '12px' }}>
                      (configured)
                    </span>
                  )}
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type={showSmtpPass ? 'text' : 'password'}
                    className="input"
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    placeholder={config?.email?.smtp?.hasPass ? 'Password is set (enter new to change)' : 'SMTP password'}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-ghost"
                    onClick={() => setShowSmtpPass(!showSmtpPass)}
                    style={{ padding: '8px 12px' }}
                  >
                    {showSmtpPass ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Inbound email webhook: <code>{webhookBaseUrl}/webhook/email</code>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '20px' }}>Calendar Configuration</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Configure CalDAV access for <code>calendar.*</code> actions and triggers.
            </p>

            <div style={{ display: 'grid', gap: '16px', maxWidth: '520px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <IntegrationIcon name="calendar" size={24} />
                <div>
                  <div style={{ fontWeight: 600 }}>CalDAV</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Nextcloud, iCloud, Fastmail, and more
                  </div>
                </div>
                {config?.calendar?.caldav?.calendarUrl && (
                  <span className="badge badge-success" style={{ marginLeft: 'auto' }}>configured</span>
                )}
              </div>

              <div>
                <label className="label">Calendar URL</label>
                <input
                  type="text"
                  className="input"
                  value={caldavUrl}
                  onChange={(e) => setCaldavUrl(e.target.value)}
                  placeholder="https://cal.example.com/dav/calendars/user/default/"
                />
              </div>

              <div>
                <label className="label">Auth Type</label>
                <select
                  className="input"
                  value={caldavAuthMode}
                  onChange={(e) => setCaldavAuthMode(e.target.value as 'basic' | 'bearer')}
                >
                  <option value="basic">Username + Password</option>
                  <option value="bearer">Bearer Token</option>
                </select>
              </div>

              {caldavAuthMode === 'basic' ? (
                <>
                  <div>
                    <label className="label">Username</label>
                    <input
                      type="text"
                      className="input"
                      value={caldavUsername}
                      onChange={(e) => setCaldavUsername(e.target.value)}
                      placeholder="user@example.com"
                    />
                  </div>

                  <div>
                    <label className="label">
                      Password
                      {config?.calendar?.caldav?.hasPassword && (
                        <span style={{ color: 'var(--accent-green)', marginLeft: '8px', fontSize: '12px' }}>
                          (configured)
                        </span>
                      )}
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type={showCaldavPassword ? 'text' : 'password'}
                        className="input"
                        value={caldavPassword}
                        onChange={(e) => setCaldavPassword(e.target.value)}
                        placeholder={config?.calendar?.caldav?.hasPassword ? 'Password is set (enter new to change)' : 'CalDAV password'}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn btn-ghost"
                        onClick={() => setShowCaldavPassword(!showCaldavPassword)}
                        style={{ padding: '8px 12px' }}
                      >
                        {showCaldavPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="label">
                    Bearer Token
                    {config?.calendar?.caldav?.hasBearerToken && (
                      <span style={{ color: 'var(--accent-green)', marginLeft: '8px', fontSize: '12px' }}>
                        (configured)
                      </span>
                    )}
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type={showCaldavBearer ? 'text' : 'password'}
                      className="input"
                      value={caldavBearer}
                      onChange={(e) => setCaldavBearer(e.target.value)}
                      placeholder={config?.calendar?.caldav?.hasBearerToken ? 'Token is set (enter new to change)' : 'Bearer token'}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() => setShowCaldavBearer(!showCaldavBearer)}
                      style={{ padding: '8px 12px' }}
                    >
                      {showCaldavBearer ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '20px' }}>Built-in Plugins</h2>

            <div style={{ display: 'grid', gap: '12px' }}>
              {[
                { name: 'http', version: '1.0.0', description: 'HTTP requests and webhooks' },
                { name: 'cron', version: '1.0.0', description: 'Scheduled triggers' },
                { name: 'github', version: '1.0.0', description: 'GitHub integration' },
                { name: 'slack', version: '1.0.0', description: 'Slack messaging' },
                { name: 'discord', version: '1.0.0', description: 'Discord webhooks' },
                { name: 'linear', version: '1.0.0', description: 'Linear project management' },
                { name: 'notion', version: '1.0.0', description: 'Notion pages & databases' },
                { name: 'email', version: '1.1.0', description: 'Email via SMTP or API' },
                { name: 'calendar', version: '1.0.0', description: 'CalDAV calendar integration' },
                { name: 'ai', version: '1.0.0', description: 'AI/LLM actions' },
                { name: 'json', version: '1.0.0', description: 'JSON manipulation' },
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
                  <IntegrationIcon name={plugin.name} size={20} />
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

          {/* MCP Server Catalog */}
          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '8px' }}>MCP Tool Servers</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Enable Model Context Protocol (MCP) servers to give AI agents access to additional tools.
              Changes require a server restart to take effect.
            </p>

            {loadingMcp ? (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <div className="empty-icon">...</div>
                <div className="empty-title">Loading MCP catalog...</div>
              </div>
            ) : (
              <>
                {/* Category filter */}
                <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {mcpCategories.map(cat => (
                    <button
                      key={cat}
                      className={`btn btn-ghost ${mcpCategoryFilter === cat ? 'btn-primary' : ''}`}
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        textTransform: 'capitalize',
                        ...(mcpCategoryFilter === cat ? {} : { opacity: 0.7 })
                      }}
                      onClick={() => setMcpCategoryFilter(cat)}
                    >
                      {cat === 'all' ? 'All' : cat.replace('-', ' ')}
                    </button>
                  ))}
                </div>

                {/* Server list */}
                <div style={{ display: 'grid', gap: '12px' }}>
                  {mcpCatalog
                    .filter(server => mcpCategoryFilter === 'all' || server.category === mcpCategoryFilter)
                    .map(server => {
                      const isEnabled = enabledMcpServers.includes(server.id);
                      const isConnected = connectedMcpServers.includes(server.id);
                      const isToggling = togglingMcp === server.id;
                      const isExpanded = expandedMcpServer === server.id;
                      const hasConfig = server.requiredEnv && server.requiredEnv.length > 0;
                      const categoryIcons: Record<string, string> = {
                        'filesystem': '📁',
                        'git': '🔀',
                        'database': '🗄️',
                        'browser': '🌐',
                        'search': '🔍',
                        'cloud': '☁️',
                        'productivity': '📋',
                        'dev-tools': '🛠️',
                        'other': '📦',
                      };

                      return (
                        <div
                          key={server.id}
                          style={{
                            background: isConnected ? 'rgba(34, 197, 94, 0.08)' : isEnabled ? 'rgba(251, 191, 36, 0.05)' : 'var(--bg-tertiary)',
                            border: isConnected ? '1px solid rgba(34, 197, 94, 0.3)' : isEnabled ? '1px solid rgba(251, 191, 36, 0.2)' : '1px solid transparent',
                            borderRadius: 'var(--radius-md)',
                            overflow: 'hidden',
                            opacity: isToggling ? 0.7 : 1,
                            transition: 'opacity 0.2s',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '12px',
                              padding: '12px 16px',
                            }}
                          >
                            <span style={{ fontSize: '20px' }}>
                              {categoryIcons[server.category] ?? '📦'}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 500 }}>{server.name}</span>
                                {server.official && (
                                  <span className="badge badge-default" style={{ fontSize: '10px' }}>official</span>
                                )}
                                {isConnected && (
                                  <span className="badge badge-success" style={{ fontSize: '10px' }}>running</span>
                                )}
                                {isEnabled && !isConnected && (
                                  <span className="badge badge-warning" style={{ fontSize: '10px' }}>not connected</span>
                                )}
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                                  {server.category.replace('-', ' ')}
                                </span>
                              </div>
                              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                {server.description}
                              </div>
                              {server.tools && server.tools.length > 0 && (
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                  Tools: {server.tools.slice(0, 4).join(', ')}
                                  {server.tools.length > 4 && ` +${server.tools.length - 4} more`}
                                </div>
                              )}
                              {hasConfig && !isExpanded && !isEnabled && (
                                <div style={{ fontSize: '11px', color: 'rgb(251, 191, 36)', marginTop: '4px' }}>
                                  Requires: {server.requiredEnv?.join(', ')}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {server.setupUrl && (
                                <a
                                  href={server.setupUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    color: 'var(--text-muted)',
                                    fontSize: '12px',
                                    textDecoration: 'none',
                                  }}
                                  title="Setup instructions"
                                >
                                  Docs
                                </a>
                              )}
                              {hasConfig && (
                                <button
                                  className="btn btn-ghost"
                                  style={{
                                    padding: '6px 12px',
                                    fontSize: '12px',
                                  }}
                                  onClick={() => setExpandedMcpServer(isExpanded ? null : server.id)}
                                >
                                  {isExpanded ? 'Hide' : 'Configure'}
                                </button>
                              )}
                              <button
                                className={`btn ${isEnabled ? 'btn-ghost' : 'btn-secondary'}`}
                                style={{
                                  padding: '6px 12px',
                                  fontSize: '12px',
                                  ...(isEnabled ? { color: 'var(--accent-red)' } : {})
                                }}
                                onClick={() => handleMcpToggle(server.id, !isEnabled)}
                                disabled={isToggling}
                              >
                                {isToggling ? 'Working...' : isEnabled ? 'Disable' : 'Enable'}
                              </button>
                            </div>
                          </div>

                          {/* Configuration panel */}
                          {isExpanded && hasConfig && (
                            <div style={{
                              padding: '12px 16px',
                              borderTop: '1px solid var(--border-color)',
                              background: 'var(--bg-secondary)',
                            }}>
                              <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                                Environment Variables
                              </div>
                              <div style={{ display: 'grid', gap: '12px' }}>
                                {server.requiredEnv?.map(envVar => (
                                  <div key={envVar}>
                                    <label className="label" style={{ fontSize: '12px' }}>{envVar}</label>
                                    <input
                                      type="password"
                                      className="input"
                                      value={mcpServerConfigs[server.id]?.[envVar] ?? ''}
                                      onChange={(e) => setMcpServerConfigs(prev => ({
                                        ...prev,
                                        [server.id]: {
                                          ...prev[server.id],
                                          [envVar]: e.target.value,
                                        },
                                      }))}
                                      placeholder={`Enter ${envVar}`}
                                      style={{ fontSize: '13px' }}
                                    />
                                  </div>
                                ))}
                              </div>
                              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                                These values will be saved to your config and passed to the MCP server.
                                {server.setupUrl && (
                                  <> See <a href={server.setupUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-purple)' }}>documentation</a> for setup instructions.</>
                                )}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>

                {mcpCatalog.filter(s => mcpCategoryFilter === 'all' || s.category === mcpCategoryFilter).length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No servers in this category
                  </div>
                )}

                {/* Summary */}
                {enabledMcpServers.length > 0 && (
                  <div style={{
                    marginTop: '16px',
                    padding: '12px 16px',
                    background: connectedMcpServers.length > 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(251, 191, 36, 0.1)',
                    border: `1px solid ${connectedMcpServers.length > 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(251, 191, 36, 0.2)'}`,
                    borderRadius: 'var(--radius-md)',
                  }}>
                    <span style={{ color: connectedMcpServers.length > 0 ? 'var(--accent-green)' : 'rgb(251, 191, 36)' }}>
                      {connectedMcpServers.length > 0
                        ? `${connectedMcpServers.length} server${connectedMcpServers.length !== 1 ? 's' : ''} running`
                        : `${enabledMcpServers.length} server${enabledMcpServers.length !== 1 ? 's' : ''} enabled but not connected`
                      }
                    </span>
                    {connectedMcpServers.length > 0 && connectedMcpServers.length < enabledMcpServers.length && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '12px' }}>
                        ({enabledMcpServers.length - connectedMcpServers.length} failed to connect)
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
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
