import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import linearPlugin from './index.js';

describe('Linear Plugin', () => {
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
    env: { LINEAR_API_KEY: 'lin_api_test123', ...env },
    log: vi.fn(),
    emit: vi.fn(),
  });

  describe('create_issue action', () => {
    it('should create a Linear issue', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: 'issue-123',
                identifier: 'PROJ-42',
                title: 'New Bug',
                url: 'https://linear.app/team/issue/PROJ-42',
              },
            },
          },
        }),
      });

      const action = linearPlugin.actions.find((a) => a.name === 'create_issue');
      expect(action).toBeDefined();

      const ctx = createContext({
        teamId: 'team-123',
        title: 'New Bug',
        description: 'Something is broken',
        priority: 2,
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.linear.app/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'lin_api_test123',
          }),
        })
      );
      expect(result).toBeDefined();
    });

    it('should create issue with labels and assignee', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            issueCreate: {
              success: true,
              issue: { id: 'issue-456', identifier: 'PROJ-43' },
            },
          },
        }),
      });

      const action = linearPlugin.actions.find((a) => a.name === 'create_issue');
      const ctx = createContext({
        teamId: 'team-123',
        title: 'Feature Request',
        labelIds: ['label-1', 'label-2'],
        assigneeId: 'user-123',
      });

      await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should throw error without API key', async () => {
      const action = linearPlugin.actions.find((a) => a.name === 'create_issue');
      const ctx = {
        config: { teamId: 'team', title: 'Test' },
        env: {},
        log: vi.fn(),
        emit: vi.fn(),
      };

      await expect(action!.execute(ctx)).rejects.toThrow('Linear API key required');
    });
  });

  describe('update_issue action', () => {
    it('should update an existing issue', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            issueUpdate: {
              success: true,
              issue: {
                id: 'issue-123',
                identifier: 'PROJ-42',
                title: 'Updated Title',
              },
            },
          },
        }),
      });

      const action = linearPlugin.actions.find((a) => a.name === 'update_issue');
      const ctx = createContext({
        issueId: 'issue-123',
        title: 'Updated Title',
        stateId: 'state-done',
      });

      const result = await action!.execute(ctx);

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('add_comment action', () => {
    it('should add a comment to an issue', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            commentCreate: {
              success: true,
              comment: {
                id: 'comment-123',
                body: 'This is a comment',
              },
            },
          },
        }),
      });

      const action = linearPlugin.actions.find((a) => a.name === 'add_comment');
      const ctx = createContext({
        issueId: 'issue-123',
        body: 'This is a comment',
      });

      const result = await action!.execute(ctx);

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('get_issue action', () => {
    it('should get an issue by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            issue: {
              id: 'issue-123',
              identifier: 'PROJ-42',
              title: 'Bug Report',
              state: { name: 'In Progress' },
              assignee: { name: 'John Doe' },
            },
          },
        }),
      });

      const action = linearPlugin.actions.find((a) => a.name === 'get_issue');
      const ctx = createContext({ issueId: 'issue-123' });

      const result = await action!.execute(ctx);

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('list_issues action', () => {
    it('should list issues with filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            issues: {
              nodes: [
                { id: 'issue-1', identifier: 'PROJ-1', title: 'Issue 1' },
                { id: 'issue-2', identifier: 'PROJ-2', title: 'Issue 2' },
              ],
            },
          },
        }),
      });

      const action = linearPlugin.actions.find((a) => a.name === 'list_issues');
      const ctx = createContext({
        teamId: 'team-123',
        first: 10,
      });

      const result = await action!.execute(ctx);

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('triggers', () => {
    it('should have issue.created trigger', () => {
      const trigger = linearPlugin.triggers?.find((t) => t.name === 'issue.created');
      expect(trigger).toBeDefined();
    });

    it('should have issue.updated trigger', () => {
      const trigger = linearPlugin.triggers?.find((t) => t.name === 'issue.updated');
      expect(trigger).toBeDefined();
    });
  });
});
