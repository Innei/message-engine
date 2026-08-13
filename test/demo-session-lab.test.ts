import { createModels, type Usage } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import {
  createDemoContextModule,
  type DemoInitialContext,
  type DemoMetadata,
  type DemoServices,
  type DemoStepContext,
  DemoAgentSession,
  getOpenRouterSessionModel,
  listDemoModels,
  normalizePiUsage,
  toDemoMessageView,
} from '../demo/server/session-lab.js';
import { createPiMessageEngine } from '../src/adapters/pi.js';

describe('real-agent demo integration', () => {
  it('injects business context at each model-visible pipeline position', async () => {
    const buildCounts = new Map<string, number>();
    const engine = createPiMessageEngine<
      DemoInitialContext,
      DemoStepContext,
      DemoServices,
      DemoMetadata
    >({
      baseSystemPrompt: 'Base system prompt',
      initial: {
        experiment: 'context-phase-test',
        policy: 'approval-required',
        startedAt: '2026-08-13T00:00:00.000Z',
        workspace: 'Kansoku Trading Desk',
      },
      modules: [createDemoContextModule()],
      services: {
        recordContextBuild: (processorId) => {
          buildCounts.set(processorId, (buildCounts.get(processorId) ?? 0) + 1);
        },
      },
      sessionId: 'context-phase-test',
      tokenAccounting: {
        tokenizer: { count: (content) => content.split(/\s+/u).length, id: 'word-count/test' },
      },
    });
    engine.append([
      {
        content: [{ text: 'Inspect the selected market.', type: 'text' }],
        role: 'user',
        timestamp: 1,
      } as AgentMessage,
    ]);

    const first = await engine.compileTurn({
      step: {
        modelId: 'openai/gpt-4o-mini',
        providerTurn: 1,
        requestedAt: '2026-08-13T00:00:01.000Z',
        route: '/markets/MU.US',
        selection: 'MU.US · daily candle',
      },
    });
    const visibleMessages = first.messages.map(toDemoMessageView).map((message) => message.text);

    expect(first.systemPrompt).toContain('<tenant_policy>');
    expect(first.systemPrompt).toContain('policy=approval-required');
    expect(visibleMessages[0]).toContain('<workspace_context>');
    expect(visibleMessages[1]).toContain('<request_context>');
    expect(visibleMessages.at(-1)).toContain('<runtime_state>');
    expect(first.tokenSnapshot?.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ processorId: 'demo.tenant-policy', sourceType: 'system' }),
        expect.objectContaining({
          processorId: 'demo.workspace-context',
          sourceType: 'knowledge',
        }),
        expect.objectContaining({
          processorId: 'demo.request-context',
          sourceType: 'runtime-state',
        }),
        expect.objectContaining({
          processorId: 'demo.runtime-tail',
          sourceType: 'runtime-state',
        }),
      ]),
    );

    const second = await engine.compileTurn({
      step: {
        modelId: 'openai/gpt-4o-mini',
        providerTurn: 2,
        requestedAt: '2026-08-13T00:00:02.000Z',
        route: '/portfolio',
        selection: 'watchlist · momentum',
      },
    });
    const stats = new Map(second.stats.processors.map((processor) => [processor.id, processor]));

    expect(stats.get('demo.tenant-policy')?.replayedFromCache).toBe(true);
    expect(stats.get('demo.workspace-context')?.replayedFromCache).toBe(true);
    expect(stats.get('demo.request-context')?.replayedFromCache).toBe(false);
    expect(stats.get('demo.runtime-tail')?.replayedFromCache).toBe(false);
    expect(buildCounts.get('demo.tenant-policy')).toBe(1);
    expect(buildCounts.get('demo.workspace-context')).toBe(1);
    expect(buildCounts.get('demo.request-context')).toBe(2);
    expect(buildCounts.get('demo.runtime-tail')).toBe(2);
  });

  it('sends OpenRouter session affinity from the Pi transport', async () => {
    const model = getOpenRouterSessionModel('openai/gpt-4o-mini');
    const requestHeaders: Headers[] = [];
    const providerModels = createModels();
    providerModels.setProvider(openrouterProvider());

    const stream = providerModels.streamSimple(
      model,
      {
        messages: [{ content: [{ text: 'probe', type: 'text' }], role: 'user', timestamp: 1 }],
        systemPrompt: 'test',
        tools: [],
      },
      {
        apiKey: 'test-key',
        fetch: async (_input, init) => {
          requestHeaders.push(new Headers(init?.headers));
          return new Response(JSON.stringify({ error: { message: 'expected test stop' } }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400,
          });
        },
        sessionId: 'session-affinity-test',
      },
    );

    await stream.result();

    expect(requestHeaders).toHaveLength(1);
    expect(requestHeaders[0]?.get('x-session-id')).toBe('session-affinity-test');
  });

  it('exposes the OpenRouter catalog with pricing and cache information', () => {
    const model = listDemoModels().find((candidate) => candidate.id === 'openai/gpt-4o-mini');

    expect(model).toEqual(
      expect.objectContaining({
        cacheReadPerMillion: expect.any(Number),
        contextWindow: expect.any(Number),
        inputPerMillion: expect.any(Number),
        outputPerMillion: expect.any(Number),
      }),
    );
  });

  it('normalizes Pi provider usage without double-counting cached input', () => {
    const usage: Usage = {
      cacheRead: 80,
      cacheWrite: 10,
      cost: { cacheRead: 0.1, cacheWrite: 0.2, input: 0.3, output: 0.4, total: 1 },
      input: 20,
      output: 12,
      reasoning: 4,
      totalTokens: 122,
    };

    expect(normalizePiUsage(usage)).toEqual({
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      inputTokens: 20,
      outputTokens: 12,
      reasoningTokens: 4,
      totalCost: 1,
    });
  });

  it('creates and tears down a Pi-backed session without retaining a key', async () => {
    const session = new DemoAgentSession({
      modelId: 'openai/gpt-4o-mini',
      sessionId: 'offline-smoke',
      strict: true,
    });

    expect(session.state()).toEqual(
      expect.objectContaining({
        generation: 0,
        messages: [],
        modelId: 'openai/gpt-4o-mini',
        sessionId: 'offline-smoke',
        strict: true,
      }),
    );
    await expect(session.destroy()).resolves.toEqual(
      expect.objectContaining({ sessionId: 'offline-smoke' }),
    );
  });

  it('maps Pi messages into browser-safe transcript views', () => {
    expect(
      toDemoMessageView(
        { content: [{ text: 'visible', type: 'text' }], role: 'user', timestamp: 1 },
        2,
      ),
    ).toEqual({ id: 'message-2', role: 'user', text: 'visible' });
  });
});
