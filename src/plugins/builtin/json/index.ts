import { definePlugin, defineAction } from '../../sdk/types.js';

export default definePlugin({
  name: 'json',
  version: '1.0.0',
  description: 'JSON manipulation utilities',

  actions: [
    defineAction({
      name: 'parse',
      description: 'Parse a JSON string',
      async execute(ctx) {
        const input = ctx.config.input as string;

        try {
          return JSON.parse(input);
        } catch (err) {
          throw new Error(`Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    }),

    defineAction({
      name: 'stringify',
      description: 'Convert object to JSON string',
      async execute(ctx) {
        const input = ctx.config.input;
        const pretty = ctx.config.pretty as boolean ?? false;

        return pretty ? JSON.stringify(input, null, 2) : JSON.stringify(input);
      },
    }),

    defineAction({
      name: 'get',
      description: 'Get a value from JSON using dot notation path',
      async execute(ctx) {
        const input = ctx.config.input as Record<string, unknown>;
        const path = ctx.config.path as string;
        const defaultValue = ctx.config.default;

        const parts = path.split('.');
        let current: unknown = input;

        for (const part of parts) {
          if (current === null || current === undefined) {
            return defaultValue;
          }
          if (typeof current === 'object' && current !== null) {
            current = (current as Record<string, unknown>)[part];
          } else {
            return defaultValue;
          }
        }

        return current ?? defaultValue;
      },
    }),

    defineAction({
      name: 'set',
      description: 'Set a value in JSON using dot notation path',
      async execute(ctx) {
        const input = ctx.config.input as Record<string, unknown>;
        const path = ctx.config.path as string;
        const value = ctx.config.value;

        const result = JSON.parse(JSON.stringify(input)); // Deep clone
        const parts = path.split('.');
        let current = result;

        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!(part in current)) {
            current[part] = {};
          }
          current = current[part] as Record<string, unknown>;
        }

        current[parts[parts.length - 1]] = value;
        return result;
      },
    }),

    defineAction({
      name: 'merge',
      description: 'Deep merge multiple objects',
      async execute(ctx) {
        const objects = ctx.config.objects as Array<Record<string, unknown>>;

        const deepMerge = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
          const result = { ...target };
          for (const key of Object.keys(source)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
              result[key] = deepMerge(
                (result[key] as Record<string, unknown>) ?? {},
                source[key] as Record<string, unknown>
              );
            } else {
              result[key] = source[key];
            }
          }
          return result;
        };

        return objects.reduce((acc, obj) => deepMerge(acc, obj), {});
      },
    }),

    defineAction({
      name: 'pick',
      description: 'Pick specific keys from an object',
      async execute(ctx) {
        const input = ctx.config.input as Record<string, unknown>;
        const keys = ctx.config.keys as string[];

        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in input) {
            result[key] = input[key];
          }
        }
        return result;
      },
    }),

    defineAction({
      name: 'omit',
      description: 'Omit specific keys from an object',
      async execute(ctx) {
        const input = ctx.config.input as Record<string, unknown>;
        const keys = ctx.config.keys as string[];
        const keysSet = new Set(keys);

        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input)) {
          if (!keysSet.has(key)) {
            result[key] = value;
          }
        }
        return result;
      },
    }),

    defineAction({
      name: 'filter',
      description: 'Filter an array based on a field value',
      async execute(ctx) {
        const input = ctx.config.input as Array<Record<string, unknown>>;
        const field = ctx.config.field as string;
        const value = ctx.config.value;
        const operator = (ctx.config.operator as string) ?? 'eq';

        return input.filter((item) => {
          const fieldValue = item[field];
          switch (operator) {
            case 'eq':
              return fieldValue === value;
            case 'ne':
              return fieldValue !== value;
            case 'gt':
              return (fieldValue as number) > (value as number);
            case 'gte':
              return (fieldValue as number) >= (value as number);
            case 'lt':
              return (fieldValue as number) < (value as number);
            case 'lte':
              return (fieldValue as number) <= (value as number);
            case 'contains':
              return String(fieldValue).includes(String(value));
            case 'startsWith':
              return String(fieldValue).startsWith(String(value));
            case 'endsWith':
              return String(fieldValue).endsWith(String(value));
            default:
              return false;
          }
        });
      },
    }),

    defineAction({
      name: 'map',
      description: 'Map an array, extracting specific fields',
      async execute(ctx) {
        const input = ctx.config.input as Array<Record<string, unknown>>;
        const fields = ctx.config.fields as string[];

        return input.map((item) => {
          if (fields.length === 1) {
            return item[fields[0]];
          }
          const result: Record<string, unknown> = {};
          for (const field of fields) {
            result[field] = item[field];
          }
          return result;
        });
      },
    }),

    defineAction({
      name: 'sort',
      description: 'Sort an array by a field',
      async execute(ctx) {
        const input = ctx.config.input as Array<Record<string, unknown>>;
        const field = ctx.config.field as string;
        const order = (ctx.config.order as 'asc' | 'desc') ?? 'asc';

        const sorted = [...input].sort((a, b) => {
          const aVal = a[field] as string | number;
          const bVal = b[field] as string | number;
          if (aVal < bVal) return order === 'asc' ? -1 : 1;
          if (aVal > bVal) return order === 'asc' ? 1 : -1;
          return 0;
        });

        return sorted;
      },
    }),
  ],
});
