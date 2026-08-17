import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleDemoApi } from './api-handler.js';

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

export const incomingToRequest = async (request: IncomingMessage): Promise<Request> => {
  const host = request.headers.host ?? '127.0.0.1';
  const protoHeader = request.headers['x-forwarded-proto'];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) ?? 'http';
  const url = new URL(request.url ?? '/', `${proto}://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  const method = request.method ?? 'GET';
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(request);
  return new Request(url, {
    ...(body === undefined ? {} : { body }),
    headers,
    method,
    signal: controller.signal,
  });
};

export const writeWebResponse = async (
  response: ServerResponse,
  webResponse: Response,
): Promise<void> => {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });
  if (!webResponse.body) {
    response.end();
    return;
  }
  const reader = webResponse.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      response.write(result.value);
    }
  } finally {
    response.end();
  }
};

export const handleNodeDemoApi = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const webResponse = await handleDemoApi(await incomingToRequest(request));
  await writeWebResponse(response, webResponse);
};
