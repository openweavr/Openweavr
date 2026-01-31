import { describe, it, expect, vi } from 'vitest';
import jsonPlugin from './index.js';

describe('JSON Plugin', () => {
  const createContext = (config: Record<string, unknown>) => ({
    config,
    env: {},
    log: vi.fn(),
    emit: vi.fn(),
  });

  describe('parse action', () => {
    it('should parse valid JSON string', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'parse');
      expect(action).toBeDefined();

      const ctx = createContext({ input: '{"name":"John","age":30}' });
      const result = await action!.execute(ctx);

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should parse JSON arrays', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'parse');
      const ctx = createContext({ input: '[1, 2, 3]' });
      const result = await action!.execute(ctx);

      expect(result).toEqual([1, 2, 3]);
    });

    it('should throw error for invalid JSON', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'parse');
      const ctx = createContext({ input: 'not valid json' });

      await expect(action!.execute(ctx)).rejects.toThrow('Failed to parse JSON');
    });
  });

  describe('stringify action', () => {
    it('should convert object to JSON string', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'stringify');
      expect(action).toBeDefined();

      const ctx = createContext({ input: { foo: 'bar' } });
      const result = await action!.execute(ctx);

      expect(result).toBe('{"foo":"bar"}');
    });

    it('should pretty print when requested', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'stringify');
      const ctx = createContext({ input: { foo: 'bar' }, pretty: true });
      const result = await action!.execute(ctx);

      expect(result).toBe('{\n  "foo": "bar"\n}');
    });
  });

  describe('get action', () => {
    it('should get value by dot path', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'get');
      expect(action).toBeDefined();

      const ctx = createContext({
        input: { user: { name: 'John', address: { city: 'NYC' } } },
        path: 'user.address.city',
      });
      const result = await action!.execute(ctx);

      expect(result).toBe('NYC');
    });

    it('should return default for missing path', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'get');
      const ctx = createContext({
        input: { user: { name: 'John' } },
        path: 'user.address.city',
        default: 'Unknown',
      });
      const result = await action!.execute(ctx);

      expect(result).toBe('Unknown');
    });

    it('should handle array access', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'get');
      const ctx = createContext({
        input: { items: [{ id: 1 }, { id: 2 }] },
        path: 'items.0.id',
      });
      const result = await action!.execute(ctx);

      expect(result).toBe(1);
    });
  });

  describe('set action', () => {
    it('should set value by dot path', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'set');
      expect(action).toBeDefined();

      const ctx = createContext({
        input: { user: { name: 'John' } },
        path: 'user.age',
        value: 30,
      });
      const result = await action!.execute(ctx);

      expect(result).toEqual({ user: { name: 'John', age: 30 } });
    });

    it('should create nested paths', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'set');
      const ctx = createContext({
        input: {},
        path: 'a.b.c',
        value: 'deep',
      });
      const result = await action!.execute(ctx);

      expect(result).toEqual({ a: { b: { c: 'deep' } } });
    });

    it('should not mutate original input', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'set');
      const original = { user: { name: 'John' } };
      const ctx = createContext({
        input: original,
        path: 'user.age',
        value: 30,
      });
      await action!.execute(ctx);

      expect(original).toEqual({ user: { name: 'John' } });
    });
  });

  describe('merge action', () => {
    it('should deep merge multiple objects', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'merge');
      expect(action).toBeDefined();

      const ctx = createContext({
        objects: [
          { a: 1, b: { x: 1 } },
          { b: { y: 2 }, c: 3 },
          { b: { z: 3 } },
        ],
      });
      const result = await action!.execute(ctx);

      expect(result).toEqual({ a: 1, b: { x: 1, y: 2, z: 3 }, c: 3 });
    });

    it('should override primitives', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'merge');
      const ctx = createContext({
        objects: [{ a: 1 }, { a: 2 }],
      });
      const result = await action!.execute(ctx);

      expect(result).toEqual({ a: 2 });
    });
  });

  describe('pick action', () => {
    it('should pick specified keys', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'pick');
      expect(action).toBeDefined();

      const ctx = createContext({
        input: { a: 1, b: 2, c: 3, d: 4 },
        keys: ['a', 'c'],
      });
      const result = await action!.execute(ctx);

      expect(result).toEqual({ a: 1, c: 3 });
    });

    it('should ignore missing keys', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'pick');
      const ctx = createContext({
        input: { a: 1, b: 2 },
        keys: ['a', 'z'],
      });
      const result = await action!.execute(ctx);

      expect(result).toEqual({ a: 1 });
    });
  });

  describe('omit action', () => {
    it('should omit specified keys', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'omit');
      expect(action).toBeDefined();

      const ctx = createContext({
        input: { a: 1, b: 2, c: 3, d: 4 },
        keys: ['b', 'd'],
      });
      const result = await action!.execute(ctx);

      expect(result).toEqual({ a: 1, c: 3 });
    });
  });

  describe('filter action', () => {
    it('should filter array by field equality', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'filter');
      expect(action).toBeDefined();

      const ctx = createContext({
        input: [
          { status: 'active', name: 'A' },
          { status: 'inactive', name: 'B' },
          { status: 'active', name: 'C' },
        ],
        field: 'status',
        value: 'active',
        operator: 'eq',
      });
      const result = await action!.execute(ctx);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('A');
      expect(result[1].name).toBe('C');
    });

    it('should filter with greater than operator', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'filter');
      const ctx = createContext({
        input: [{ age: 20 }, { age: 30 }, { age: 40 }],
        field: 'age',
        value: 25,
        operator: 'gt',
      });
      const result = await action!.execute(ctx);

      expect(result).toHaveLength(2);
    });

    it('should filter with contains operator', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'filter');
      const ctx = createContext({
        input: [
          { email: 'user@gmail.com' },
          { email: 'user@yahoo.com' },
          { email: 'admin@gmail.com' },
        ],
        field: 'email',
        value: 'gmail',
        operator: 'contains',
      });
      const result = await action!.execute(ctx);

      expect(result).toHaveLength(2);
    });
  });

  describe('map action', () => {
    it('should extract single field', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'map');
      expect(action).toBeDefined();

      const ctx = createContext({
        input: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
        fields: ['name'],
      });
      const result = await action!.execute(ctx);

      expect(result).toEqual(['A', 'B']);
    });

    it('should extract multiple fields', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'map');
      const ctx = createContext({
        input: [{ id: 1, name: 'A', extra: 'x' }, { id: 2, name: 'B', extra: 'y' }],
        fields: ['id', 'name'],
      });
      const result = await action!.execute(ctx);

      expect(result).toEqual([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
    });
  });

  describe('sort action', () => {
    it('should sort array ascending', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'sort');
      expect(action).toBeDefined();

      const ctx = createContext({
        input: [{ score: 30 }, { score: 10 }, { score: 20 }],
        field: 'score',
        order: 'asc',
      });
      const result = await action!.execute(ctx);

      expect(result[0].score).toBe(10);
      expect(result[1].score).toBe(20);
      expect(result[2].score).toBe(30);
    });

    it('should sort array descending', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'sort');
      const ctx = createContext({
        input: [{ name: 'Apple' }, { name: 'Cherry' }, { name: 'Banana' }],
        field: 'name',
        order: 'desc',
      });
      const result = await action!.execute(ctx);

      expect(result[0].name).toBe('Cherry');
      expect(result[1].name).toBe('Banana');
      expect(result[2].name).toBe('Apple');
    });

    it('should not mutate original array', async () => {
      const action = jsonPlugin.actions.find((a) => a.name === 'sort');
      const original = [{ n: 3 }, { n: 1 }, { n: 2 }];
      const ctx = createContext({ input: original, field: 'n' });
      await action!.execute(ctx);

      expect(original[0].n).toBe(3);
    });
  });
});
