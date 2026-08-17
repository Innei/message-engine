import { afterEach, describe, expect, it } from 'vitest';

import {
  forgetDemoSession,
  handleDemoApi,
  resetDemoSessions,
  setDemoSessionCache,
} from '../demo/server/api-handler.js';
import type { DemoSessionSnapshot } from '../demo/server/session-lab.js';

const request = (path: string, init?: RequestInit): Promise<Response> =>
  handleDemoApi(new Request(`http://lab.test${path}`, init));

const readJson = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

afterEach(async () => {
  setDemoSessionCache(undefined);
  await resetDemoSessions();
});

describe('demo API handler', () => {
  it('accepts a relative URL from serverless hosts', async () => {
    const response = await handleDemoApi({
      method: 'GET',
      signal: AbortSignal.abort(),
      url: '/api/health?...path=health',
    } as Request);

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ status: 'ok' });
  });

  it('reports health without an environment key', async () => {
    const response = await request('/api/health');
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      environmentKeyAvailable: false,
      sessions: 0,
      status: 'ok',
    });
  });

  it('lists OpenRouter catalog models', async () => {
    const response = await request('/api/models');
    const body = await readJson(response);
    const models = body.models as Array<{ id: string }>;

    expect(response.status).toBe(200);
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((model) => model.id.startsWith('openai/'))).toBe(true);
  });

  it('creates a session and serves later turn lookups from the same map', async () => {
    const created = await request('/api/sessions', {
      body: JSON.stringify({ modelId: 'openai/gpt-4o-mini', strict: true }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const state = await readJson(created);
    const sessionId = state.sessionId as string;

    expect(created.status).toBe(201);
    expect(sessionId.startsWith('lab-')).toBe(true);
    expect(state.modelId).toBe('openai/gpt-4o-mini');
    expect(state.strict).toBe(true);

    const health = await readJson(await request('/api/health'));
    expect(health.sessions).toBe(1);

    const missing = await request(`/api/sessions/${sessionId}/turn`, {
      body: JSON.stringify({ prompt: '' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(missing.status).toBe(400);
    expect(await readJson(missing)).toEqual({ error: 'Prompt is required' });
  });

  it('rejects an unknown session and a missing model id', async () => {
    const unknown = await request('/api/sessions/missing/mutate-prefix', {
      body: JSON.stringify({ replacement: 'changed' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const invalid = await request('/api/sessions', {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(unknown.status).toBe(404);
    expect(await readJson(unknown)).toEqual({ error: 'Unknown demo session: missing' });
    expect(invalid.status).toBe(400);
    expect(await readJson(invalid)).toEqual({ error: 'modelId is required' });
  });

  it('rehydrates a session after the process-local map is cleared', async () => {
    const store = new Map<string, DemoSessionSnapshot>();
    setDemoSessionCache({
      delete: async (sessionId) => {
        store.delete(sessionId);
      },
      forgotten: async (sessionId) => !store.has(sessionId),
      get: async (sessionId) => store.get(sessionId),
      set: async (sessionId, snapshot) => {
        store.set(sessionId, snapshot);
      },
    });

    const created = await request('/api/sessions', {
      body: JSON.stringify({ modelId: 'openai/gpt-4o-mini' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const sessionId = (await readJson(created)).sessionId as string;
    await resetDemoSessions();

    const turn = await request(`/api/sessions/${sessionId}/turn`, {
      body: JSON.stringify({ prompt: '' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(turn.status).toBe(400);
    expect(await readJson(turn)).toEqual({ error: 'Prompt is required' });
  });

  it('ignores a process-local session after the shared cache marks it dead', async () => {
    const store = new Map<string, DemoSessionSnapshot | { destroyed: true }>();
    setDemoSessionCache({
      delete: async (sessionId) => {
        store.set(sessionId, { destroyed: true });
      },
      forgotten: async (sessionId) => {
        const value = store.get(sessionId);
        return Boolean(value && 'destroyed' in value);
      },
      get: async (sessionId) => {
        const value = store.get(sessionId);
        if (!value || 'destroyed' in value) return undefined;
        return value;
      },
      set: async (sessionId, snapshot) => {
        store.set(sessionId, snapshot);
      },
    });

    const created = await request('/api/sessions', {
      body: JSON.stringify({ modelId: 'openai/gpt-4o-mini' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const sessionId = (await readJson(created)).sessionId as string;
    await forgetDemoSession(sessionId);

    const turn = await request(`/api/sessions/${sessionId}/turn`, {
      body: JSON.stringify({ prompt: '' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(turn.status).toBe(404);
    expect(await readJson(turn)).toEqual({ error: `Unknown demo session: ${sessionId}` });
  });

  it('forgets a cached session on teardown', async () => {
    const store = new Map<string, DemoSessionSnapshot | { destroyed: true }>();
    setDemoSessionCache({
      delete: async (sessionId) => {
        store.set(sessionId, { destroyed: true });
      },
      forgotten: async (sessionId) => {
        const value = store.get(sessionId);
        return Boolean(value && 'destroyed' in value);
      },
      get: async (sessionId) => {
        const value = store.get(sessionId);
        if (!value || 'destroyed' in value) return undefined;
        return value;
      },
      set: async (sessionId, snapshot) => {
        store.set(sessionId, snapshot);
      },
    });

    const created = await request('/api/sessions', {
      body: JSON.stringify({ modelId: 'openai/gpt-4o-mini' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const sessionId = (await readJson(created)).sessionId as string;
    await resetDemoSessions();

    const destroyed = await request(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    expect(destroyed.status).toBe(200);
    expect(await readJson(destroyed)).toEqual({ destroyed: true });

    const turn = await request(`/api/sessions/${sessionId}/turn`, {
      body: JSON.stringify({ prompt: '' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(turn.status).toBe(404);
    expect(await readJson(turn)).toEqual({ error: `Unknown demo session: ${sessionId}` });
  });

  it('destroys a session and answers unknown routes with 404', async () => {
    const created = await request('/api/sessions', {
      body: JSON.stringify({ modelId: 'openai/gpt-4o-mini' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const sessionId = (await readJson(created)).sessionId as string;

    const destroyed = await request(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    expect(destroyed.status).toBe(200);
    expect(await readJson(destroyed)).toEqual({ destroyed: true });

    const missing = await request('/api/nope');
    expect(missing.status).toBe(404);
    expect(await readJson(missing)).toEqual({ error: 'Not found' });
  });
});
