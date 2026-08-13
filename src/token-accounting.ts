import type {
  CostBreakdown,
  MessageEngineTelemetryEvent,
  ModelPricing,
  NormalizedUsage,
  RuntimeIdentity,
  SegmentTokenRecord,
  SessionTokenSummary,
  TokenAccountingOptions,
  TokenCacheStatus,
  TokenSourceSummary,
  TokenSourceType,
  TokenizerSegment,
  TurnTokenSnapshot,
} from './token-types.js';

interface MeasureTurnInput {
  generation: number;
  internalPrefixReuseRatio: number;
  runtime?: RuntimeIdentity;
  segments: readonly TokenizerSegment[];
  signal?: AbortSignal;
  turnId: string;
}

interface SourceAggregate {
  characters: number;
  cost: number;
  tokens: number;
}

const pricingCost = (
  usage: NormalizedUsage,
  pricing: ModelPricing | null,
): CostBreakdown | undefined => {
  if (!pricing && usage.totalCost === undefined) return undefined;

  const input = pricing ? (usage.inputTokens * pricing.inputPerMillion) / 1_000_000 : 0;
  const output = pricing ? (usage.outputTokens * pricing.outputPerMillion) / 1_000_000 : 0;
  const cacheRead = pricing
    ? ((usage.cacheReadTokens ?? 0) * (pricing.cacheReadPerMillion ?? 0)) / 1_000_000
    : 0;
  const cacheWrite = pricing
    ? ((usage.cacheWriteTokens ?? 0) * (pricing.cacheWritePerMillion ?? 0)) / 1_000_000
    : 0;

  return {
    cacheRead,
    cacheWrite,
    currency: 'USD',
    input,
    output,
    pricingVersion: pricing?.version ?? 'provider-reported',
    total: usage.totalCost ?? input + output + cacheRead + cacheWrite,
  };
};

const percentage = (part: number, total: number): number => (total === 0 ? 0 : part / total);

const resolveCacheStatus = (
  cachedTokens: number | undefined,
  cacheScope: TokenizerSegment['cacheScope'],
): TokenCacheStatus => {
  if (cachedTokens !== undefined) return 'reused-internally';
  if (cacheScope === 'turn') return 'not-eligible';
  return 'eligible';
};

export class TokenAccountingManager {
  private readonly countCache = new Map<string, number>();
  private readonly generations = new Set<number>();
  private readonly retainedOrder: string[] = [];
  private readonly snapshots = new Map<string, TurnTokenSnapshot>();
  private readonly sourceAggregates = new Map<TokenSourceType, SourceAggregate>();
  private readonly turnCostAllocations = new Map<string, Map<TokenSourceType, number>>();
  private destroyed = false;
  private prefixViolations = 0;
  private totalCacheReadTokens = 0;
  private totalCacheWriteTokens = 0;
  private totalCost = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalTokens = 0;

  constructor(
    private readonly sessionId: string,
    private readonly instanceId: string,
    private readonly options: TokenAccountingOptions,
  ) {}

