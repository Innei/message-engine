import { describe, expect, it } from 'vitest';

import { applyPinnedUserContributions, lastUserPinKey } from '../src/last-user-pin.js';
import {
  BaseFirstUserContentProvider,
  BaseLastUserContentProvider,
  BasePinnedUserProvider,
  PipelineConfigurationError,
  PrefixMutationError,
  SessionMessagesEngine,
  type MessageAdapter,
  type MessagePipelineContext,
} from '../src/index.js';

interface TestMessage {
  content: string;
  role: 'assistant' | 'toolResult' | 'user';
  timestamp: number;
  toolCallId?: string;
}

const createTestAdapter = (): MessageAdapter<TestMessage> => ({
  id: 'test-message/v1',
  appendTextToUserMessage: (message, content) => ({
    ...message,
    content: `${message.content}\n\n${content}`,
  }),
  clone: (message) => ({ ...message }),
  createUserMessage: (content, timestamp = 0) => ({ content, role: 'user', timestamp }),
  fingerprint: (message) => JSON.stringify(message),
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

describe('pinned last-user contributions', () => {
  it('pins a session last-user section on the first user and does not rebind', async () => {
    let builds = 0;
    class PinnedSection extends BasePinnedUserProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'pinned.section';
      constructor() {
        super({ sourceType: 'knowledge' });
      }
      protected build() {
        builds += 1;
        return 'workspace snapshot';
      }
    }

    const engine = createEngine({
      modules: [{ id: 'pinned', processors: [new PinnedSection()] }],
    });
    engine.append([message('ask')]);
    const first = await engine.compileTurn({ step: { turn: 1 } });
    expect(first.messages.map((item) => item.content)).toEqual(['ask\n\nworkspace snapshot']);
    expect(engine.getMessages().map((item) => item.content)).toEqual(['ask']);

    engine.append([message('answer', 'assistant'), message('follow up')]);
    const second = await engine.compileTurn({ step: { turn: 2 } });
    expect(second.messages.map((item) => item.content)).toEqual([
      'ask\n\nworkspace snapshot',
      'answer',
      'follow up',
    ]);
    expect(builds).toBe(1);
    expect(engine.getMessages().map((item) => item.content)).toEqual([
      'ask',
      'answer',
      'follow up',
    ]);
  });

  it('still rebinds unpinned last-user contributions to the current last user', async () => {
    class MovingSection extends BaseLastUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'moving.section';
      constructor() {
        super({ cacheScope: 'session', sourceType: 'knowledge' });
      }
      protected build() {
        return 'moving';
      }
    }
    const engine = createEngine({
      modules: [{ id: 'moving', processors: [new MovingSection()] }],
    });
    engine.append([message('ask')]);
    await engine.compileTurn({ step: { turn: 1 } });
    engine.append([message('answer', 'assistant'), message('follow up')]);
    const second = await engine.compileTurn({ step: { turn: 2 } });
    expect(second.messages.map((item) => item.content)).toEqual([
      'ask',
      'answer',
      'follow up\n\nmoving',
    ]);
  });

  it('rejects turn last-user writes to a committed user message', async () => {
    class TurnAugment extends BaseLastUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'turn.augment';
      protected build() {
        return 'now';
      }
    }
    const engine = createEngine({
      modules: [{ id: 'turn', processors: [new TurnAugment()] }],
    });
    engine.append([message('ask')]);
    await engine.compileTurn({ step: { turn: 1 } });
    engine.append([message('answer', 'assistant')]);
    await expect(engine.compileTurn({ step: { turn: 2 } })).rejects.toBeInstanceOf(
      PipelineConfigurationError,
    );
  });

  it('rejects a custom turn processor with session-scoped content writing a committed last user', async () => {
    const engine = createEngine({
      modules: [
        {
          id: 'custom',
          processors: [
            {
              id: 'custom.turn-session-content',
              phase: 'user-augmentation',
              cacheScope: 'turn',
              process(context) {
                context.contribute({
                  slot: 'last-user',
                  content: {
                    cacheScope: 'session',
                    id: 'spoof',
                    sourceType: 'runtime-state',
                    text: 'now',
                  },
                });
              },
            },
          ],
        },
      ],
    });
    engine.append([message('ask')]);
    await engine.compileTurn({ step: { turn: 1 } });
    engine.append([message('answer', 'assistant')]);
    await expect(engine.compileTurn({ step: { turn: 2 } })).rejects.toBeInstanceOf(
      PipelineConfigurationError,
    );
  });

  it('rejects turn last-user writes to a committed user after a stable-prefix shift', async () => {
    class StablePrefix extends BaseFirstUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'stable.prefix';
      protected build() {
        return 'prefix';
      }
    }
    class TurnAugment extends BaseLastUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'turn.augment';
      protected build() {
        return 'now';
      }
    }
    const engine = createEngine({
      modules: [{ id: 'mix', processors: [new StablePrefix(), new TurnAugment()] }],
    });
    engine.append([message('ask')]);
    await engine.compileTurn({ step: { turn: 1 } });
    engine.append([message('answer', 'assistant')]);
    await expect(engine.compileTurn({ step: { turn: 2 } })).rejects.toBeInstanceOf(
      PipelineConfigurationError,
    );
  });

  it('appends a compile-time carrier when the first pin would rewrite a committed user', async () => {
    class LatePin extends BasePinnedUserProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'late.pin';
      constructor() {
        super({ sourceType: 'knowledge' });
      }
      enabled(
        context: MessagePipelineContext<
          TestMessage,
          { agent: string },
          { turn: number },
          Record<string, never>,
          { visited?: boolean }
        >,
      ) {
        return context.step.turn >= 2;
      }
      protected build() {
        return 'late section';
      }
    }

    const engine = createEngine({
      modules: [{ id: 'late', processors: [new LatePin()] }],
    });
    engine.append([message('ask')]);
    await engine.compileTurn({ step: { turn: 1 } });
    engine.append([message('answer', 'assistant')]);
    const compiled = await engine.compileTurn({ step: { turn: 2 } });
    expect(compiled.messages.map((item) => item.content)).toEqual([
      'ask',
      'answer',
      'late section',
    ]);
    expect(engine.getMessages().map((item) => item.content)).toEqual(['ask', 'answer']);

    engine.append([message('next')]);
    const second = await engine.compileTurn({ step: { turn: 3 } });
    expect(second.messages.map((item) => item.content)).toEqual([
      'ask',
      'answer',
      'late section',
      'next',
    ]);
  });

  it('replays carrier pins by increasing insertAt, not contribution visit order', async () => {
    class FirstCarrier extends BasePinnedUserProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'first.carrier';
      constructor() {
        super({ sourceType: 'knowledge' });
      }
      enabled(
        context: MessagePipelineContext<
          TestMessage,
          { agent: string },
          { turn: number },
          Record<string, never>,
          { visited?: boolean }
        >,
      ) {
        return context.step.turn >= 2;
      }
      protected build() {
        return 'first carrier';
      }
    }
    class SecondCarrier extends BasePinnedUserProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'second.carrier';
      constructor() {
        super({ sourceType: 'knowledge' });
      }
      enabled(
        context: MessagePipelineContext<
          TestMessage,
          { agent: string },
          { turn: number },
          Record<string, never>,
          { visited?: boolean }
        >,
      ) {
        return context.step.turn >= 2;
      }
      protected build() {
        return 'second carrier';
      }
    }

    const engine = createEngine({
      modules: [{ id: 'carriers', processors: [new FirstCarrier(), new SecondCarrier()] }],
    });
    engine.append([message('ask')]);
    await engine.compileTurn({ step: { turn: 1 } });
    engine.append([message('answer', 'assistant')]);
    const compiled = await engine.compileTurn({ step: { turn: 2 } });
    expect(compiled.messages.map((item) => item.content)).toEqual([
      'ask',
      'answer',
      'first carrier',
      'second carrier',
    ]);
    expect(engine.getMessages().map((item) => item.content)).toEqual(['ask', 'answer']);

    engine.append([message('next')]);
    const second = await engine.compileTurn({ step: { turn: 3 } });
    expect(second.messages.map((item) => item.content)).toEqual([
      'ask',
      'answer',
      'first carrier',
      'second carrier',
      'next',
    ]);
  });

  it('replays carriers by insertAt even when later pins are visited first', () => {
    const adapter = createTestAdapter();
    const messageList = [message('ask'), message('answer', 'assistant'), message('next')];
    const messageIds = ['raw:ask', 'raw:answer', 'raw:next'];
    const lastUserPins = new Map([
      [
        lastUserPinKey('first.carrier', 'first.carrier:content'),
        { kind: 'carrier' as const, insertAt: 2, text: 'first carrier' },
      ],
      [
        lastUserPinKey('second.carrier', 'second.carrier:content'),
        { kind: 'carrier' as const, insertAt: 3, text: 'second carrier' },
      ],
    ]);

    applyPinnedUserContributions({
      adapter,
      committedRawIds: new Set(['raw:ask', 'raw:answer']),
      hostLastUserId: 'raw:next',
      lastUserPins,
      messageIds,
      messageList,
      contributions: [
        {
          processorCacheScope: 'session',
          slot: 'pinned-user',
          order: 0,
          sequence: 0,
          content: {
            cacheScope: 'session',
            id: 'second.carrier:content',
            moduleId: 'carriers',
            processorId: 'second.carrier',
            sourceType: 'knowledge',
            text: 'second carrier',
          },
        },
        {
          processorCacheScope: 'session',
          slot: 'pinned-user',
          order: 1,
          sequence: 1,
          content: {
            cacheScope: 'session',
            id: 'first.carrier:content',
            moduleId: 'carriers',
            processorId: 'first.carrier',
            sourceType: 'knowledge',
            text: 'first carrier',
          },
        },
      ],
    });

    expect(messageList.map((item) => item.content)).toEqual([
      'ask',
      'answer',
      'first carrier',
      'second carrier',
      'next',
    ]);
  });

  it('applies unpinned session last-user to the host last user after a carrier replay', async () => {
    class LatePin extends BasePinnedUserProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'late.pin';
      constructor() {
        super({ sourceType: 'knowledge' });
      }
      enabled(
        context: MessagePipelineContext<
          TestMessage,
          { agent: string },
          { turn: number },
          Record<string, never>,
          { visited?: boolean }
        >,
      ) {
        return context.step.turn >= 2;
      }
      protected build() {
        return 'late section';
      }
    }
    class MovingSection extends BaseLastUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'moving.section';
      constructor() {
        super({ cacheScope: 'session', sourceType: 'knowledge' });
      }
      protected build() {
        return 'moving';
      }
    }
    const engine = createEngine({
      modules: [{ id: 'mix', processors: [new LatePin(), new MovingSection()] }],
    });
    engine.append([message('ask')]);
    await engine.compileTurn({ step: { turn: 1 } });
    engine.append([message('answer', 'assistant')]);
    await engine.compileTurn({ step: { turn: 2 } });
    engine.append([message('next')]);
    const third = await engine.compileTurn({ step: { turn: 3 } });
    expect(third.messages.map((item) => item.content)).toEqual([
      'ask',
      'answer',
      'late section',
      'next\n\nmoving',
    ]);
  });

  it('does not record a pin from a compile that throws on turn last-user', async () => {
    class LatePin extends BasePinnedUserProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'late.pin';
      constructor() {
        super({ sourceType: 'knowledge' });
      }
      enabled(
        context: MessagePipelineContext<
          TestMessage,
          { agent: string },
          { turn: number },
          Record<string, never>,
          { visited?: boolean }
        >,
      ) {
        return context.step.turn >= 2;
      }
      protected build() {
        return 'late section';
      }
    }
    class TurnAugment extends BaseLastUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'turn.augment';
      enabled(
        context: MessagePipelineContext<
          TestMessage,
          { agent: string },
          { turn: number },
          Record<string, never>,
          { visited?: boolean }
        >,
      ) {
        return context.step.turn === 2;
      }
      protected build() {
        return 'now';
      }
    }
    const engine = createEngine({
      modules: [{ id: 'mix', processors: [new LatePin(), new TurnAugment()] }],
    });
    engine.append([message('ask')]);
    await engine.compileTurn({ step: { turn: 1 } });
    engine.append([message('answer', 'assistant')]);
    await expect(engine.compileTurn({ step: { turn: 2 } })).rejects.toBeInstanceOf(
      PipelineConfigurationError,
    );
    engine.append([message('next')]);
    const third = await engine.compileTurn({ step: { turn: 3 } });
    expect(third.messages.map((item) => item.content)).toEqual([
      'ask',
      'answer',
      'next\n\nlate section',
    ]);
  });

  it('pins a turn-scoped section once per user message and keeps earlier ones', async () => {
    let clock = 0;
    class TurnStamp extends BasePinnedUserProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'turn.stamp';
      constructor() {
        super({ cacheScope: 'turn' });
      }
      protected build() {
        clock += 1;
        return `t${clock}`;
      }
    }
    const engine = createEngine({
      modules: [{ id: 'stamp', processors: [new TurnStamp()] }],
    });
    engine.append([message('ask')]);
    const first = await engine.compileTurn({ step: { turn: 1 } });
    expect(first.messages.map((item) => item.content)).toEqual(['ask\n\nt1']);

    engine.append([
      message('call', 'assistant'),
      { ...message('result', 'toolResult'), toolCallId: 'c1' },
    ]);
    const loop = await engine.compileTurn({ step: { turn: 1 } });
    expect(loop.messages.map((item) => item.content)).toEqual(['ask\n\nt1', 'call', 'result']);

    engine.append([message('answer', 'assistant'), message('follow up')]);
    const second = await engine.compileTurn({ step: { turn: 2 } });
    expect(second.messages.map((item) => item.content)).toEqual([
      'ask\n\nt1',
      'call',
      'result',
      'answer',
      'follow up\n\nt3',
    ]);
    expect(engine.getMessages().map((item) => item.content)).toEqual([
      'ask',
      'call',
      'result',
      'answer',
      'follow up',
    ]);
  });

  it('rebuilds a pin after invalidatePrefix', async () => {
    let builds = 0;
    class PinnedSection extends BasePinnedUserProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'pinned.section';
      constructor() {
        super({ sourceType: 'knowledge' });
      }
      protected build() {
        builds += 1;
        return `snapshot-${builds}`;
      }
    }
    const engine = createEngine({
      modules: [{ id: 'pinned', processors: [new PinnedSection()] }],
    });
    engine.append([message('ask')]);
    await engine.compileTurn({ step: { turn: 1 } });
    await engine.invalidatePrefix({ reason: 'pipeline-changed', expected: true });
    engine.append([message('answer', 'assistant'), message('again')]);
    const after = await engine.compileTurn({ step: { turn: 2 } });
    expect(builds).toBe(2);
    expect(after.messages.at(-1)?.content).toBe('again\n\nsnapshot-2');
  });

  it('does not clear pins when strict mode blocks a transcript mutation', async () => {
    class PinnedSection extends BasePinnedUserProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'pinned.section';
      constructor() {
        super({ sourceType: 'knowledge' });
      }
      protected build() {
        return 'workspace snapshot';
      }
    }
    const engine = createEngine({
      modules: [{ id: 'pinned', processors: [new PinnedSection()] }],
      strict: true,
    });
    engine.append([message('ask')]);
    await engine.compileTurn({ step: { turn: 1 } });
    await expect(engine.syncTranscript([message('mutated')])).rejects.toBeInstanceOf(
      PrefixMutationError,
    );
    engine.append([message('answer', 'assistant')]);
    const after = await engine.compileTurn({ step: { turn: 2 } });
    expect(after.messages[0]?.content).toBe('ask\n\nworkspace snapshot');
  });
});
