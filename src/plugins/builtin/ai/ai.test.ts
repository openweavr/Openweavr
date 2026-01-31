import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import aiPlugin from './index.js';

describe('AI Plugin', () => {
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
    env,
    log: vi.fn(),
    emit: vi.fn(),
  });

  describe('complete action', () => {
    it('should complete text using Anthropic', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'Claude response here.' }],
        }),
      });

      const action = aiPlugin.actions.find((a) => a.name === 'complete');
      expect(action).toBeDefined();

      const ctx = createContext(
        { prompt: 'Hello Claude' },
        { ANTHROPIC_API_KEY: 'sk-ant-test123' }
      );

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-test123',
          }),
        })
      );
      expect(result.text).toBe('Claude response here.');
      expect(result.provider).toBe('anthropic');
    });

    it('should complete text using OpenAI when no Anthropic key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'OpenAI response here.' } }],
        }),
      });

      const action = aiPlugin.actions.find((a) => a.name === 'complete');
      const ctx = createContext(
        { prompt: 'Hello GPT' },
        { OPENAI_API_KEY: 'sk-test123' }
      );

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-test123',
          }),
        })
      );
      expect(result.text).toBe('OpenAI response here.');
      expect(result.provider).toBe('openai');
    });

    it('should throw error without API key', async () => {
      const action = aiPlugin.actions.find((a) => a.name === 'complete');
      const ctx = createContext({ prompt: 'Test' }, {});

      await expect(action!.execute(ctx)).rejects.toThrow('No AI API key found');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      });

      const action = aiPlugin.actions.find((a) => a.name === 'complete');
      const ctx = createContext(
        { prompt: 'Test' },
        { ANTHROPIC_API_KEY: 'test' }
      );

      await expect(action!.execute(ctx)).rejects.toThrow();
    });
  });

  describe('summarize action', () => {
    it('should summarize text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'This is a summary of the input text.' }],
        }),
      });

      const action = aiPlugin.actions.find((a) => a.name === 'summarize');
      expect(action).toBeDefined();

      const ctx = createContext(
        {
          text: 'A very long article about various topics...',
          maxLength: 100,
        },
        { ANTHROPIC_API_KEY: 'test-key' }
      );

      const result = await action!.execute(ctx);

      expect(result.summary).toBe('This is a summary of the input text.');
    });

    it('should summarize with custom style', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: '- Point 1\n- Point 2\n- Point 3' }],
        }),
      });

      const action = aiPlugin.actions.find((a) => a.name === 'summarize');
      const ctx = createContext(
        {
          text: 'Long technical documentation...',
          style: 'bullet_points',
        },
        { ANTHROPIC_API_KEY: 'test-key' }
      );

      const result = await action!.execute(ctx);

      expect(result.summary).toContain('Point 1');
    });
  });

  describe('extract action', () => {
    it('should extract structured data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{
            text: '{"name": "John Doe", "email": "john@example.com", "phone": "555-1234"}',
          }],
        }),
      });

      const action = aiPlugin.actions.find((a) => a.name === 'extract');
      expect(action).toBeDefined();

      const ctx = createContext(
        {
          text: 'Contact John Doe at john@example.com or call 555-1234',
          fields: ['name', 'email', 'phone'],
        },
        { ANTHROPIC_API_KEY: 'test-key' }
      );

      const result = await action!.execute(ctx);

      expect(result.data).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
      });
    });

    it('should extract with schema', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{
            text: '{"items": [{"product": "Widget", "quantity": 5}], "total": 49.99}',
          }],
        }),
      });

      const action = aiPlugin.actions.find((a) => a.name === 'extract');
      const ctx = createContext(
        {
          text: 'Order: 5x Widget for $49.99',
          schema: {
            items: [{ product: 'string', quantity: 'number' }],
            total: 'number',
          },
        },
        { ANTHROPIC_API_KEY: 'test-key' }
      );

      const result = await action!.execute(ctx);

      expect(result.data.items[0].product).toBe('Widget');
      expect(result.data.total).toBe(49.99);
    });
  });

  describe('classify action', () => {
    it('should classify text into categories', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'bug' }],
        }),
      });

      const action = aiPlugin.actions.find((a) => a.name === 'classify');
      expect(action).toBeDefined();

      const ctx = createContext(
        {
          text: 'The app crashes when I click the submit button',
          categories: ['bug', 'feature', 'question', 'other'],
        },
        { ANTHROPIC_API_KEY: 'test-key' }
      );

      const result = await action!.execute(ctx);

      expect(result.category).toBe('bug');
    });

    it('should classify with descriptions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'urgent' }],
        }),
      });

      const action = aiPlugin.actions.find((a) => a.name === 'classify');
      const ctx = createContext(
        {
          text: 'Server is down! Production is affected!',
          categories: ['urgent', 'high', 'normal', 'low'],
        },
        { ANTHROPIC_API_KEY: 'test-key' }
      );

      const result = await action!.execute(ctx);

      expect(result.category).toBe('urgent');
    });
  });
});
