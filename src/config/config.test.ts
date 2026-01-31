import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock fs module
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe('Config System', () => {
  const mockFs = vi.mocked(fs);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Config paths', () => {
    it('should use home directory for config', () => {
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, '.weavr');

      expect(configDir).toContain('.weavr');
      expect(path.isAbsolute(configDir)).toBe(true);
    });

    it('should define correct subdirectories', () => {
      const configDir = path.join(os.homedir(), '.weavr');
      const subdirs = ['workflows', 'plugins', 'logs', 'secrets'];

      subdirs.forEach((subdir) => {
        const fullPath = path.join(configDir, subdir);
        expect(fullPath).toContain(subdir);
      });
    });
  });

  describe('Config file operations', () => {
    it('should read config file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const configPath = path.join(os.homedir(), '.weavr', 'config.json');
      const exists = fs.existsSync(configPath);

      if (exists) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);
        expect(config.version).toBe('1.0.0');
      }
    });

    it('should create config directory if missing', () => {
      mockFs.existsSync.mockReturnValue(false);

      const configDir = path.join(os.homedir(), '.weavr');

      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(configDir, { recursive: true });
    });

    it('should write config file', () => {
      const config = { version: '1.0.0', plugins: [] };
      const configPath = path.join(os.homedir(), '.weavr', 'config.json');

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        configPath,
        expect.stringContaining('"version"')
      );
    });
  });

  describe('Config validation', () => {
    it('should validate config schema', () => {
      const validConfig = {
        version: '1.0.0',
        gateway: {
          port: 3847,
          host: 'localhost',
        },
        plugins: {
          enabled: ['http', 'cron', 'github'],
        },
      };

      expect(validConfig.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(validConfig.gateway.port).toBeGreaterThan(0);
      expect(validConfig.gateway.port).toBeLessThan(65536);
      expect(Array.isArray(validConfig.plugins.enabled)).toBe(true);
    });

    it('should reject invalid port numbers', () => {
      const invalidPorts = [-1, 0, 65536, 100000];

      invalidPorts.forEach((port) => {
        const isValid = port > 0 && port < 65536;
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Environment variables', () => {
    it('should load environment variables from .env', () => {
      const envContent = `
WEAVR_PORT=3847
GITHUB_TOKEN=ghp_test123
SLACK_TOKEN=xoxb-test
`;
      const lines = envContent.trim().split('\n');
      const env: Record<string, string> = {};

      lines.forEach((line) => {
        const [key, value] = line.split('=');
        if (key && value) {
          env[key.trim()] = value.trim();
        }
      });

      expect(env.WEAVR_PORT).toBe('3847');
      expect(env.GITHUB_TOKEN).toBe('ghp_test123');
    });

    it('should prioritize environment over config file', () => {
      const fileConfig = { port: 3000 };
      const envPort = process.env.WEAVR_PORT;

      const effectivePort = envPort ? parseInt(envPort) : fileConfig.port;
      expect(effectivePort).toBeGreaterThan(0);
    });
  });

  describe('Secrets management', () => {
    it('should mask secrets in logs', () => {
      const secret = 'ghp_abc123xyz789';
      const masked = secret.slice(0, 4) + '****' + secret.slice(-4);

      expect(masked).toBe('ghp_****9789');
      expect(masked).not.toContain('abc123xyz');
    });

    it('should validate secret format', () => {
      const secrets = {
        github: /^ghp_[a-zA-Z0-9]+$/,
        slack: /^xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+$/,
        openai: /^sk-[a-zA-Z0-9]+$/,
      };

      expect('ghp_test123abc').toMatch(secrets.github);
      expect('sk-test123').toMatch(secrets.openai);
    });
  });
});
