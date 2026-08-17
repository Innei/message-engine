import type { Connect, Plugin } from 'vite';

import { resetDemoSessions } from './api-handler.js';
import { handleNodeDemoApi } from './node-http.js';

const demoApiMiddleware: Connect.NextHandleFunction = (request, response, next) => {
  const url = request.url ?? '/';
  if (!url.startsWith('/api/')) {
    next();
    return;
  }
  void handleNodeDemoApi(request, response).catch(next);
};

const attachDemoApi = (server: {
  httpServer?: { once: (event: 'close', listener: () => void) => void } | null;
  middlewares: { use: (middleware: Connect.NextHandleFunction) => void };
}): void => {
  server.httpServer?.once('close', () => {
    void resetDemoSessions();
  });
  server.middlewares.use(demoApiMiddleware);
};

export const messageEngineDemoApi = (): Plugin => ({
  name: 'message-engine-demo-api',
  configurePreviewServer(server) {
    attachDemoApi(server);
  },
  configureServer(server) {
    attachDemoApi(server);
  },
});