  async measureTurn(input: MeasureTurnInput): Promise<TurnTokenSnapshot> {
    this.assertActive();
    if (this.snapshots.has(input.turnId)) {
      throw new Error(`Turn ${input.turnId} has already been measured`);
    }
    const records: SegmentTokenRecord[] = [];

    for (const segment of input.segments) {
      input.signal?.throwIfAborted();
      const runtimeKey = input.runtime
        ? `${input.runtime.provider}/${input.runtime.model}`
        : 'unknown-runtime';
      const cacheKey = [
        this.options.tokenizer.id,
        runtimeKey,
        segment.framingType,
        segment.contentDigest,
      ].join(':');
      const cached = this.countCache.get(cacheKey);
      const counted =
        cached ??
        (await this.options.tokenizer.count(
          segment.content,
          {
            ...(input.runtime ? { runtime: input.runtime } : {}),
            sessionId: this.sessionId,
          },
          input.signal,
        ));
      const tokens = Math.max(0, Math.round(counted));
      if (cached === undefined) this.countCache.set(cacheKey, tokens);

      const { content: _, ...segmentMetadata } = segment;
      records.push({
        ...segmentMetadata,
        accuracy: this.options.tokenizer.accuracy ?? 'exact',
        cacheStatus: resolveCacheStatus(cached, segment.cacheScope),
        characters: segment.content.length,
        ...(this.options.includeContent ? { content: segment.content } : {}),
        percentage: 0,
        tokens,
      });
    }

    const totalCharacters = records.reduce((total, record) => total + record.characters, 0);
    const totalTokens = records.reduce((total, record) => total + record.tokens, 0);
    for (const record of records) record.percentage = percentage(record.tokens, totalTokens);

    const snapshot: TurnTokenSnapshot = {
      cache: { internalPrefixReuseRatio: input.internalPrefixReuseRatio },
      createdAt: Date.now(),
      generation: input.generation,
      ...(input.runtime ? { runtime: input.runtime } : {}),
      segments: records,
      sessionId: this.sessionId,
      totalCharacters,
      totalTokens,
      turnId: input.turnId,
    };

    this.totalTokens += totalTokens;
    this.generations.add(input.generation);
    for (const record of records) {
      const aggregate = this.sourceAggregates.get(record.sourceType) ?? {
        characters: 0,
        cost: 0,
        tokens: 0,
      };
      aggregate.characters += record.characters;
      aggregate.tokens += record.tokens;
      this.sourceAggregates.set(record.sourceType, aggregate);
    }
    this.retain(snapshot);
    await this.emit({ snapshot, type: 'turn-compiled' });
    return snapshot;
  }

  notePrefixViolation(): void {
    this.prefixViolations += 1;
  }

  async recordUsage(turnId: string, usage: NormalizedUsage): Promise<TurnTokenSnapshot> {
    this.assertActive();
    const current = this.snapshots.get(turnId);
    if (!current) throw new RangeError(`Unknown or expired turn ${turnId}`);

    if (current.usage) {
      this.totalInputTokens -= current.usage.inputTokens;
      this.totalOutputTokens -= current.usage.outputTokens;
      this.totalCacheReadTokens -= current.usage.cacheReadTokens ?? 0;
      this.totalCacheWriteTokens -= current.usage.cacheWriteTokens ?? 0;
      this.removeCostAllocation(turnId, current.cost?.total ?? 0);
    }

    const pricing =
      current.runtime && this.options.pricing
        ? await this.options.pricing.resolve(current.runtime, new Date(current.createdAt))
        : null;
    const cost = pricingCost(usage, pricing);
    const inputDenominator = usage.inputTokens + (usage.cacheReadTokens ?? 0);
    const providerCacheHitRate =
      inputDenominator === 0 ? undefined : (usage.cacheReadTokens ?? 0) / inputDenominator;
    let remainingCacheRead = usage.cacheReadTokens ?? 0;
    let remainingCacheWrite = usage.cacheWriteTokens ?? 0;
    const segments = current.segments.map((record) => {
      let cacheStatus = record.cacheStatus;
      if (record.cacheScope !== 'turn' && remainingCacheRead > 0) {
        cacheStatus = 'provider-cache-read';
        remainingCacheRead -= Math.min(remainingCacheRead, record.tokens);
      } else if (record.cacheScope !== 'turn' && remainingCacheWrite > 0) {
        cacheStatus = 'provider-cache-write';
        remainingCacheWrite -= Math.min(remainingCacheWrite, record.tokens);
      }
      return {
        ...record,
        cacheStatus,
        ...(cost ? { estimatedCost: cost.total * record.percentage } : {}),
      };
    });

    const snapshot: TurnTokenSnapshot = {
      ...current,
      cache: {
        ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
        ...(usage.cacheWriteTokens === undefined
          ? {}
          : { cacheWriteTokens: usage.cacheWriteTokens }),
        internalPrefixReuseRatio: current.cache.internalPrefixReuseRatio,
        ...(providerCacheHitRate === undefined ? {} : { providerCacheHitRate }),
        uncachedInputTokens: usage.inputTokens,
      },
      ...(cost ? { cost } : {}),
      segments,
      usage,
    };
    this.snapshots.set(turnId, snapshot);

    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;
    this.totalCacheReadTokens += usage.cacheReadTokens ?? 0;
    this.totalCacheWriteTokens += usage.cacheWriteTokens ?? 0;
    if (cost) this.addCostAllocation(snapshot, cost.total);

    await this.emit({ snapshot, type: 'usage-recorded' });
    return snapshot;
  }

