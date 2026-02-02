import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import cronPlugin from './index.js';

describe('Cron Plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createContext = (config: Record<string, unknown>) => ({
    config,
    env: {},
    log: vi.fn(),
    emit: vi.fn(),
  });

  describe('wait action', () => {
    it('should wait for specified milliseconds', async () => {
      const action = cronPlugin.actions.find((a) => a.name === 'wait');
      expect(action).toBeDefined();

      const ctx = createContext({ ms: 1000 });

      const promise = action!.execute(ctx);
      vi.advanceTimersByTime(1000);
      const result = await promise;

      expect(result.waited).toBe(1000);
    });

    it('should wait for specified seconds', async () => {
      const action = cronPlugin.actions.find((a) => a.name === 'wait');
      const ctx = createContext({ seconds: 5 });

      const promise = action!.execute(ctx);
      vi.advanceTimersByTime(5000);
      const result = await promise;

      expect(result.waited).toBe(5000);
    });

    it('should wait for specified minutes', async () => {
      const action = cronPlugin.actions.find((a) => a.name === 'wait');
      const ctx = createContext({ minutes: 2 });

      const promise = action!.execute(ctx);
      vi.advanceTimersByTime(120000);
      const result = await promise;

      expect(result.waited).toBe(120000);
    });
  });

  describe('next action', () => {
    it('should calculate next cron execution time', async () => {
      const action = cronPlugin.actions.find((a) => a.name === 'next');
      expect(action).toBeDefined();

      // Set a known time
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const ctx = createContext({ expression: '0 12 * * *', timezone: 'UTC' }); // Every day at noon UTC
      const result = await action!.execute(ctx);

      expect(result.nextRuns).toBeDefined();
      expect(result.nextRuns.length).toBeGreaterThan(0);
      expect(new Date(result.nextRuns[0]).getUTCHours()).toBe(12);
    });

    it('should handle minutely cron', async () => {
      const action = cronPlugin.actions.find((a) => a.name === 'next');

      vi.setSystemTime(new Date('2024-01-15T10:30:45Z'));

      const ctx = createContext({ expression: '* * * * *' }); // Every minute
      const result = await action!.execute(ctx);

      expect(result.nextRuns).toBeDefined();
      expect(result.nextRuns.length).toBeGreaterThan(0);
    });

    it('should return multiple next times', async () => {
      const action = cronPlugin.actions.find((a) => a.name === 'next');

      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const ctx = createContext({ expression: '0 * * * *', count: 3 }); // Every hour
      const result = await action!.execute(ctx);

      expect(result.nextRuns).toBeDefined();
      expect(result.nextRuns.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('triggers', () => {
    it('should have schedule trigger', () => {
      const trigger = cronPlugin.triggers?.find((t) => t.name === 'schedule');
      expect(trigger).toBeDefined();
      expect(trigger?.description).toContain('schedule');
    });

    it('should setup schedule trigger', async () => {
      const trigger = cronPlugin.triggers?.find((t) => t.name === 'schedule');
      const emit = vi.fn();
      const config = { expression: '*/5 * * * *' }; // Every 5 minutes

      const cleanup = await trigger!.setup(config, emit);

      expect(cleanup).toBeTypeOf('function');
      cleanup();
    });
  });
});
