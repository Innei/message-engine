import { describe, expect, it, vi } from 'vitest';

import {
  OPENROUTER_KEY_STORAGE_KEY,
  readStoredOpenRouterKey,
  storeOpenRouterKey,
} from '../demo/client/api-key-storage.js';

const createStorage = (): Storage => {
  const values = new Map<string, string>();

  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

describe('demo OpenRouter key storage', () => {
  it('restores a key saved by an earlier demo render', () => {
    const storage = createStorage();

    storeOpenRouterKey('sk-or-v1-persisted', storage);

    expect(readStoredOpenRouterKey(storage)).toBe('sk-or-v1-persisted');
  });

  it('removes the saved key when the field is cleared', () => {
    const storage = createStorage();
    storage.setItem(OPENROUTER_KEY_STORAGE_KEY, 'sk-or-v1-persisted');

    storeOpenRouterKey('   ', storage);

    expect(readStoredOpenRouterKey(storage)).toBe('');
  });

  it('keeps the demo usable when browser storage is unavailable', () => {
    const storage = createStorage();
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    expect(readStoredOpenRouterKey(storage)).toBe('');
    expect(() => storeOpenRouterKey('sk-or-v1-session-only', storage)).not.toThrow();
  });
});
