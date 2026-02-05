import {
  SiGithub,
  SiSlack,
  SiDiscord,
  SiTelegram,
  SiNotion,
  SiLinear,
  SiWhatsapp,
  SiOpenai,
} from 'react-icons/si';
import {
  FaRobot,
  FaEnvelope,
  FaClock,
  FaGlobe,
  FaCode,
  FaApple,
  FaAws,
  FaMicrosoft,
  FaGoogle,
} from 'react-icons/fa6';

interface IntegrationIconProps {
  name: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

const iconMap: Record<string, React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>> = {
  // Services
  github: SiGithub,
  slack: SiSlack,
  discord: SiDiscord,
  telegram: SiTelegram,
  whatsapp: SiWhatsapp,
  notion: SiNotion,
  linear: SiLinear,

  // AI Providers
  openai: SiOpenai,
  anthropic: FaRobot, // Anthropic doesn't have official icon in react-icons
  ollama: FaRobot,
  google: FaGoogle,
  'amazon-bedrock': FaAws,
  'azure-openai': FaMicrosoft,
  xai: FaRobot,
  groq: FaRobot,
  cerebras: FaRobot,
  mistral: FaRobot,
  openrouter: FaGlobe,

  // Core plugins
  ai: FaRobot,
  http: FaGlobe,
  cron: FaClock,
  email: FaEnvelope,
  json: FaCode,
  imessage: FaApple,
};

// Brand colors for each service
const brandColors: Record<string, string> = {
  github: '#ffffff',
  slack: '#4A154B',
  discord: '#5865F2',
  telegram: '#26A5E4',
  whatsapp: '#25D366',
  notion: '#ffffff',
  linear: '#5E6AD2',
  openai: '#00A67E',
  anthropic: '#D4A27F',
  ollama: '#ffffff',
  google: '#4285F4',
  'amazon-bedrock': '#FF9900',
  'azure-openai': '#0078D4',
};

export function IntegrationIcon({ name, size = 24, color, style }: IntegrationIconProps) {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const Icon = iconMap[normalizedName];

  if (!Icon) {
    // Fallback to first letter
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          fontSize: size * 0.6,
          fontWeight: 600,
          background: 'var(--bg-tertiary)',
          borderRadius: '4px',
          ...style,
        }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }

  const iconColor = color || brandColors[normalizedName] || 'currentColor';

  return <Icon size={size} color={iconColor} style={style} />;
}

export function getIntegrationIcon(name: string) {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return iconMap[normalizedName] || null;
}

export { brandColors };
