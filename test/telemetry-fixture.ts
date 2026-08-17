import type { SegmentTokenRecord, TurnTokenSnapshot } from '../src/token-types.js';

const segment = (
  id: string,
  sourceType: SegmentTokenRecord['sourceType'],
  tokens: number,
  input?: Partial<SegmentTokenRecord>,
): SegmentTokenRecord => ({
  accuracy: 'exact',
  cacheScope: 'session',
  cacheStatus: 'eligible',
  characters: tokens * 4,
  contentDigest: `${id}-digest`,
  framingType: `message:${sourceType}`,
  moduleId: 'fixture',
  percentage: 0,
  processorId: `${id}-processor`,
  segmentId: id,
  sourceType,
  tokens,
  ...input,
});

export const createTelemetrySnapshot = (
  turnId: string,
  input?: {
    cacheReadTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  },
): TurnTokenSnapshot => {
  const segments = [
    segment('system', 'system', 700, { framingType: 'system:base' }),
    segment('stable-prefix', 'document', 500, {
      framingType: 'contribution:stable-prefix:workspace',
      messageId: 'injected:stable-prefix:workspace',
    }),
    segment('user', 'user', 100, {
      cacheScope: 'turn',
      cacheStatus: 'not-eligible',
      messageId: `message:${turnId}`,
    }),
  ];
  const totalTokens = segments.reduce((total, item) => total + item.tokens, 0);
  for (const item of segments) item.percentage = item.tokens / totalTokens;

  return {
    cache: { internalPrefixReuseRatio: turnId === 'turn-1' ? 0 : 0.8 },
    createdAt: 1,
    generation: 0,
    runtime: { model: 'gpt-5.6-luna', provider: 'openai' },
    segments,
    sessionId: 'session-1',
    totalCharacters: segments.reduce((total, item) => total + item.characters, 0),
    totalTokens,
    turnId,
    ...(input
      ? {
          usage: {
            cacheReadTokens: input.cacheReadTokens ?? 0,
            inputTokens: input.inputTokens ?? totalTokens,
            outputTokens: input.outputTokens ?? 40,
          },
        }
      : {}),
  };
};
