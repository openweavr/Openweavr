import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { WeavrConfig } from '../types/index.js';
import { DEFAULT_CONFIG } from '../types/index.js';

export const WEAVR_DIR = join(homedir(), '.weavr');
export const CONFIG_FILE = join(WEAVR_DIR, 'config.yaml');
export const WORKFLOWS_DIR = join(WEAVR_DIR, 'workflows');
export const PLUGINS_DIR = join(WEAVR_DIR, 'plugins');
export const LOGS_DIR = join(WEAVR_DIR, 'logs');

export async function ensureConfigDir(): Promise<void> {
  await mkdir(WEAVR_DIR, { recursive: true });
  await mkdir(WORKFLOWS_DIR, { recursive: true });
  await mkdir(PLUGINS_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });
}

export async function loadConfig(): Promise<WeavrConfig> {
  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    const parsed = parseYaml(content) as Partial<WeavrConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_CONFIG;
    }
    throw err;
  }
}

export async function saveConfig(config: WeavrConfig): Promise<void> {
  await ensureConfigDir();
  const content = stringifyYaml(config);
  await writeFile(CONFIG_FILE, content, 'utf-8');
}

export async function getWorkflowPath(name: string): Promise<string> {
  return join(WORKFLOWS_DIR, `${name}.yaml`);
}

export async function loadWorkflowFile(name: string): Promise<string> {
  const path = await getWorkflowPath(name);
  return readFile(path, 'utf-8');
}

export async function saveWorkflowFile(name: string, content: string): Promise<void> {
  const path = await getWorkflowPath(name);
  await writeFile(path, content, 'utf-8');
}
