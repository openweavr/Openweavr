import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import slackPlugin from './index.js';

describe('Slack Plugin', () => {
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
    env: { SLACK_TOKEN: 'xoxb-test-token', ...env },
    log: vi.fn(),
    emit: vi.fn(),
  });

  describe('post action', () => {
    it('should post a message to a channel', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channel: 'C12345',
          ts: '1234567890.123456',
          message: { text: 'Hello, Slack!' },
        }),
      });

      const action = slackPlugin.actions.find((a) => a.name === 'post');
      expect(action).toBeDefined();

      const ctx = createContext({
        channel: '#general',
        text: 'Hello, Slack!',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer xoxb-test-token',
          }),
        })
      );
      expect(result.ok).toBe(true);
    });

    it('should post a message with blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, ts: '123' }),
      });

      const action = slackPlugin.actions.find((a) => a.name === 'post');
      const ctx = createContext({
        channel: '#dev',
        text: 'Fallback text',
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: '*Bold text*' } },
        ],
      });

      await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          body: expect.stringContaining('blocks'),
        })
      );
    });

    it('should throw error without token', async () => {
      const action = slackPlugin.actions.find((a) => a.name === 'post');
      const ctx = {
        config: { channel: '#test', text: 'Test' },
        env: {},
        log: vi.fn(),
        emit: vi.fn(),
      };

      await expect(action!.execute(ctx)).rejects.toThrow('Slack token required');
    });
  });

  describe('update action', () => {
    it('should update an existing message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channel: 'C12345',
          ts: '1234567890.123456',
        }),
      });

      const action = slackPlugin.actions.find((a) => a.name === 'update');
      const ctx = createContext({
        channel: 'C12345',
        ts: '1234567890.123456',
        text: 'Updated message',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.update',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('react action', () => {
    it('should add a reaction to a message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      const action = slackPlugin.actions.find((a) => a.name === 'react');
      const ctx = createContext({
        channel: 'C12345',
        timestamp: '1234567890.123456',
        name: 'thumbsup',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/reactions.add',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('upload_file action', () => {
    it('should upload a file', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          file: { id: 'F12345', name: 'test.txt' },
        }),
      });

      const action = slackPlugin.actions.find((a) => a.name === 'upload_file');
      const ctx = createContext({
        channels: '#general',
        content: 'File content here',
        filename: 'test.txt',
        title: 'Test File',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/files.upload',
        expect.any(Object)
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('triggers', () => {
    it('should have message trigger', () => {
      const trigger = slackPlugin.triggers?.find((t) => t.name === 'message');
      expect(trigger).toBeDefined();
    });

    it('should have slash_command trigger', () => {
      const trigger = slackPlugin.triggers?.find((t) => t.name === 'slash_command');
      expect(trigger).toBeDefined();
    });

    it('should have reaction_added trigger', () => {
      const trigger = slackPlugin.triggers?.find((t) => t.name === 'reaction_added');
      expect(trigger).toBeDefined();
    });
  });
});
