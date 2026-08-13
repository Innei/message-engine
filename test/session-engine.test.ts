import { describe, expect, it, vi } from 'vitest';

import {
  BaseFirstUserContentProvider,
  BaseLastUserContentProvider,
  BaseSystemPromptProvider,
  BaseVirtualTailProvider,
  EngineDestroyedError,
  MessageEngineRegistry,
  PrefixMutationError,
  SessionMessagesEngine,
  type MessageAdapter,
  type MessageEngineModule,
  type MessagePipelineContext,
} from '../src/index.js';

interface TestMessage {
  content: string;
  role: 'assistant' | 'toolResult' | 'user';
  timestamp: number;
  toolCallId?: string;
}

const createTestAdapter = (onFingerprint?: () => void): MessageAdapter<TestMessage> => ({
  id: 'test-message/v1',
  appendTextToUserMessage: (message, content) => ({
    ...message,
    content: `${message.content}\n\n${content}`,
  }),
  clone: (message) => ({ ...message }),
  createUserMessage: (content, timestamp = 0) => ({ content, role: 'user', timestamp }),
  fingerprint: (message) => {
    onFingerprint?.();
    return JSON.stringify(message);
  },
  getRole: (message) => message.role,
  getTextSegments: (message) => [
    {
      content: message.content,
      sourceType: message.role === 'toolResult' ? 'tool-result' : message.role,
    },
  ],
  getToolResultId: (message) => message.toolCallId,
});

const message = (content: string, role: TestMessage['role'] = 'user'): TestMessage => ({
  content,
  role,
  timestamp: 1,
});

const createEngine = (
  overrides: Partial<
    ConstructorParameters<
      typeof SessionMessagesEngine<
        TestMessage,
        { agent: string },
        { turn: number },
        Record<string, never>,
        { visited?: boolean }
      >
    >[0]
  > = {},
) =>
  new SessionMessagesEngine<
    TestMessage,
    { agent: string },
    { turn: number },
    Record<string, never>,
    { visited?: boolean }
  >({
    adapter: createTestAdapter(),
    initial: { agent: 'test' },
    services: {},
    sessionId: 'session-1',
    ...overrides,
  });

describe('SessionMessagesEngine transcript invariants', () => {
  it('uses append as the O(delta) path and skips trusted unchanged references', async () => {
    let fingerprints = 0;
    const adapter = createTestAdapter(() => {
      fingerprints += 1;
    });
    const engine = createEngine({ adapter });
    const first = message('first');
    const second = message('second', 'assistant');
    const third = message('third');

    engine.append([first, second]);
    expect(fingerprints).toBe(2);

    await engine.syncTranscript([first, second], { trustMessageIdentity: true });
    expect(fingerprints).toBe(2);

    await engine.syncTranscript([first, second, third], { trustMessageIdentity: true });
    expect(fingerprints).toBe(3);
    expect(engine.length).toBe(3);
  });

  it('blocks committed-prefix mutation atomically in strict mode', async () => {
    const onPrefixMutation = vi.fn();
    const warn = vi.fn();
    const engine = createEngine({
      hooks: { onPrefixMutation },
      logger: { warn },
      strict: true,
    });
    const original = message('original');
    engine.append([original, message('answer', 'assistant')]);

    await expect(
      engine.syncTranscript([message('changed'), message('answer', 'assistant')]),
    ).rejects.toBeInstanceOf(PrefixMutationError);

    expect(engine.generation).toBe(0);
    expect(engine.getMessages()[0]?.content).toBe('original');
    expect(onPrefixMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'blocked', firstChangedIndex: 0 }),
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it('accepts relaxed mutation, increments generation, and reports invalidation', async () => {
    const onPrefixMutation = vi.fn();
    const engine = createEngine({ hooks: { onPrefixMutation } });
    engine.append([message('before')]);

    await engine.syncTranscript([message('after')]);

    expect(engine.generation).toBe(1);
    expect(engine.getMessages()[0]?.content).toBe('after');
    expect(onPrefixMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'accepted-and-invalidated', nextGeneration: 1 }),
    );
  });

  it('returns a safe transform fallback while preserving strict state', async () => {
    const onError = vi.fn();
    const engine = createEngine({ strict: true });
    engine.append([message('committed')]);
    const transform = engine.createTransformContext({
      onError,
      step: { turn: 1 },
    });
    const changed = [message('mutated')];

    await expect(transform(changed)).resolves.toBe(changed);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(PrefixMutationError);
    expect(engine.getMessages()[0]?.content).toBe('committed');
  });

  it('correlates adapter compilation with a caller-provided turn id', async () => {
    const engine = createEngine({
      tokenAccounting: {
        tokenizer: {
          accuracy: 'estimated',
          count: () => 3,
          id: 'demo-tokenizer',
        },
      },
    });
    const transform = engine.createTransformContext({
      step: { turn: 1 },
      turnId: () => 'provider-turn-1',
    });

    await transform([message('measure me')]);

    expect(engine.getTokenSummary()?.turns[0]).toEqual(
      expect.objectContaining({ turnId: 'provider-turn-1' }),
    );
    expect(engine.getTokenSummary()?.turns[0]?.segments[0]?.accuracy).toBe('estimated');
  });

  it('exposes the compiled system prompt to transform adapters before transport', async () => {
    const onCompiled = vi.fn();
    class PolicyProvider extends BaseSystemPromptProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'tenant-policy';
      protected build() {
        return 'policy=approval-required';
      }
    }
    const engine = createEngine({
      baseSystemPrompt: 'base prompt',
      modules: [{ id: 'policy', processors: [new PolicyProvider()] }],
    });
    const transform = engine.createTransformContext({ onCompiled, step: { turn: 1 } });

    await transform([message('inspect')]);

    expect(onCompiled).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: 'base prompt\n\npolicy=approval-required' }),
    );
  });
});

