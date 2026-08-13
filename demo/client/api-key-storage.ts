export const OPENROUTER_KEY_STORAGE_KEY = '@innei/message-engine/demo/openrouter-key@1';

const getBrowserStorage = (): Storage | undefined => {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export const readStoredOpenRouterKey = (
  storage: Storage | undefined = getBrowserStorage(),
): string => {
  if (!storage) return '';

  try {
    return storage.getItem(OPENROUTER_KEY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

export const storeOpenRouterKey = (
  value: string,
  storage: Storage | undefined = getBrowserStorage(),
): void => {
  if (!storage) return;

  try {
    if (value.trim()) {
      storage.setItem(OPENROUTER_KEY_STORAGE_KEY, value);
      return;
    }

    storage.removeItem(OPENROUTER_KEY_STORAGE_KEY);
  } catch {
    // Keep the current input usable when browser storage is unavailable.
  }
};
