import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const YASREADY_ELEVENLABS_KEY_PATH = path.join(os.homedir(), '.config', 'yasready-audiobooks', 'elevenlabs.key');

export async function loadStoredElevenLabsApiKey({ env = process.env, file = YASREADY_ELEVENLABS_KEY_PATH } = {}) {
  if (String(env.ELEVENLABS_API_KEY ?? '').trim()) {
    return Object.freeze({ loaded: false, source: 'environment', file: null });
  }
  try {
    const key = String(await readFile(file, 'utf8')).trim();
    if (!key) return Object.freeze({ loaded: false, source: 'missing-or-empty', file });
    env.ELEVENLABS_API_KEY = key;
    return Object.freeze({ loaded: true, source: 'yasready-local-config', file });
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ loaded: false, source: 'missing', file });
    throw error;
  }
}