describe('pipeline and accounting', () => {
  it('keeps stable prefix context and ephemeral virtual-tail state outside raw history', async () => {
    class StableProvider extends BaseFirstUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'stable-context';
      protected build() {
        return 'stable data';
      }
    }
    class TailProvider extends BaseVirtualTailProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'turn-state';
      protected build(
        context: MessagePipelineContext<
          TestMessage,
          { agent: string },
          { turn: number },
          Record<string, never>,
          { visited?: boolean }
        >,
      ) {
        return `turn=${context.step.turn}`;
      }
    }
    const engine = createEngine({
      modules: [
        {
          id: 'context',
          processors: [new StableProvider(), new TailProvider()],
        },
      ],
    });
    engine.append([message('task'), message('prior answer', 'assistant')]);

    const result = await engine.compileTurn({ step: { turn: 3 } });

    expect(result.messages.map(({ content }) => content)).toEqual([
      'stable data',
      'task',
      'prior answer',
      'turn=3',
    ]);
    expect(engine.getMessages().map(({ content }) => content)).toEqual(['task', 'prior answer']);
  });

  it('replays session-scoped provider contributions without rebuilding them', async () => {
    let providerCalls = 0;
    class RuntimeProvider extends BaseLastUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'runtime-context';

      constructor() {
        super({ cacheScope: 'session', sourceType: 'runtime-state' });
      }

      protected build() {
        providerCalls += 1;
        return 'market=open';
      }
    }

    const modules: Array<
      MessageEngineModule<
        TestMessage,
        { agent: string },
        { turn: number },
        Record<string, never>,
        { visited?: boolean }
      >
    > = [{ id: 'runtime', processors: [new RuntimeProvider()] }];
    const engine = createEngine({ modules });
    engine.append([message('inspect')]);

    const first = await engine.compileTurn({ step: { turn: 1 }, turnId: 'turn-1' });
    const second = await engine.compileTurn({ step: { turn: 2 }, turnId: 'turn-2' });

    expect(first.messages[0]?.content).toBe('inspect\n\nmarket=open');
    expect(second.messages[0]?.content).toBe('inspect\n\nmarket=open');
    expect(second.stats.processors[0]?.replayedFromCache).toBe(true);
    expect(providerCalls).toBe(1);
  });

  it('caches token counts, records normalized usage, and estimates cost by source', async () => {
    const count = vi.fn((content: string) => content.split(/\s+/u).length);
    const engine = createEngine({
      baseSystemPrompt: 'system rules',
      tokenAccounting: {
        pricing: {
          resolve: () => ({
            cacheReadPerMillion: 0.5,
            currency: 'USD',
            inputPerMillion: 1,
            outputPerMillion: 2,
            version: 'test-pricing-v1',
          }),
        },
        tokenizer: { count, id: 'word-count/v1' },
      },
    });
    engine.append([message('hello agent')]);

    const first = await engine.compileTurn({
      runtime: { model: 'test', provider: 'local' },
      step: { turn: 1 },
      turnId: 'turn-1',
    });
    const second = await engine.compileTurn({
      runtime: { model: 'test', provider: 'local' },
      step: { turn: 2 },
      turnId: 'turn-2',
    });
    expect(first.tokenSnapshot?.cache.internalPrefixReuseRatio).toBe(0);
    expect(second.tokenSnapshot?.cache.internalPrefixReuseRatio).toBe(1);
    expect(count).toHaveBeenCalledTimes(2);

    const recorded = await engine.recordUsage('turn-2', {
      cacheReadTokens: 2,
      inputTokens: 2,
      outputTokens: 3,
    });
    expect(recorded.cache.providerCacheHitRate).toBe(0.5);
    expect(recorded.cost?.total).toBeCloseTo(0.000009);
    expect(engine.getTokenSummary()?.sources.some((source) => source.cost > 0)).toBe(true);
  });
});

describe('lifecycle and registry', () => {
  it('tears down modules, clears the registry, and rejects subsequent use', async () => {
    const teardown = vi.fn();
    const engine = createEngine({ modules: [{ id: 'lifecycle', processors: [], teardown }] });
    const registry = new MessageEngineRegistry<typeof engine>();
    const acquired = registry.acquire('session-1', () => engine);
    const repeated = registry.acquire('session-1', () => createEngine());
    expect(repeated).toBe(acquired);

    await registry.destroy('session-1');

    expect(teardown).toHaveBeenCalledOnce();
    expect(registry.has('session-1')).toBe(false);
    expect(() => engine.getMessages()).toThrow(EngineDestroyedError);
  });
});
