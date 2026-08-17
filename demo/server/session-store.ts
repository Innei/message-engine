import { DemoAgentSession, type DemoSessionSnapshot } from './session-lab.js';

export interface DemoSessionCache {
  delete(sessionId: string): Promise<void>;
  forgotten(sessionId: string): Promise<boolean>;
  get(sessionId: string): Promise<DemoSessionSnapshot | undefined>;
  set(sessionId: string, snapshot: DemoSessionSnapshot): Promise<void>;
}

const SESSION_TTL_SECONDS = 30 * 60;
const TOMBSTONE_TTL_SECONDS = 60;

type CacheRecord = DemoSessionSnapshot | { destroyed: true };

const isTombstone = (value: unknown): value is { destroyed: true } =>
  typeof value === 'object' && value !== null && 'destroyed' in value && value.destroyed === true;

let extraCache: DemoSessionCache | undefined;
let vercelCachePromise: Promise<DemoSessionCache | undefined> | undefined;

export const setDemoSessionCache = (cache: DemoSessionCache | undefined): void => {
  extraCache = cache;
};

const createVercelSessionCache = async (): Promise<DemoSessionCache | undefined> => {
  if (!process.env.VERCEL) return undefined;
  try {
    const { getCache } = await import('@vercel/functions');
    const cache = getCache({ namespace: 'message-engine-lab' });
    const snapshotKey = (sessionId: string): string => `session:${sessionId}`;
    const deadKey = (sessionId: string): string => `dead:${sessionId}`;
    return {
      delete: async (sessionId) => {
        await cache.set(deadKey(sessionId), { destroyed: true } satisfies CacheRecord, {
          name: 'demo-session-dead',
          ttl: TOMBSTONE_TTL_SECONDS,
        });
      },
      forgotten: async (sessionId) => Boolean(await cache.get(deadKey(sessionId))),
      get: async (sessionId) => {
        const dead = await cache.get(deadKey(sessionId));
        if (dead) return undefined;
        const value = await cache.get(snapshotKey(sessionId));
        if (!value || isTombstone(value)) return undefined;
        return value as DemoSessionSnapshot;
      },
      set: async (sessionId, snapshot) => {
        await cache.set(snapshotKey(sessionId), snapshot, {
          name: 'demo-session',
          ttl: SESSION_TTL_SECONDS,
        });
      },
    };
  } catch {
    return undefined;
  }
};

const sharedCache = async (): Promise<DemoSessionCache | undefined> => {
  if (extraCache) return extraCache;
  vercelCachePromise ??= createVercelSessionCache();
  return vercelCachePromise;
};

export const persistDemoSession = async (session: DemoAgentSession): Promise<void> => {
  const cache = await sharedCache();
  await cache?.set(session.sessionId, session.toSnapshot());
};

export const forgetDemoSession = async (sessionId: string): Promise<void> => {
  const cache = await sharedCache();
  await cache?.delete(sessionId);
};

export const isForgottenDemoSession = async (sessionId: string): Promise<boolean> => {
  const cache = await sharedCache();
  return (await cache?.forgotten(sessionId)) ?? false;
};

export const reviveDemoSession = async (
  sessionId: string,
): Promise<DemoAgentSession | undefined> => {
  const cache = await sharedCache();
  const snapshot = await cache?.get(sessionId);
  if (!snapshot) return undefined;
  return DemoAgentSession.fromSnapshot(snapshot);
};
