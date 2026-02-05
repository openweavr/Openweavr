import { useState, useEffect } from 'react';

interface OnboardingProps {
  onComplete: () => void;
}

type Step = 'welcome' | 'ai' | 'auth-method' | 'apikey' | 'model' | 'cli-setup' | 'complete';
type AuthMethod = 'apikey' | 'oauth';

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [provider, setProvider] = useState<string>('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('apikey');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cliTool, setCliTool] = useState<'auto' | 'claude' | 'ollama' | 'llm'>('auto');
  const [cliModel, setCliModel] = useState('');
  const [model, setModel] = useState('');
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(false);

  // Listen for OAuth popup messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'oauth-success') {
        setOauthConnected(true);
        setOauthConnecting(false);
        setError(null);
      } else if (event.data?.type === 'oauth-error') {
        setError(event.data.error ?? 'OAuth authentication failed');
        setOauthConnecting(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleOAuthConnect = async () => {
    setOauthConnecting(true);
    setError(null);

    try {
      const response = await fetch('/api/oauth/openai/authorize');
      const data = await response.json() as { authUrl?: string; error?: string };

      if (data.authUrl) {
        // Open OAuth popup
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
        setError(data.error ?? 'Failed to start OAuth flow');
        setOauthConnecting(false);
      }
    } catch (err) {
      setError('Network error: Could not start OAuth flow');
      setOauthConnecting(false);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    setError(null);

    try {
      let aiConfig: Record<string, unknown> | undefined;

      if (provider === 'cli') {
        // CLI-based AI configuration
        aiConfig = {
          useCLI: true,
          cliProvider: cliTool,
          cliModel: cliModel || undefined,
        };
      } else if (provider === 'openai' && authMethod === 'oauth') {
        // OAuth-based OpenAI configuration
        // Tokens are already saved by the OAuth callback
        // Just set the provider and auth method
        aiConfig = {
          provider: 'openai',
          model: model || getDefaultModel('openai'),
          authMethod: 'oauth',
        };
      } else if (provider && provider !== 'none') {
        // API key-based AI configuration
        aiConfig = {
          provider,
          model: model || getDefaultModel(provider),
          apiKey: apiKey || undefined,
          authMethod: 'apikey',
        };
      }

      const config = {
        server: { port: 3847, host: 'localhost' },
        ai: aiConfig,
        onboarded: true,
      };

      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });

      if (response.ok) {
        setStep('complete');
        setTimeout(() => onComplete(), 1500);
      } else {
        const data = await response.json();
        setError(data.error ?? 'Failed to save configuration');
      }
    } catch (err) {
      setError('Network error: Could not save configuration');
    } finally {
      setSaving(false);
    }
  };

  const getDefaultModel = (p: string): string => {
    switch (p) {
      case 'anthropic': return 'claude-sonnet-4-20250514';
      case 'openai': return 'gpt-4o';
      case 'ollama': return 'llama3.2';
      default: return '';
    }
  };

  const getModelOptions = (p: string): { id: string; name: string; desc: string }[] => {
    switch (p) {
      case 'anthropic':
        return [
          { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', desc: 'Fast and capable - recommended' },
          { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', desc: 'Most capable, best for complex tasks' },
          { id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5', desc: 'Fastest and most affordable' },
        ];
      case 'openai':
        return [
          { id: 'gpt-4o', name: 'GPT-4o', desc: 'Most capable - recommended' },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Fast and affordable' },
          { id: 'o1', name: 'o1', desc: 'Advanced reasoning' },
          { id: 'o1-mini', name: 'o1-mini', desc: 'Fast reasoning' },
        ];
      default:
        return [];
    }
  };

  const needsAuthMethod = provider === 'openai';
  const needsApiKey = provider && provider !== 'none' && provider !== 'ollama' && provider !== 'cli' && !(provider === 'openai' && authMethod === 'oauth');
  const needsModelSelection = provider && provider !== 'none' && provider !== 'cli';
  const needsCliSetup = provider === 'cli';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          padding: '40px',
        }}
      >
        {/* Progress indicator */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '40px', justifyContent: 'center' }}>
          {['welcome', 'ai', 'setup', 'model', 'complete'].map((s, i) => (
            <div
              key={s}
              style={{
                width: '40px',
                height: '4px',
                borderRadius: '2px',
                background: (['welcome', 'ai', 'auth-method', 'apikey', 'cli-setup', 'model', 'complete'].indexOf(step) >= i)
                  ? 'var(--accent-purple)'
                  : 'var(--bg-tertiary)',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>

        {/* Welcome Step */}
        {step === 'welcome' && (
          <div style={{ textAlign: 'center' }}>
            <svg viewBox="0 0 100 100" width="64" height="64" style={{ marginBottom: '24px' }}>
              <defs>
                <linearGradient id="onboardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{stopColor:'#8B5CF6'}}/>
                  <stop offset="100%" style={{stopColor:'#EC4899'}}/>
                </linearGradient>
              </defs>
              <rect x="8" y="8" width="84" height="84" rx="22" fill="url(#onboardGrad)"/>
              <g transform="translate(50, 50)">
                <rect x="-28" y="-20" width="56" height="10" rx="5" fill="white" opacity="0.9"/>
                <rect x="-28" y="10" width="56" height="10" rx="5" fill="white" opacity="0.9"/>
                <rect x="-20" y="-28" width="10" height="18" rx="5" fill="white" opacity="0.6"/>
                <rect x="-20" y="0" width="10" height="10" rx="5" fill="white" opacity="0.9"/>
                <rect x="-20" y="20" width="10" height="8" rx="5" fill="white" opacity="0.6"/>
                <rect x="10" y="-28" width="10" height="10" rx="5" fill="white" opacity="0.9"/>
                <rect x="10" y="-8" width="10" height="18" rx="5" fill="white" opacity="0.6"/>
                <rect x="10" y="20" width="10" height="8" rx="5" fill="white" opacity="0.9"/>
              </g>
            </svg>
            <h1 style={{ fontSize: '32px', fontWeight: 700, marginBottom: '16px' }}>
              Welcome to Openweavr
            </h1>
            <p style={{ fontSize: '16px', color: 'var(--text-secondary)', marginBottom: '40px', lineHeight: 1.6 }}>
              Self-hosted workflow automation for developers.<br />
              Let's get you set up in just a few steps.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => setStep('ai')}
              style={{ padding: '14px 32px', fontSize: '16px' }}
            >
              Get Started
            </button>
          </div>
        )}

        {/* AI Provider Step */}
        {step === 'ai' && (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px', textAlign: 'center' }}>
              Choose an AI Provider
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '32px', textAlign: 'center' }}>
              Enable AI-powered workflow generation and actions.
            </p>

            <div style={{ display: 'grid', gap: '12px', marginBottom: '32px' }}>
              {[
                { id: 'anthropic', name: 'Anthropic', desc: 'Claude models - recommended', icon: '🟣' },
                { id: 'openai', name: 'OpenAI', desc: 'GPT models', icon: '🟢' },
                { id: 'ollama', name: 'Ollama', desc: 'Local models - no API key needed', icon: '🦙' },
                { id: 'cli', name: 'CLI Tools', desc: 'Use claude, ollama, or llm CLI - no API key', icon: '💻' },
                { id: 'none', name: 'Skip for now', desc: 'You can configure this later', icon: '⏭️' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setProvider(opt.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '16px 20px',
                    background: provider === opt.id ? 'var(--bg-hover)' : 'var(--bg-secondary)',
                    border: `2px solid ${provider === opt.id ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    transition: 'all 0.15s',
                    color: '#fff',
                  }}
                >
                  <span style={{ fontSize: '24px' }}>{opt.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: '2px', color: '#fff' }}>{opt.name}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{opt.desc}</div>
                  </div>
                  {provider === opt.id && (
                    <span style={{ marginLeft: 'auto', color: 'var(--accent-purple)', fontSize: '20px' }}>✓</span>
                  )}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setStep('welcome')}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (needsAuthMethod) {
                    setStep('auth-method');
                  } else if (needsApiKey) {
                    setStep('apikey');
                  } else if (needsCliSetup) {
                    setStep('cli-setup');
                  } else if (needsModelSelection) {
                    setStep('model');
                  } else {
                    handleFinish();
                  }
                }}
                disabled={!provider}
                style={{ flex: 1 }}
              >
                {needsAuthMethod || needsApiKey || needsCliSetup || needsModelSelection ? 'Next' : 'Finish Setup'}
              </button>
            </div>
          </div>
        )}

        {/* Auth Method Step (OpenAI only) */}
        {step === 'auth-method' && (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px', textAlign: 'center' }}>
              Choose Authentication Method
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '32px', textAlign: 'center' }}>
              How would you like to authenticate with OpenAI?
            </p>

            <div style={{ display: 'grid', gap: '12px', marginBottom: '32px' }}>
              <button
                onClick={() => setAuthMethod('oauth')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '16px 20px',
                  background: authMethod === 'oauth' ? 'var(--bg-hover)' : 'var(--bg-secondary)',
                  border: `2px solid ${authMethod === 'oauth' ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'all 0.15s',
                  color: '#fff',
                }}
              >
                <span style={{ fontSize: '24px' }}>🔐</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: '2px', color: '#fff' }}>
                    Sign in with OpenAI
                    <span style={{
                      marginLeft: '8px',
                      fontSize: '11px',
                      padding: '2px 6px',
                      background: 'var(--accent-purple)',
                      borderRadius: '4px',
                      color: '#fff',
                    }}>
                      Recommended
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Sign in with your OpenAI account. No API key needed.
                  </div>
                </div>
                {authMethod === 'oauth' && (
                  <span style={{ color: 'var(--accent-purple)', fontSize: '20px' }}>✓</span>
                )}
              </button>

              <button
                onClick={() => setAuthMethod('apikey')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '16px 20px',
                  background: authMethod === 'apikey' ? 'var(--bg-hover)' : 'var(--bg-secondary)',
                  border: `2px solid ${authMethod === 'apikey' ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'all 0.15s',
                  color: '#fff',
                }}
              >
                <span style={{ fontSize: '24px' }}>🔑</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: '2px', color: '#fff' }}>API Key</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Enter an OpenAI API key (requires separate API billing).
                  </div>
                </div>
                {authMethod === 'apikey' && (
                  <span style={{ color: 'var(--accent-purple)', fontSize: '20px' }}>✓</span>
                )}
              </button>
            </div>

            {authMethod === 'oauth' && (
              <div style={{ marginBottom: '24px' }}>
                {oauthConnected ? (
                  <div style={{
                    padding: '16px',
                    background: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid var(--accent-green)',
                    borderRadius: 'var(--radius-md)',
                    textAlign: 'center',
                  }}>
                    <span style={{ fontSize: '24px', marginBottom: '8px', display: 'block' }}>✓</span>
                    <div style={{ fontWeight: 600, color: 'var(--accent-green)' }}>Connected to OpenAI</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Your account is authenticated and ready to use.
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn btn-secondary"
                    onClick={handleOAuthConnect}
                    disabled={oauthConnecting}
                    style={{ width: '100%', padding: '14px' }}
                  >
                    {oauthConnecting ? (
                      <>
                        <span style={{ marginRight: '8px' }}>◌</span>
                        Waiting for authentication...
                      </>
                    ) : (
                      <>
                        <span style={{ marginRight: '8px' }}>🔐</span>
                        Connect with OpenAI
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {error && (
              <div style={{
                padding: '12px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--accent-red)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--accent-red)',
                fontSize: '13px',
                marginBottom: '24px',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setStep('ai');
                  setAuthMethod('apikey');
                  setOauthConnected(false);
                }}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (authMethod === 'oauth') {
                    if (oauthConnected) {
                      setStep('model');
                    }
                    // If not connected, button is disabled
                  } else {
                    setStep('apikey');
                  }
                }}
                disabled={authMethod === 'oauth' && !oauthConnected}
                style={{ flex: 1 }}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* API Key Step */}
        {step === 'apikey' && (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px', textAlign: 'center' }}>
              Enter your API Key
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '32px', textAlign: 'center' }}>
              {provider === 'anthropic' && 'Get your API key from the Anthropic Console.'}
              {provider === 'openai' && 'Get your API key from the OpenAI Platform.'}
            </p>

            <div style={{ marginBottom: '24px' }}>
              <label className="label">
                {provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API Key
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  className="input"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{ padding: '8px 12px' }}
                >
                  {showApiKey ? '🙈' : '👁️'}
                </button>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
                {provider === 'anthropic' && (
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent-purple)' }}
                  >
                    Get your Anthropic API key →
                  </a>
                )}
                {provider === 'openai' && (
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent-purple)' }}
                  >
                    Get your OpenAI API key →
                  </a>
                )}
              </p>
            </div>

            {error && (
              <div style={{
                padding: '12px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--accent-red)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--accent-red)',
                fontSize: '13px',
                marginBottom: '24px',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn btn-ghost"
                onClick={() => provider === 'openai' ? setStep('auth-method') : setStep('ai')}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep('model')}
                disabled={!apiKey}
                style={{ flex: 1 }}
              >
                Next
              </button>
            </div>

            <button
              className="btn btn-ghost"
              onClick={() => {
                setApiKey('');
                setStep('model');
              }}
              style={{ width: '100%', marginTop: '12px', fontSize: '13px' }}
            >
              Skip - I'll add it later in Settings
            </button>
          </div>
        )}

        {/* Model Selection Step */}
        {step === 'model' && (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px', textAlign: 'center' }}>
              Choose a Model
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '32px', textAlign: 'center' }}>
              {provider === 'ollama'
                ? 'Enter the Ollama model you want to use.'
                : 'Select which AI model to use for workflow generation.'}
            </p>

            {provider === 'ollama' ? (
              <div style={{ marginBottom: '24px' }}>
                <label className="label">Model Name</label>
                <input
                  type="text"
                  className="input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="llama3.2"
                  style={{ width: '100%' }}
                  autoFocus
                />
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
                  Popular models: llama3.2, mistral, codellama, gemma2, qwen2.5
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px', marginBottom: '32px' }}>
                {getModelOptions(provider).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setModel(opt.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      padding: '16px 20px',
                      background: model === opt.id ? 'var(--bg-hover)' : 'var(--bg-secondary)',
                      border: `2px solid ${model === opt.id ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'all 0.15s',
                      color: '#fff',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: '2px', color: '#fff' }}>{opt.name}</div>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{opt.desc}</div>
                    </div>
                    {model === opt.id && (
                      <span style={{ marginLeft: 'auto', color: 'var(--accent-purple)', fontSize: '20px' }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <div style={{
                padding: '12px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--accent-red)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--accent-red)',
                fontSize: '13px',
                marginBottom: '24px',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  if (needsApiKey) {
                    setStep('apikey');
                  } else if (needsAuthMethod) {
                    setStep('auth-method');
                  } else {
                    setStep('ai');
                  }
                }}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleFinish}
                disabled={saving}
                style={{ flex: 1 }}
              >
                {saving ? 'Saving...' : 'Finish Setup'}
              </button>
            </div>

            {provider !== 'ollama' && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setModel('');
                  handleFinish();
                }}
                style={{ width: '100%', marginTop: '12px', fontSize: '13px' }}
              >
                Use default ({getDefaultModel(provider)})
              </button>
            )}
          </div>
        )}

        {/* CLI Setup Step */}
        {step === 'cli-setup' && (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px', textAlign: 'center' }}>
              Configure CLI AI
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '32px', textAlign: 'center' }}>
              Choose which CLI tool to use for AI operations.
            </p>

            <div style={{ display: 'grid', gap: '12px', marginBottom: '24px' }}>
              {[
                { id: 'auto', name: 'Auto-detect', desc: 'Use first available CLI tool' },
                { id: 'claude', name: 'Claude CLI', desc: 'Anthropic\'s official CLI (claude)' },
                { id: 'ollama', name: 'Ollama', desc: 'Local LLM runner (ollama run)' },
                { id: 'llm', name: 'LLM CLI', desc: 'Simon Willison\'s llm tool' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setCliTool(opt.id as typeof cliTool)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '14px 18px',
                    background: cliTool === opt.id ? 'var(--bg-hover)' : 'var(--bg-secondary)',
                    border: `2px solid ${cliTool === opt.id ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    color: '#fff',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: '2px', color: '#fff' }}>{opt.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{opt.desc}</div>
                  </div>
                  {cliTool === opt.id && (
                    <span style={{ marginLeft: 'auto', color: 'var(--accent-purple)', fontSize: '18px' }}>✓</span>
                  )}
                </button>
              ))}
            </div>

            {(cliTool === 'ollama' || cliTool === 'llm') && (
              <div style={{ marginBottom: '24px' }}>
                <label className="label">Model (optional)</label>
                <input
                  type="text"
                  className="input"
                  value={cliModel}
                  onChange={(e) => setCliModel(e.target.value)}
                  placeholder={cliTool === 'ollama' ? 'llama3.2' : 'default'}
                  style={{ width: '100%' }}
                />
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                  {cliTool === 'ollama' && 'e.g., llama3.2, mistral, codellama, gemma2'}
                  {cliTool === 'llm' && 'Leave empty for default model, or specify model name'}
                </p>
              </div>
            )}

            {error && (
              <div style={{
                padding: '12px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--accent-red)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--accent-red)',
                fontSize: '13px',
                marginBottom: '24px',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setStep('ai')}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleFinish}
                disabled={saving}
                style={{ flex: 1 }}
              >
                {saving ? 'Saving...' : 'Finish Setup'}
              </button>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '24px', textAlign: 'center' }}>
              Make sure the CLI tool is installed and accessible in your PATH.
            </p>
          </div>
        )}

        {/* Complete Step */}
        {step === 'complete' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '64px', marginBottom: '24px' }}>✨</div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px' }}>
              You're all set!
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              Openweavr is ready. Redirecting to dashboard...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
