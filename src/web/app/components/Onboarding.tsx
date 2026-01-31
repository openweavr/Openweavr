import { useState } from 'react';

interface OnboardingProps {
  onComplete: () => void;
}

type Step = 'welcome' | 'ai' | 'apikey' | 'cli-setup' | 'complete';

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [provider, setProvider] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cliTool, setCliTool] = useState<'auto' | 'claude' | 'ollama' | 'llm'>('auto');
  const [cliModel, setCliModel] = useState('');

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
      } else if (provider && provider !== 'none') {
        // API-based AI configuration
        aiConfig = {
          provider,
          model: getDefaultModel(provider),
          apiKey: apiKey || undefined,
        };
      }

      const config = {
        server: { port: 3847, host: 'localhost' },
        ai: aiConfig,
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

  const needsApiKey = provider && provider !== 'none' && provider !== 'ollama' && provider !== 'cli';
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
          {['welcome', 'ai', 'setup', 'complete'].map((s, i) => (
            <div
              key={s}
              style={{
                width: '40px',
                height: '4px',
                borderRadius: '2px',
                background: (['welcome', 'ai', 'apikey', 'cli-setup', 'complete'].indexOf(step) >= i)
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
            <div style={{ fontSize: '64px', marginBottom: '24px' }}>🧵</div>
            <h1 style={{ fontSize: '32px', fontWeight: 700, marginBottom: '16px' }}>
              Welcome to Weavr
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
                  if (needsApiKey) {
                    setStep('apikey');
                  } else if (needsCliSetup) {
                    setStep('cli-setup');
                  } else {
                    handleFinish();
                  }
                }}
                disabled={!provider}
                style={{ flex: 1 }}
              >
                {needsApiKey || needsCliSetup ? 'Next' : 'Finish Setup'}
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
                onClick={() => setStep('ai')}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleFinish}
                disabled={saving || !apiKey}
                style={{ flex: 1 }}
              >
                {saving ? 'Saving...' : 'Finish Setup'}
              </button>
            </div>

            <button
              className="btn btn-ghost"
              onClick={() => {
                setApiKey('');
                handleFinish();
              }}
              style={{ width: '100%', marginTop: '12px', fontSize: '13px' }}
            >
              Skip - I'll add it later in Settings
            </button>
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
              Weavr is ready. Redirecting to dashboard...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
