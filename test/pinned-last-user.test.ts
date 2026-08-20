import { describe, expect, it } from 'vitest';

import {
  BaseLastUserContentProvider,
  PipelineConfigurationError,
  SessionMessagesEngine,
  type MessageAdapter,
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
});
