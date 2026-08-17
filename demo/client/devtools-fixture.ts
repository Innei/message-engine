import { createMessageEngineDevtoolsRecorder } from '../../src/devtools-recorder.js';
import type { SegmentTokenRecord, TurnTokenSnapshot } from '../../src/token-types.js';

const createSegment = (
  id: string,
  sourceType: SegmentTokenRecord['sourceType'],
  tokens: number,
  input?: Partial<SegmentTokenRecord>,
): SegmentTokenRecord => ({
  accuracy: 'estimated',
  cacheScope: 'session',
  cacheStatus: 'eligible',
  characters: tokens * 4,
  contentDigest: `${id}-digest`,
  framingType: `message:${sourceType}`,
  moduleId: 'torrent-ai',
  percentage: 0,
  processorId: `${id}-provider`,
  segmentId: id,
  sourceType,
  tokens,
  ...input,
});

const createTurn = (input: {
  cacheRead: number;
  index: number;
  output: number;
  segments: SegmentTokenRecord[];
  sessionId: string;
}): TurnTokenSnapshot => {
  const totalTokens = input.segments.reduce((total, segment) => total + segment.tokens, 0);
  for (const segment of input.segments) segment.percentage = segment.tokens / totalTokens;
  return {
    cache: {
      cacheReadTokens: input.cacheRead,
      internalPrefixReuseRatio: input.index === 1 ? 0 : 0.82,
      providerCacheHitRate: input.cacheRead / Math.max(totalTokens, 1),
      uncachedInputTokens: totalTokens - input.cacheRead,
    },
    createdAt: Date.now() + input.index,
    generation: 0,
    runtime: { model: 'gpt-5.6-luna', provider: 'openai-codex' },
    segments: input.segments,
    sessionId: input.sessionId,
    totalCharacters: input.segments.reduce((total, segment) => total + segment.characters, 0),
    totalTokens,
    turnId: `${input.sessionId}:turn-${input.index}`,
    usage: {
      cacheReadTokens: input.cacheRead,
      inputTokens: totalTokens - input.cacheRead,
      outputTokens: input.output,
      reasoningTokens: Math.round(input.output * 0.45),
    },
  };
};

const baseSegments = (): SegmentTokenRecord[] => [
  createSegment('system', 'system', 920, { framingType: 'system:base' }),
  createSegment('skill-catalog', 'skill', 430, {
    framingType: 'contribution:stable-prefix:skills',
    messageId: 'injected:stable-prefix:skills',
  }),
  createSegment('user-task', 'user', 260, {
    messageId: 'message:user:1',
  }),
];

export const createDevtoolsFixture = () => {
  const recorder = createMessageEngineDevtoolsRecorder();
  const now = Date.now();
  const sessionId = 'torrent-analysis-7f3a2c';
  const torrentRun = recorder.startRun({
    model: 'gpt-5.6-luna',
    provider: 'openai-codex',
    sessionId,
    startedAt: now - 8600,
    subtitle: 'openai-codex/gpt-5.6-luna · 3 provider calls',
    title: 'The.Matrix.1999.2160p.REMUX',
  });
  const turn1 = createTurn({
    cacheRead: 0,
    index: 1,
    output: 212,
    segments: baseSegments(),
    sessionId,
  });
  const turn2 = createTurn({
    cacheRead: 1350,
    index: 2,
    output: 126,
    segments: [
      ...baseSegments(),
      createSegment('assistant-1', 'assistant', 212, { messageId: 'message:assistant:1' }),
      createSegment('tool-call-1', 'tool-call', 84, { messageId: 'message:assistant:1' }),
      createSegment('tool-result-1', 'tool-result', 340, { messageId: 'message:tool:1' }),
      createSegment('file-tree', 'document', 180, {
        cacheScope: 'turn',
        cacheStatus: 'not-eligible',
        framingType: 'contribution:last-user:file-tree',
        messageId: 'injected:last-user:file-tree',
      }),
    ],
    sessionId,
  });
  const turn3 = createTurn({
    cacheRead: 1984,
    index: 3,
    output: 88,
    segments: [
      ...turn2.segments.map((segment) => ({ ...segment })),
      createSegment('assistant-2', 'assistant', 126, { messageId: 'message:assistant:2' }),
      createSegment('tool-call-2', 'tool-call', 72, { messageId: 'message:assistant:2' }),
      createSegment('tool-result-2', 'tool-result', 220, { messageId: 'message:tool:2' }),
    ],
    sessionId,
  });
  void torrentRun.telemetrySink.write({ snapshot: turn1, type: 'usage-recorded' });
  torrentRun.recordActivity({
    detail: '{ query: "The Matrix", year: 1999 }',
    durationMs: 182,
    kind: 'tool',
    label: 'tmdbSearch',
    status: 'success',
    turnId: turn1.turnId,
  });
  void torrentRun.telemetrySink.write({ snapshot: turn2, type: 'usage-recorded' });
  torrentRun.recordActivity({
    detail: '429 · retry-after 800ms',
    durationMs: 800,
    kind: 'retry',
    label: 'Retry scheduled 1/2',
    status: 'warning',
    turnId: turn2.turnId,
  });
  torrentRun.recordActivity({
    detail: 'movie/603 · 24 localized fields',
    durationMs: 96,
    kind: 'tool',
    label: 'tmdbDetails',
    status: 'success',
    turnId: turn2.turnId,
  });
  void torrentRun.telemetrySink.write({ snapshot: turn3, type: 'usage-recorded' });
  torrentRun.recordActivity({
    detail: 'metadata accepted',
    durationMs: 14,
    kind: 'tool',
    label: 'submitMetadata',
    status: 'success',
    turnId: turn3.turnId,
  });
  torrentRun.end({ endedAt: now - 2100, status: 'success' });

  const regressionId = 'research-prefix-regression';
  const regressionRun = recorder.startRun({
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    sessionId: regressionId,
    startedAt: now - 1800,
    subtitle: 'strict prefix guard · blocked mutation',
    title: 'Workspace research session',
  });
  const regressionTurn = createTurn({
    cacheRead: 0,
    index: 1,
    output: 64,
    segments: baseSegments(),
    sessionId: regressionId,
  });
  void regressionRun.telemetrySink.write({ snapshot: regressionTurn, type: 'usage-recorded' });
  regressionRun.recordPrefixMutation({
    action: 'blocked',
    committedBoundary: 3,
    expected: false,
    firstChangedIndex: 1,
    instanceId: 'fixture-instance',
    nextGeneration: 1,
    previousGeneration: 0,
    reason: 'content-changed',
    sessionId: regressionId,
    strict: true,
  });
  regressionRun.end({
    endedAt: now - 620,
    error: 'Committed prefix mutation blocked',
    status: 'error',
  });

  return recorder;
};
