import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import discordPlugin from './index.js';

describe('Discord Plugin', () => {
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
    env: { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc', ...env },
    log: vi.fn(),
    emit: vi.fn(),
  });

  describe('send action', () => {
    it('should send a simple message', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const action = discordPlugin.actions.find((a) => a.name === 'send');
      expect(action).toBeDefined();

      const ctx = createContext({
        content: 'Hello, Discord!',
      });

      await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123/abc',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('Hello, Discord!'),
        })
      );
    });

    it('should send a message with custom username and avatar', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const action = discordPlugin.actions.find((a) => a.name === 'send');
      const ctx = createContext({
        content: 'Custom message',
        username: 'Weavr Bot',
        avatar_url: 'https://example.com/avatar.png',
      });

      await action!.execute(ctx);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.username).toBe('Weavr Bot');
      expect(body.avatar_url).toBe('https://example.com/avatar.png');
    });

    it('should throw error without webhook URL', async () => {
      const action = discordPlugin.actions.find((a) => a.name === 'send');
      const ctx = createContext({ content: 'Test' }, {});
      ctx.env = {};

      await expect(action!.execute(ctx)).rejects.toThrow('Discord webhook URL required');
    });

    it('should handle webhook errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      const action = discordPlugin.actions.find((a) => a.name === 'send');
      const ctx = createContext({ content: 'Test' });

      await expect(action!.execute(ctx)).rejects.toThrow('Discord');
    });
  });

  describe('embed action', () => {
    it('should send a rich embed', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const action = discordPlugin.actions.find((a) => a.name === 'embed');
      expect(action).toBeDefined();

      const ctx = createContext({
        title: 'Build Status',
        description: 'Build #42 completed successfully',
        color: 0x00ff00,
        fields: [
          { name: 'Duration', value: '2m 30s', inline: true },
          { name: 'Branch', value: 'main', inline: true },
        ],
        footer: { text: 'Weavr CI' },
        timestamp: '2024-01-15T10:00:00Z',
      });

      await action!.execute(ctx);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toBe('Build Status');
      expect(body.embeds[0].color).toBe(0x00ff00);
      expect(body.embeds[0].fields).toHaveLength(2);
    });

    it('should send embed with thumbnail and image', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const action = discordPlugin.actions.find((a) => a.name === 'embed');
      const ctx = createContext({
        title: 'Image Post',
        thumbnail: 'https://example.com/thumb.png',
        image: 'https://example.com/image.png',
      });

      await action!.execute(ctx);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds).toBeDefined();
      expect(body.embeds[0].title).toBe('Image Post');
    });
  });

  describe('triggers', () => {
    it('should have webhook trigger', () => {
      const trigger = discordPlugin.triggers?.find((t) => t.name === 'webhook');
      expect(trigger).toBeDefined();
      expect(trigger?.description).toContain('webhook');
    });
  });
});
