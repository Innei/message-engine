import type { DemoStreamEvent } from '../shared/protocol.js';
import type { DemoSessionContextInput, DemoTurnContextInput } from '../shared/protocol.js';
import { DemoAgentSession, hasEnvironmentOpenRouterKey, listDemoModels } from './session-lab.js';
import {
  forgetDemoSession,
  isForgottenDemoSession,
  persistDemoSession,
  reviveDemoSession,
} from './session-store.js';

export { forgetDemoSession, setDemoSessionCache } from './session-store.js';

const MAX_BODY_BYTES = 1_000_000;
const MAX_SESSIONS = 32;

const sessions = new Map<string, DemoAgentSession>();

const json = (status: number, value: unknown): Response =>
  new Response(JSON.stringify(value), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  });

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sessionIdFromPath = (pathname: string, suffix: string): string | undefined => {
  const match = pathname.match(new RegExp(`^/api/sessions/([^/]+)/${suffix}$`, 'u'));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
};

const remember = (session: DemoAgentSession): DemoAgentSession => {
  sessions.set(session.sessionId, session);
  return session;
};

const requireSession = async (sessionId: string): Promise<DemoAgentSession> => {
  if (await isForgottenDemoSession(sessionId)) {
    sessions.delete(sessionId);
    throw new RangeError(`Unknown demo session: ${sessionId}`);
  }
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const revived = await reviveDemoSession(sessionId);
  if (revived) return remember(revived);
  throw new RangeError(`Unknown demo session: ${sessionId}`);
};

const evictOldestSession = async (): Promise<void> => {
  const oldest = sessions.entries().next().value;
  if (!oldest) return;
  const [sessionId, session] = oldest;
  sessions.delete(sessionId);
  await forgetDemoSession(sessionId);
  await session.destroy();
};

const readJson = async <Value>(request: Request): Promise<Value> => {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new Error('Request body exceeds 1 MB');
  }
  return JSON.parse(raw || '{}') as Value;
};

export const resetDemoSessions = async (): Promise<void> => {
  const activeSessions = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(activeSessions.map((session) => session.destroy()));
};

export const handleDemoApi = async (request: Request): Promise<Response> => {
  const method = request.method;
  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    return json(404, { error: 'Not found' });
  }

  try {
    if (method === 'GET' && url.pathname === '/api/health') {
      return json(200, {
        environmentKeyAvailable: hasEnvironmentOpenRouterKey(),
        sessions: sessions.size,
        status: 'ok',
      });
    }

    if (method === 'GET' && url.pathname === '/api/models') {
      return json(200, { models: listDemoModels() });
    }

    if (method === 'POST' && url.pathname === '/api/sessions') {
      const body = await readJson<{
        context?: Partial<DemoSessionContextInput>;
        modelId?: string;
        strict?: boolean;
      }>(request);
      const modelId = body.modelId?.trim();
      if (!modelId) throw new Error('modelId is required');
      if (sessions.size >= MAX_SESSIONS) await evictOldestSession();
      const sessionId = `lab-${crypto.randomUUID()}`;
      const session = remember(
        new DemoAgentSession({
          context: {
            policy: body.context?.policy?.trim() || 'research-only',
            workspace: body.context?.workspace?.trim() || 'Kansoku Trading Desk',
          },
          modelId,
          sessionId,
          strict: body.strict ?? true,
        }),
      );
      await persistDemoSession(session);
      return json(201, session.state());
    }

    const turnSessionId = sessionIdFromPath(url.pathname, 'turn');
    if (method === 'POST' && turnSessionId) {
      const body = await readJson<{
        context?: Partial<DemoTurnContextInput>;
        key?: string;
        prompt?: string;
      }>(request);
      const session = await requireSession(turnSessionId);
      const key = body.key?.trim() || process.env.OPENROUTER_API_KEY?.trim() || '';
      const prompt = body.prompt ?? '';
      if (!prompt.trim()) throw new Error('Prompt is required');
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          const publish = (event: DemoStreamEvent): void => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };
          const abort = (): void => session.abort();
          request.signal.addEventListener('abort', abort, { once: true });
          void session
            .runTurn(
              prompt,
              key,
              {
                route: body.context?.route?.trim() || '/markets/MU.US',
                selection: body.context?.selection?.trim() || 'MU.US · daily candle',
              },
              publish,
            )
            .catch((error: unknown) => {
              publish({ message: messageFromError(error), type: 'error' });
              publish({ state: session.state(), type: 'done' });
            })
            .finally(() => {
              request.signal.removeEventListener('abort', abort);
              void persistDemoSession(session).finally(() => controller.close());
            });
        },
      });
      return new Response(stream, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
        status: 200,
      });
    }

    const mutationSessionId = sessionIdFromPath(url.pathname, 'mutate-prefix');
    if (method === 'POST' && mutationSessionId) {
      const body = await readJson<{ replacement?: string }>(request);
      const replacement = body.replacement?.trim();
      if (!replacement) throw new Error('replacement is required');
      const session = await requireSession(mutationSessionId);
      const result = await session.mutatePrefix(replacement);
      await persistDemoSession(session);
      return json(200, result);
    }

    const directSessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/u);
    if (method === 'DELETE' && directSessionMatch?.[1]) {
      const sessionId = decodeURIComponent(directSessionMatch[1]);
      const session = sessions.get(sessionId);
      sessions.delete(sessionId);
      const cached = session ? undefined : await reviveDemoSession(sessionId);
      await forgetDemoSession(sessionId);
      await session?.destroy();
      await cached?.destroy();
      return json(200, { destroyed: Boolean(session || cached) });
    }

    return json(404, { error: 'Not found' });
  } catch (error) {
    const status = error instanceof RangeError ? 404 : 400;
    return json(status, { error: messageFromError(error) });
  }
};
