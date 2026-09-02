import type { Usage } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import {
  createDemoContextModule,
  isCollapsedToolResult,
  type DemoInitialContext,
  type DemoMetadata,
  type DemoServices,
  type DemoStepContext,
  DemoAgentSession,
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

    engine.append([
      {
        content: [{ text: 'Follow the watchlist instead.', type: 'text' }],
        role: 'user',
        timestamp: 2,
      } as AgentMessage,
    ]);
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

  it('pins request context per user message and collapses older tool results after a new generation', async () => {
    const engine = createPiMessageEngine<
      DemoInitialContext,
      DemoStepContext,
      DemoServices,
      DemoMetadata
    >({
      baseSystemPrompt: 'Base system prompt',
      initial: {
        experiment: 'pin-and-rewrite-test',
        policy: 'research-only',
        startedAt: '2026-08-13T00:00:00.000Z',
        workspace: 'Kansoku Trading Desk',
      },
      modules: [createDemoContextModule()],
      services: { recordContextBuild: () => {} },
      sessionId: 'pin-and-rewrite-test',
    });
    const step = (requestedAt: string): DemoStepContext => ({
      modelId: 'openai/gpt-4o-mini',
      providerTurn: 1,
      requestedAt,
      route: '/markets/MU.US',
      selection: 'MU.US · daily candle',
    });
    const user = (text: string, timestamp: number): AgentMessage =>
      ({ content: [{ text, type: 'text' }], role: 'user', timestamp }) as AgentMessage;
    const toolResult = (toolCallId: string, symbol: string): AgentMessage =>
      ({
        content: [{ text: JSON.stringify({ candles: [1, 2, 3], symbol }), type: 'text' }],
        role: 'toolResult',
        timestamp: 5,
        toolCallId,
        toolName: 'market_snapshot',
      }) as AgentMessage;

    engine.append([user('Snapshot MU.US', 1)]);
    await engine.compileTurn({ step: step('2026-08-13T00:00:01.000Z') });
    engine.append([toolResult('call-1', 'MU.US')]);
    const loop = await engine.compileTurn({ step: step('2026-08-13T00:00:01.000Z') });
    const loopTexts = loop.messages.map(toDemoMessageView).map((message) => message.text);
    expect(loopTexts[1]).toContain('sent_at=2026-08-13T00:00:01.000Z');
    expect(loopTexts[2]).not.toContain('[collapsed tool result]');

    engine.append([user('Now NVDA', 6), toolResult('call-2', 'NVDA')]);
    const second = await engine.compileTurn({ step: step('2026-08-13T00:00:09.000Z') });
    const secondTexts = second.messages.map(toDemoMessageView).map((message) => message.text);
    expect(secondTexts[1]).toContain('sent_at=2026-08-13T00:00:01.000Z');
    expect(secondTexts[3]).toContain('sent_at=2026-08-13T00:00:09.000Z');
    expect(secondTexts[2]).not.toContain('[collapsed tool result]');
    expect(second.messages.filter(isCollapsedToolResult)).toHaveLength(0);

    await engine.invalidatePrefix({ expected: true, reason: 'content-changed' });
    const third = await engine.compileTurn({ step: step('2026-08-13T00:00:09.000Z') });
    const thirdTexts = third.messages.map(toDemoMessageView).map((message) => message.text);
    expect(thirdTexts[2]).toContain('[collapsed tool result] market_snapshot for MU.US');
    expect(thirdTexts[4]).toContain('"symbol":"NVDA"');
    expect(third.messages.filter(isCollapsedToolResult)).toHaveLength(1);
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
