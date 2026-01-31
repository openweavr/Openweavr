import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import notionPlugin from './index.js';

describe('Notion Plugin', () => {
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
    env: { NOTION_API_KEY: 'secret_notion123', ...env },
    log: vi.fn(),
    emit: vi.fn(),
  });

  describe('create_page action', () => {
    it('should create a page in a database', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          properties: { title: { title: [{ text: { content: 'New Page' } }] } },
        }),
      });

      const action = notionPlugin.actions.find((a) => a.name === 'create_page');
      expect(action).toBeDefined();

      const ctx = createContext({
        parentId: 'db-123',
        parentType: 'database_id',
        title: 'New Page',
        content: 'This is the content',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer secret_notion123',
            'Notion-Version': '2022-06-28',
          }),
        })
      );
      expect(result.id).toBe('page-123');
    });

    it('should create a page under another page', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'page-456' }),
      });

      const action = notionPlugin.actions.find((a) => a.name === 'create_page');
      const ctx = createContext({
        parentId: 'page-parent',
        parentType: 'page_id',
        title: 'Subpage',
      });

      await action!.execute(ctx);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.parent.page_id).toBe('page-parent');
    });

    it('should throw error without API key', async () => {
      const action = notionPlugin.actions.find((a) => a.name === 'create_page');
      const ctx = createContext({ parentId: 'db', title: 'Test' }, {});
      ctx.env = {};

      await expect(action!.execute(ctx)).rejects.toThrow('Notion API key required');
    });
  });

  describe('update_page action', () => {
    it('should update page properties', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'page-123',
          properties: { Status: { select: { name: 'Done' } } },
        }),
      });

      const action = notionPlugin.actions.find((a) => a.name === 'update_page');
      const ctx = createContext({
        pageId: 'page-123',
        properties: { Status: { select: { name: 'Done' } } },
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages/page-123',
        expect.objectContaining({ method: 'PATCH' })
      );
      expect(result.properties.Status.select.name).toBe('Done');
    });
  });

  describe('get_page action', () => {
    it('should get a page by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          properties: { title: { title: [{ text: { content: 'My Page' } }] } },
        }),
      });

      const action = notionPlugin.actions.find((a) => a.name === 'get_page');
      const ctx = createContext({ pageId: 'page-123' });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages/page-123',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.id).toBe('page-123');
    });
  });

  describe('query_database action', () => {
    it('should query a database', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { id: 'page-1', properties: { Name: { title: [{ text: { content: 'Item 1' } }] } } },
            { id: 'page-2', properties: { Name: { title: [{ text: { content: 'Item 2' } }] } } },
          ],
          has_more: false,
        }),
      });

      const action = notionPlugin.actions.find((a) => a.name === 'query_database');
      const ctx = createContext({
        databaseId: 'db-123',
        filter: { property: 'Status', select: { equals: 'Active' } },
        sorts: [{ property: 'Name', direction: 'ascending' }],
        pageSize: 50,
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/databases/db-123/query',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.results).toHaveLength(2);
    });
  });

  describe('append_block action', () => {
    it('should append content to a page', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ id: 'block-123', type: 'paragraph' }],
        }),
      });

      const action = notionPlugin.actions.find((a) => a.name === 'append_block');
      const ctx = createContext({
        pageId: 'page-123',
        content: 'New paragraph content',
        type: 'paragraph',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/blocks/page-123/children',
        expect.objectContaining({ method: 'PATCH' })
      );
      expect(result.results[0].type).toBe('paragraph');
    });
  });

  describe('search action', () => {
    it('should search Notion', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { id: 'page-1', object: 'page' },
            { id: 'db-1', object: 'database' },
          ],
          has_more: false,
        }),
      });

      const action = notionPlugin.actions.find((a) => a.name === 'search');
      const ctx = createContext({
        query: 'project notes',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/search',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.results).toHaveLength(2);
    });
  });

  describe('triggers', () => {
    it('should have page.updated trigger', () => {
      const trigger = notionPlugin.triggers?.find((t) => t.name === 'page.updated');
      expect(trigger).toBeDefined();
    });
  });
});
