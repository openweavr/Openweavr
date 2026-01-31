import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import httpPlugin from './index.js';

describe('HTTP Plugin', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const createContext = (config: Record<string, unknown>) => ({
    config,
    env: {},
    log: vi.fn(),
    emit: vi.fn(),
  });

  describe('request action', () => {
    it('should make a GET request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: 'test' }),
        text: async () => '{"data":"test"}',
      });

      const action = httpPlugin.actions.find((a) => a.name === 'request');
      expect(action).toBeDefined();

      const ctx = createContext({
        url: 'https://api.example.com/data',
        method: 'GET',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalled();
      expect(result.status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ data: 'test' });
    });

    it('should make a POST request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 1 }),
        text: async () => '{"id":1}',
      });

      const action = httpPlugin.actions.find((a) => a.name === 'request');
      const ctx = createContext({
        url: 'https://api.example.com/items',
        method: 'POST',
        body: { name: 'test item' },
        headers: { 'Authorization': 'Bearer token123' },
      });

      const result = await action!.execute(ctx);

      expect(result.status).toBe(201);
      expect(result.data).toEqual({ id: 1 });
    });

    it('should handle non-JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: async () => { throw new Error('Not JSON'); },
        text: async () => 'Hello, World!',
      });

      const action = httpPlugin.actions.find((a) => a.name === 'request');
      const ctx = createContext({
        url: 'https://api.example.com/text',
        method: 'GET',
      });

      const result = await action!.execute(ctx);
      expect(result.data).toBe('Hello, World!');
    });

    it('should return response for HTTP errors (not throw)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        text: async () => 'Not Found',
      });

      const action = httpPlugin.actions.find((a) => a.name === 'request');
      const ctx = createContext({
        url: 'https://api.example.com/missing',
        method: 'GET',
      });

      const result = await action!.execute(ctx);
      expect(result.status).toBe(404);
      expect(result.ok).toBe(false);
    });
  });

  describe('get action', () => {
    it('should make a simple GET request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ users: [] }),
        text: async () => '{"users":[]}',
      });

      const action = httpPlugin.actions.find((a) => a.name === 'get');
      const ctx = createContext({ url: 'https://api.example.com/users' });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalled();
      expect(result.data).toEqual({ users: [] });
    });
  });

  describe('post action', () => {
    it('should make a POST request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true }),
        text: async () => '{"success":true}',
      });

      const action = httpPlugin.actions.find((a) => a.name === 'post');
      const ctx = createContext({
        url: 'https://api.example.com/submit',
        body: { data: 'test' },
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalled();
      expect(result.data).toEqual({ success: true });
    });
  });

  describe('triggers', () => {
    it('should have webhook trigger', () => {
      const trigger = httpPlugin.triggers?.find((t) => t.name === 'webhook');
      expect(trigger).toBeDefined();
      expect(trigger?.description).toContain('webhook');
    });
  });
});