  summary(): SessionTokenSummary {
    const sources: TokenSourceSummary[] = [...this.sourceAggregates.entries()]
      .map(([sourceType, aggregate]) => ({
        ...aggregate,
        percentage: percentage(aggregate.tokens, this.totalTokens),
        sourceType,
      }))
      .sort((left, right) => right.tokens - left.tokens);

    return {
      ...(this.totalInputTokens + this.totalCacheReadTokens > 0
        ? {
            averageProviderCacheHitRate:
              this.totalCacheReadTokens / (this.totalInputTokens + this.totalCacheReadTokens),
          }
        : {}),
      generations: this.generations.size,
      instanceId: this.instanceId,
      prefixViolations: this.prefixViolations,
      sessionId: this.sessionId,
      sources,
      totalCacheReadTokens: this.totalCacheReadTokens,
      totalCacheWriteTokens: this.totalCacheWriteTokens,
      totalCost: this.totalCost,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalTokens: this.totalTokens,
      turns: this.retainedOrder.flatMap((turnId) => {
        const snapshot = this.snapshots.get(turnId);
        return snapshot ? [snapshot] : [];
      }),
    };
  }

  async destroy(): Promise<SessionTokenSummary> {
    if (this.destroyed) {
      return {
        generations: 0,
        instanceId: this.instanceId,
        prefixViolations: 0,
        sessionId: this.sessionId,
        sources: [],
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        turns: [],
      };
    }
    const summary = this.summary();
    const errors: unknown[] = [];
    try {
      await this.emit({ summary, type: 'session-summary' });
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.runSinkMethod('flush');
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.runSinkMethod('destroy');
    } catch (error) {
      errors.push(error);
    }
    this.destroyed = true;
    this.countCache.clear();
    this.snapshots.clear();
    this.sourceAggregates.clear();
    this.turnCostAllocations.clear();
    this.generations.clear();
    this.retainedOrder.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Token accounting teardown failed');
    }
    return summary;
  }

  private addCostAllocation(snapshot: TurnTokenSnapshot, total: number): void {
    const allocations = new Map<TokenSourceType, number>();
    for (const record of snapshot.segments) {
      const amount = total * record.percentage;
      allocations.set(record.sourceType, (allocations.get(record.sourceType) ?? 0) + amount);
    }
    for (const [sourceType, amount] of allocations) {
      const aggregate = this.sourceAggregates.get(sourceType);
      if (aggregate) aggregate.cost += amount;
    }
    this.turnCostAllocations.set(snapshot.turnId, allocations);
    this.totalCost += total;
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error('Token accounting manager has been destroyed');
  }

  private async emit(event: MessageEngineTelemetryEvent): Promise<void> {
    const errors: unknown[] = [];
    for (const sink of this.options.sinks ?? []) {
      try {
        await sink.write(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (this.options.strictTelemetry && errors.length > 0) {
      throw new AggregateError(errors, `Telemetry write failed for ${event.type}`);
    }
  }

  private removeCostAllocation(turnId: string, total: number): void {
    const allocation = this.turnCostAllocations.get(turnId);
    if (!allocation) return;
    for (const [sourceType, amount] of allocation) {
      const aggregate = this.sourceAggregates.get(sourceType);
      if (aggregate) aggregate.cost -= amount;
    }
    this.turnCostAllocations.delete(turnId);
    this.totalCost -= total;
  }

  private retain(snapshot: TurnTokenSnapshot): void {
    this.snapshots.set(snapshot.turnId, snapshot);
    this.retainedOrder.push(snapshot.turnId);
    const retainTurns = Math.max(1, this.options.retainTurns ?? 100);
    while (this.retainedOrder.length > retainTurns) {
      const expired = this.retainedOrder.shift();
      if (expired) {
        this.snapshots.delete(expired);
        this.turnCostAllocations.delete(expired);
      }
    }
  }

  private async runSinkMethod(method: 'destroy' | 'flush'): Promise<void> {
    const errors: unknown[] = [];
    for (const sink of this.options.sinks ?? []) {
      try {
        await sink[method]?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (this.options.strictTelemetry && errors.length > 0) {
      throw new AggregateError(errors, `Telemetry ${method} failed`);
    }
  }
}
