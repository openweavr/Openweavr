import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import emailPlugin from './index.js';

describe('Email Plugin', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const createContext = (config: Record<string, unknown>, env: Record<string, string> = {}) => ({
    config,
    env: { EMAIL_API_KEY: 're_test123', EMAIL_FROM: 'test@example.com', ...env },
    log: vi.fn(),
    emit: vi.fn(),
  });

  describe('send action', () => {
    it('should send an email via API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'msg-123' }),
      });

      const action = emailPlugin.actions.find((a) => a.name === 'send');
      expect(action).toBeDefined();

      const ctx = createContext({
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'Hello, this is a test email.',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer re_test123',
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
    });

    it('should send email to multiple recipients', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'msg-456' }),
      });

      const action = emailPlugin.actions.find((a) => a.name === 'send');
      const ctx = createContext({
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Group Email',
        html: '<h1>Hello Everyone!</h1>',
      });

      await action!.execute(ctx);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.to).toEqual(['user1@example.com', 'user2@example.com']);
      expect(body.html).toBe('<h1>Hello Everyone!</h1>');
    });

    it('should use custom from address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'msg-789' }),
      });

      const action = emailPlugin.actions.find((a) => a.name === 'send');
      const ctx = createContext({
        to: 'recipient@example.com',
        subject: 'Custom From',
        text: 'Test',
        from: 'custom@mydomain.com',
      });

      await action!.execute(ctx);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.from).toBe('custom@mydomain.com');
    });

    it('should work in dry-run mode without API key', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const action = emailPlugin.actions.find((a) => a.name === 'send');
      const ctx = {
        config: {
          to: 'test@example.com',
          subject: 'Dry Run',
          text: 'This is a test',
        },
        env: { EMAIL_FROM: 'noreply@example.com' },
        log: vi.fn(),
        emit: vi.fn(),
      };

      const result = await action!.execute(ctx);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('dev-mode');
      expect(mockFetch).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid email address',
      });

      const action = emailPlugin.actions.find((a) => a.name === 'send');
      const ctx = createContext({
        to: 'valid@example.com',  // Use valid email format
        subject: 'Test',
        text: 'Test',
      });

      await expect(action!.execute(ctx)).rejects.toThrow('Email API error');
    });
  });

  describe('send_template action', () => {
    it('should send a template email via API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'msg-template-123' }),
      });

      const action = emailPlugin.actions.find((a) => a.name === 'send_template');
      expect(action).toBeDefined();

      const ctx = createContext({
        to: 'user@example.com',
        templateId: 'welcome-template',
        variables: { name: 'John', company: 'Acme Inc' },
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.success).toBe(true);
    });

    it('should work in dry-run mode without API key', async () => {
      const action = emailPlugin.actions.find((a) => a.name === 'send_template');
      const ctx = {
        config: {
          to: ['user1@example.com', 'user2@example.com'],
          templateId: 'newsletter',
          variables: { month: 'January' },
        },
        env: { EMAIL_FROM: 'noreply@example.com' },
        log: vi.fn(),
        emit: vi.fn(),
      };

      const result = await action!.execute(ctx);

      expect(result.success).toBe(true);
      expect(result.mode).toBe('dry-run');
      expect(result.templateId).toBe('newsletter');
      expect(result.to).toEqual(['user1@example.com', 'user2@example.com']);
    });
  });
});
