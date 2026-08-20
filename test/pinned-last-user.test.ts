import { describe, expect, it } from 'vitest';

import {
  BaseFirstUserContentProvider,
  BaseLastUserContentProvider,
  PipelineConfigurationError,
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
  it('rejects pin with turn cacheScope on the last-user provider', () => {
    expect(
      () =>
        new (class extends BaseLastUserContentProvider<
          TestMessage,
          { agent: string },
          { turn: number },
          Record<string, never>,
          { visited?: boolean }
        > {
          readonly id = 'pinned.section';
          constructor() {
            super({ cacheScope: 'turn', pin: true });
          }
          protected build() {
            return 'section';
          }
        })(),
    ).toThrow(PipelineConfigurationError);
  });

  it('rejects pin contributions on a non-last-user slot', async () => {
    const engine = createEngine({
      modules: [
        {
          id: 'bad',
          processors: [
            {
              id: 'bad.tail',
              phase: 'virtual-tail',
              cacheScope: 'session',
              process(context) {
                context.contribute({
                  pin: true,
                  slot: 'virtual-tail',
                  content: {
                    cacheScope: 'session',
                    id: 'x',
                    sourceType: 'knowledge',
                    text: 'nope',
                  },
                });
              },
            },
          ],
        },
      ],
    });
    engine.append([message('hello')]);
    await expect(engine.compileTurn({ step: { turn: 1 } })).rejects.toBeInstanceOf(
      PipelineConfigurationError,
    );
  });

  it('pins a session last-user section on the first user and does not rebind', async () => {
    let builds = 0;
    class PinnedSection extends BaseLastUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'pinned.section';
      constructor() {
        super({ pin: true, sourceType: 'knowledge' });
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
    class LatePin extends BaseLastUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'late.pin';
      constructor() {
        super({ pin: true, sourceType: 'knowledge' });
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

  it('applies unpinned session last-user to the host last user after a carrier replay', async () => {
    class LatePin extends BaseLastUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'late.pin';
      constructor() {
        super({ pin: true, sourceType: 'knowledge' });
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
    class LatePin extends BaseLastUserContentProvider<
      TestMessage,
      { agent: string },
      { turn: number },
      Record<string, never>,
      { visited?: boolean }
    > {
      readonly id = 'late.pin';
      constructor() {
        super({ pin: true, sourceType: 'knowledge' });
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
});
