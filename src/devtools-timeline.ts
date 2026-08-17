import type {
  SegmentTokenRecord,
  TokenCacheScope,
  TokenCacheStatus,
  TokenSourceType,
  TurnTokenSnapshot,
} from './token-types.js';

export type TelemetryCacheCoverage = 'full' | 'none' | 'partial';

export interface TelemetryCachePolicy {
  /** Minimum provider prefix size that is eligible for caching. */
  minimumCacheTokens?: number;
}

export type TelemetryCacheHintKind =
  'below-floor' | 'missed-after-prefix' | 'near-floor' | 'page-remainder';

export interface TelemetryCacheHint {
  kind: TelemetryCacheHintKind;
  tokens: number;
}

export interface TelemetryTimelineSegment {
  boundary: boolean;
  cacheScope: TokenCacheScope;
  cacheStatus: TokenCacheStatus;
  cachedTokens: number;
  coverage: TelemetryCacheCoverage;
  framingType: string;
  id: string;
  injected: boolean;
  messageId?: string;
  moduleId: string;
  processorId: string;
  sourceType: TokenSourceType;
  tokens: number;
}

export interface TelemetryTimelineTurn {
  cacheHitPercent?: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedTokens: number;
  hint?: TelemetryCacheHint;
  index: number;
  inputTokens?: number;
  outputTokens?: number;
  promptTokens: number;
  reasoningTokens?: number;
  reprocessedTokens: number;
  segments: TelemetryTimelineSegment[];
  snapshot: TurnTokenSnapshot;
  totalTokens: number;
  turnId: string;
  unchangedTokens: number;
  visualTokens: number;
}

export interface TelemetryTimeline {
  maxVisualTokens: number;
  turns: TelemetryTimelineTurn[];
}

const isStablePrefixDuplicate = (segment: SegmentTokenRecord): boolean =>
  segment.processorId === 'raw-message' &&
  segment.messageId?.startsWith('injected:stable-prefix:') === true;

const orderSegments = (segments: readonly SegmentTokenRecord[]): SegmentTokenRecord[] => {
  const system: SegmentTokenRecord[] = [];
  const stablePrefix: SegmentTokenRecord[] = [];
  const rest: SegmentTokenRecord[] = [];
  const seenSystemDigests = new Set<string>();

  for (const segment of segments) {
    if (isStablePrefixDuplicate(segment)) continue;
    if (segment.sourceType === 'system') {
      if (seenSystemDigests.has(segment.contentDigest)) continue;
      seenSystemDigests.add(segment.contentDigest);
      system.push(segment);
      continue;
    }
    if (segment.framingType.startsWith('contribution:stable-prefix')) {
      stablePrefix.push(segment);
      continue;
    }
    rest.push(segment);
  }

  return [...system, ...stablePrefix, ...rest];
};

const providerPromptTokens = (snapshot: TurnTokenSnapshot): number | undefined => {
  if (!snapshot.usage) return undefined;
  return snapshot.usage.inputTokens + (snapshot.usage.cacheReadTokens ?? 0);
};

const detectCacheHint = (
  index: number,
  promptTokens: number,
  cacheReadTokens: number,
  previousPromptTokens: number | undefined,
  policy: TelemetryCachePolicy | undefined,
): TelemetryCacheHint | undefined => {
  const floor = policy?.minimumCacheTokens;
  if (!floor || floor <= 0) return undefined;

  if (index === 1 && cacheReadTokens === 0) {
    if (promptTokens > 0 && promptTokens < floor) {
      return { kind: 'below-floor', tokens: promptTokens };
    }
    if (promptTokens >= floor && promptTokens < floor * 2) {
      return { kind: 'near-floor', tokens: promptTokens };
    }
    return undefined;
  }

  if (cacheReadTokens === 0 && previousPromptTokens !== undefined && previousPromptTokens > 0) {
    if (previousPromptTokens < floor) {
      return { kind: 'below-floor', tokens: previousPromptTokens };
    }
    return { kind: 'missed-after-prefix', tokens: previousPromptTokens };
  }

  if (
    cacheReadTokens > 0 &&
    previousPromptTokens !== undefined &&
    previousPromptTokens > cacheReadTokens
  ) {
    const remainder = previousPromptTokens - cacheReadTokens;
    if (remainder > 0 && remainder < floor) {
      return { kind: 'page-remainder', tokens: remainder };
    }
  }

  return undefined;
};

const createOverheadSegment = (tokens: number): SegmentTokenRecord => ({
  accuracy: 'inferred',
  cacheScope: 'session',
  cacheStatus: 'eligible',
  characters: 0,
  contentDigest: 'provider-message-overhead',
  framingType: 'provider:unattributed-input',
  moduleId: 'provider',
  percentage: 0,
  processorId: 'provider-message-overhead',
  segmentId: 'provider-message-overhead',
  sourceType: 'message-overhead',
  tokens,
});

