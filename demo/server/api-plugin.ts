import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Plugin } from 'vite';

import type { DemoStreamEvent } from '../shared/protocol.js';
import type { DemoSessionContextInput, DemoTurnContextInput } from '../shared/protocol.js';
import { DemoAgentSession, hasEnvironmentOpenRouterKey, listDemoModels } from './session-lab.js';

const sessions = new Map<string, DemoAgentSession>();

const destroyAllSessions = async (): Promise<void> => {
  const activeSessions = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(activeSessions.map((session) => session.destroy()));
};

const readJson = async <Value>(request: IncomingMessage): Promise<Value> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 1_000_000) throw new Error('Request body exceeds 1 MB');
    chunks.push(buffer);
  }
  const source = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(source || '{}') as Value;
};

const writeJson = (response: ServerResponse, status: number, value: unknown): void => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
};

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sessionIdFromPath = (pathname: string, suffix: string): string | undefined => {
  const match = pathname.match(new RegExp(`^/api/sessions/([^/]+)/${suffix}$`, 'u'));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
};

const requireSession = (sessionId: string): DemoAgentSession => {
  const session = sessions.get(sessionId);
  if (!session) throw new RangeError(`Unknown demo session: ${sessionId}`);
  return session;
};

export const messageEngineDemoApi = (): Plugin => ({
  name: 'message-engine-demo-api',
  configureServer(server) {
    server.httpServer?.once('close', () => {
      void destroyAllSessions();
    });
    server.middlewares.use(async (request, response, next) => {
      const method = request.method ?? 'GET';
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        next();
        return;
      }

      try {
        if (method === 'GET' && url.pathname === '/api/health') {
          writeJson(response, 200, {
            environmentKeyAvailable: hasEnvironmentOpenRouterKey(),
            sessions: sessions.size,
            status: 'ok',
          });
          return;
        }

        if (method === 'GET' && url.pathname === '/api/models') {
          writeJson(response, 200, { models: listDemoModels() });
          return;
        }

        if (method === 'POST' && url.pathname === '/api/sessions') {
          const body = await readJson<{
            context?: Partial<DemoSessionContextInput>;
            modelId?: string;
            strict?: boolean;
          }>(request);
          const modelId = body.modelId?.trim();
          if (!modelId) throw new Error('modelId is required');
          const sessionId = `lab-${crypto.randomUUID()}`;
          const session = new DemoAgentSession({
            context: {
              policy: body.context?.policy?.trim() || 'research-only',
              workspace: body.context?.workspace?.trim() || 'Kansoku Trading Desk',
            },
            modelId,
            sessionId,
            strict: body.strict ?? true,
          });
          sessions.set(sessionId, session);
          writeJson(response, 201, session.state());
          return;
        }

        const turnSessionId = sessionIdFromPath(url.pathname, 'turn');
        if (method === 'POST' && turnSessionId) {
          const body = await readJson<{
            context?: Partial<DemoTurnContextInput>;
            key?: string;
            prompt?: string;
          }>(request);
          const session = requireSession(turnSessionId);
          const key = body.key?.trim() || process.env.OPENROUTER_API_KEY?.trim() || '';
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          const publish = (event: DemoStreamEvent): void => {
            if (!response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
          };
          request.once('aborted', () => session.abort());
          try {
            await session.runTurn(
              body.prompt ?? '',
              key,
              {
                route: body.context?.route?.trim() || '/markets/MU.US',
                selection: body.context?.selection?.trim() || 'MU.US · daily candle',
              },
              publish,
            );
          } catch (error) {
            publish({ message: messageFromError(error), type: 'error' });
            publish({ state: session.state(), type: 'done' });
          }
          response.end();
          return;
        }

        const mutationSessionId = sessionIdFromPath(url.pathname, 'mutate-prefix');
        if (method === 'POST' && mutationSessionId) {
          const body = await readJson<{ replacement?: string }>(request);
          const replacement = body.replacement?.trim();
          if (!replacement) throw new Error('replacement is required');
          const result = await requireSession(mutationSessionId).mutatePrefix(replacement);
          writeJson(response, 200, result);
          return;
        }

        const directSessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/u);
        if (method === 'DELETE' && directSessionMatch?.[1]) {
          const sessionId = decodeURIComponent(directSessionMatch[1]);
          const session = sessions.get(sessionId);
          sessions.delete(sessionId);
          await session?.destroy();
          writeJson(response, 200, { destroyed: Boolean(session) });
          return;
        }

        writeJson(response, 404, { error: 'Not found' });
      } catch (error) {
        const status = error instanceof RangeError ? 404 : 400;
        writeJson(response, status, { error: messageFromError(error) });
      }
    });
  },
});
