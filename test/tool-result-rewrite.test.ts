import { describe, expect, it, vi } from 'vitest';

import {
  PipelineConfigurationError,
  PipelineProcessorError,
  createToolResultRewriteProcessor,
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
  replaceToolResultText: (message, text) => {
    if (message.role !== 'toolResult') return message;
    return { ...message, content: text };
  },
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

const toolResult = (toolCallId: string, content: string): TestMessage => ({
  content,
  role: 'toolResult',
  timestamp: 1,
  toolCallId,
});

describe('tool result rewrite', () => {
  it('asks the host once per toolCallId per generation and pins the body', async () => {
    const rewrite = vi.fn(
      (input: { toolCallId: string; message: TestMessage }): string | undefined => {
        if (input.toolCallId === 'call-1') return 'truncated';
        return undefined;
      },
    );
    const engine = createEngine({
      modules: [
        {
          id: 'history',
          processors: [createToolResultRewriteProcessor<TestMessage>(rewrite)],
        },
      ],
    });
    engine.append([
      message('ask'),
      message('call', 'assistant'),
      toolResult('call-1', 'huge payload'),
    ]);
    const first = await engine.compileTurn({ step: { turn: 1 } });
    expect(first.messages[2]?.content).toBe('truncated');
    expect(engine.getMessages()[2]?.content).toBe('huge payload');

    rewrite.mockImplementation(() => 'should-not-apply');
    engine.append([message('more', 'assistant')]);
    const second = await engine.compileTurn({ step: { turn: 2 } });
    expect(second.messages[2]?.content).toBe('truncated');
    expect(rewrite).toHaveBeenCalledTimes(1);
  });

  it('pins an undefined rewrite for the generation and reconsults after invalidatePrefix', async () => {
    const rewrite = vi.fn(() => undefined as string | undefined);
    const engine = createEngine({
      modules: [
        {
          id: 'history',
          processors: [createToolResultRewriteProcessor<TestMessage>(rewrite)],
        },
      ],
    });
    engine.append([message('ask'), toolResult('call-1', 'huge')]);
    const first = await engine.compileTurn({ step: { turn: 1 } });
    expect(first.messages[1]?.content).toBe('huge');

    rewrite.mockImplementation(() => 'should-not-apply');
    engine.append([message('more', 'assistant')]);
    const second = await engine.compileTurn({ step: { turn: 2 } });
    expect(second.messages[1]?.content).toBe('huge');
    expect(rewrite).toHaveBeenCalledTimes(1);

    rewrite.mockImplementation(() => 'v2');
    await engine.invalidatePrefix({ expected: true, reason: 'pipeline-changed' });
    const after = await engine.compileTurn({ step: { turn: 3 } });
    expect(after.messages[1]?.content).toBe('v2');
    expect(rewrite).toHaveBeenCalledTimes(2);
  });

  it('consults rewrite again after invalidatePrefix', async () => {
    const rewrite = vi.fn(() => 'v1');
    const engine = createEngine({
      modules: [
        {
          id: 'history',
          processors: [createToolResultRewriteProcessor<TestMessage>(rewrite)],
        },
      ],
    });
    engine.append([message('ask'), toolResult('call-1', 'huge')]);
    await engine.compileTurn({ step: { turn: 1 } });
    rewrite.mockImplementation(() => 'v2');
    await engine.invalidatePrefix({ expected: true, reason: 'pipeline-changed' });
    const after = await engine.compileTurn({ step: { turn: 2 } });
    expect(after.messages[1]?.content).toBe('v2');
    expect(rewrite).toHaveBeenCalledTimes(2);
  });

  it('rejects a replacement message with a different toolCallId', async () => {
    const engine = createEngine({
      modules: [
        {
          id: 'history',
          processors: [
            createToolResultRewriteProcessor<TestMessage>(() => toolResult('other', 'nope')),
          ],
        },
      ],
    });
    engine.append([message('ask'), toolResult('call-1', 'huge')]);
    await expect(engine.compileTurn({ step: { turn: 1 } })).rejects.toBeInstanceOf(
      PipelineProcessorError,
    );
  });

  it('fails when a string rewrite is returned without replaceToolResultText', async () => {
    const adapter = createTestAdapter();
    delete (adapter as { replaceToolResultText?: unknown }).replaceToolResultText;
    const engine = createEngine({
      adapter,
      modules: [
        {
          id: 'history',
          processors: [createToolResultRewriteProcessor<TestMessage>(() => 'x')],
        },
      ],
    });
    engine.append([message('ask'), toolResult('call-1', 'huge')]);
    await expect(engine.compileTurn({ step: { turn: 1 } })).rejects.toBeInstanceOf(
      PipelineConfigurationError,
    );
  });

  it('does not replay rewritten bodies across engines sharing one processor', async () => {
    const rewrite = vi.fn(
      (input: { message: TestMessage }) => `rewritten:${input.message.content}`,
    );
    const processor = createToolResultRewriteProcessor<TestMessage>(rewrite);
    const first = createEngine({
      modules: [{ id: 'history', processors: [processor] }],
      sessionId: 'session-a',
    });
    first.append([message('ask'), toolResult('call-1', 'huge payload')]);
    const compiledFirst = await first.compileTurn({ step: { turn: 1 } });
    expect(compiledFirst.messages[1]?.content).toBe('rewritten:huge payload');
    expect(rewrite).toHaveBeenCalledTimes(1);

    const second = createEngine({
      modules: [{ id: 'history', processors: [processor] }],
      sessionId: 'session-b',
    });
    second.append([message('ask'), toolResult('call-1', 'other payload')]);
    const compiledSecond = await second.compileTurn({ step: { turn: 1 } });
    expect(compiledSecond.messages[1]?.content).toBe('rewritten:other payload');
    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(first.getMessages()[1]?.content).toBe('huge payload');
    expect(second.getMessages()[1]?.content).toBe('other payload');
  });
});