const toTimelineSegments = (
  records: readonly SegmentTokenRecord[],
  cacheReadTokens: number,
  hasProviderUsage: boolean,
): { cachedTokens: number; segments: TelemetryTimelineSegment[] } => {
  let cacheBudget = cacheReadTokens;
  let cachedTokens = 0;
  let previousMessageId: string | undefined;
  let prefixClosed = false;
  const segments: TelemetryTimelineSegment[] = [];

  for (const record of records) {
    const canUseProviderPrefix = !prefixClosed && record.cacheScope !== 'turn';
    let providerCovered = 0;
    if (hasProviderUsage && canUseProviderPrefix) {
      providerCovered = Math.min(cacheBudget, record.tokens);
    }
    if (hasProviderUsage) cacheBudget -= providerCovered;
    if (record.cacheScope === 'turn') prefixClosed = true;

    const inferredCovered =
      !hasProviderUsage &&
      (record.cacheStatus === 'provider-cache-read' || record.cacheStatus === 'reused-internally')
        ? record.tokens
        : 0;
    const covered = hasProviderUsage ? providerCovered : inferredCovered;
    cachedTokens += covered;
    let coverage: TelemetryCacheCoverage = 'partial';
    if (covered <= 0) coverage = 'none';
    else if (covered >= record.tokens) coverage = 'full';
    const boundary = Boolean(record.messageId) && record.messageId !== previousMessageId;

    segments.push({
      boundary,
      cacheScope: record.cacheScope,
      cacheStatus: record.cacheStatus,
      cachedTokens: covered,
      coverage,
      framingType: record.framingType,
      id: record.segmentId,
      injected:
        record.cacheScope === 'turn' ||
        record.framingType.startsWith('contribution:') ||
        record.messageId?.startsWith('injected:') === true,
      ...(record.messageId ? { messageId: record.messageId } : {}),
      moduleId: record.moduleId,
      processorId: record.processorId,
      sourceType: record.sourceType,
      tokens: record.tokens,
    });
    previousMessageId = record.messageId;
  }

  return { cachedTokens, segments };
};

const toTimelineTurn = (
  snapshot: TurnTokenSnapshot,
  index: number,
  previousPromptTokens: number | undefined,
  policy: TelemetryCachePolicy | undefined,
): TelemetryTimelineTurn => {
  const ordered = orderSegments(snapshot.segments);
  const attributedTokens = ordered.reduce((total, segment) => total + segment.tokens, 0);
  const promptFromProvider = providerPromptTokens(snapshot);
  const promptTokens = promptFromProvider ?? attributedTokens;
  const overhead = Math.max(0, promptTokens - attributedTokens);
  const visualRecords = overhead > 0 ? [createOverheadSegment(overhead), ...ordered] : ordered;
  const cacheReadTokens = snapshot.usage?.cacheReadTokens ?? 0;
  const projection = toTimelineSegments(visualRecords, cacheReadTokens, Boolean(snapshot.usage));
  const visualTokens = visualRecords.reduce((total, segment) => total + segment.tokens, 0);
  const unchangedTokens = visualRecords.reduce(
    (total, segment) =>
      segment.cacheStatus === 'reused-internally' ? total + segment.tokens : total,
    0,
  );
  const cacheHitPercent =
    promptTokens > 0 && snapshot.usage ? cacheReadTokens / promptTokens : undefined;
  const hint = detectCacheHint(index, promptTokens, cacheReadTokens, previousPromptTokens, policy);

  return {
    ...(cacheHitPercent === undefined ? {} : { cacheHitPercent }),
    cacheReadTokens,
    cacheWriteTokens: snapshot.usage?.cacheWriteTokens ?? 0,
    cachedTokens: projection.cachedTokens,
    ...(hint ? { hint } : {}),
    index,
    ...(snapshot.usage ? { inputTokens: snapshot.usage.inputTokens } : {}),
    ...(snapshot.usage ? { outputTokens: snapshot.usage.outputTokens } : {}),
    promptTokens,
    ...(snapshot.usage?.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: snapshot.usage.reasoningTokens }),
    reprocessedTokens: Math.max(0, visualTokens - projection.cachedTokens),
    segments: projection.segments,
    snapshot,
    totalTokens: snapshot.totalTokens,
    turnId: snapshot.turnId,
    unchangedTokens,
    visualTokens,
  };
};

export const toTelemetryTimeline = (
  snapshots: readonly TurnTokenSnapshot[],
  options?: { cachePolicy?: TelemetryCachePolicy },
): TelemetryTimeline => {
  const turns: TelemetryTimelineTurn[] = [];
  let previousPromptTokens: number | undefined;
  let maxVisualTokens = 0;

  snapshots.forEach((snapshot, offset) => {
    const turn = toTimelineTurn(snapshot, offset + 1, previousPromptTokens, options?.cachePolicy);
    turns.push(turn);
    previousPromptTokens = turn.promptTokens;
    maxVisualTokens = Math.max(maxVisualTokens, turn.visualTokens);
  });

  return { maxVisualTokens, turns };
};
