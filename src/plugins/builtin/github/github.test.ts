import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import githubPlugin from './index.js';

describe('GitHub Plugin', () => {
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
    env: { GITHUB_TOKEN: 'test-token', ...env },
    log: vi.fn(),
    emit: vi.fn(),
  });

  describe('create_issue action', () => {
    it('should create a GitHub issue', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 12345,
          number: 42,
          html_url: 'https://github.com/owner/repo/issues/42',
          title: 'Bug: Something is broken',
        }),
      });

      const action = githubPlugin.actions.find((a) => a.name === 'create_issue');
      expect(action).toBeDefined();

      const ctx = createContext({
        repo: 'testowner/testrepo',
        title: 'Bug: Something is broken',
        body: 'This needs to be fixed',
        labels: ['bug', 'priority-high'],
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('github.com'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );
      expect(result).toBeDefined();
    });

    it('should throw error without token', async () => {
      const action = githubPlugin.actions.find((a) => a.name === 'create_issue');
      const ctx = {
        config: { repo: 'test/test', title: 'Test' },
        env: {},
        log: vi.fn(),
        emit: vi.fn(),
      };

      await expect(action!.execute(ctx)).rejects.toThrow('GitHub token required');
    });
  });

  describe('create_comment action', () => {
    it('should create a comment on an issue', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 99999,
          body: 'This is a comment',
          html_url: 'https://github.com/owner/repo/issues/42#issuecomment-99999',
        }),
      });

      const action = githubPlugin.actions.find((a) => a.name === 'create_comment');
      const ctx = createContext({
        repo: 'testowner/testrepo',
        issue_number: 42,
        body: 'This is a comment',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('add_labels action', () => {
    it('should add labels to an issue', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: 'bug' },
          { name: 'enhancement' },
        ],
      });

      const action = githubPlugin.actions.find((a) => a.name === 'add_labels');
      const ctx = createContext({
        repo: 'testowner/testrepo',
        issue_number: 42,
        labels: ['bug', 'enhancement'],
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('create_pr action', () => {
    it('should create a pull request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 54321,
          number: 100,
          html_url: 'https://github.com/owner/repo/pull/100',
          title: 'Add new feature',
          state: 'open',
        }),
      });

      const action = githubPlugin.actions.find((a) => a.name === 'create_pr');
      const ctx = createContext({
        repo: 'testowner/testrepo',
        title: 'Add new feature',
        body: 'This PR adds a new feature',
        head: 'feature-branch',
        base: 'main',
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalled();
      expect(result).toMatchObject({
        number: 100,
        title: 'Add new feature',
      });
    });
  });

  describe('list_issues action', () => {
    it('should list issues from a repository', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { number: 1, title: 'First issue' },
          { number: 2, title: 'Second issue' },
        ],
      });

      const action = githubPlugin.actions.find((a) => a.name === 'list_issues');
      const ctx = createContext({
        repo: 'testowner/testrepo',
        state: 'open',
        per_page: 10,
      });

      const result = await action!.execute(ctx);

      expect(mockFetch).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });
  });

  describe('triggers', () => {
    it('should have push trigger', () => {
      const trigger = githubPlugin.triggers?.find((t) => t.name === 'push');
      expect(trigger).toBeDefined();
    });

    it('should have pull_request trigger', () => {
      const trigger = githubPlugin.triggers?.find((t) => t.name === 'pull_request');
      expect(trigger).toBeDefined();
    });

    it('should have issue triggers', () => {
      const openedTrigger = githubPlugin.triggers?.find((t) => t.name === 'issue.opened');
      const labeledTrigger = githubPlugin.triggers?.find((t) => t.name === 'issue.labeled');
      expect(openedTrigger).toBeDefined();
      expect(labeledTrigger).toBeDefined();
    });
  });
});
