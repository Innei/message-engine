export type TokenAccuracy = 'exact' | 'estimated' | 'inferred';

export type TokenCacheScope = 'message' | 'session' | 'turn';

export type TokenCacheStatus =
  | 'cache-miss'
  | 'eligible'
  | 'not-eligible'
  | 'provider-cache-read'
  | 'provider-cache-write'
  | 'reused-internally';

export type TokenSourceType =
  | 'assistant'
  | 'document'
  | 'history-summary'
  | 'knowledge'
  | 'memory'
  | 'message-overhead'
  | 'runtime-state'
  | 'skill'
  | 'system'
  | 'tool-call'
  | 'tool-result'
  | 'tool-schema'
  | 'unattributed'
  | 'user';

export interface RuntimeIdentity {
  model: string;
  provider: string;
}

export interface TokenizerSegment {
  cacheScope: TokenCacheScope;
  content: string;
  contentDigest: string;
  framingType: string;
  messageId?: string;
  moduleId: string;
  processorId: string;
  segmentId: string;
  sourceType: TokenSourceType;
}

export interface TokenizerContext {
  runtime?: RuntimeIdentity;
  sessionId: string;
}

export interface Tokenizer {
  accuracy?: TokenAccuracy;
  id: string;
  count(content: string, context: TokenizerContext, signal?: AbortSignal): number | Promise<number>;
}

export interface SegmentTokenRecord extends Omit<TokenizerSegment, 'content'> {
  accuracy: TokenAccuracy;
  cacheStatus: TokenCacheStatus;
  characters: number;
  /** Raw content is omitted unless TokenAccountingOptions.includeContent is true. */
  content?: string;
  estimatedCost?: number;
  percentage: number;
  tokens: number;
}

export interface NormalizedUsage {
  /** Provider-reported cache-read input. Do not include this value in inputTokens. */
  cacheReadTokens?: number;
  /** Provider-reported cache-write input. Do not include this value in inputTokens. */
  cacheWriteTokens?: number;
  /** Uncached, billable input after provider-specific usage has been normalized. */
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  totalCost?: number;
}

export interface ModelPricing {
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
  currency: 'USD';
  effectiveAt?: string;
  inputPerMillion: number;
  outputPerMillion: number;
  version: string;
}

export interface PricingResolver {
  resolve(runtime: RuntimeIdentity, at: Date): ModelPricing | null | Promise<ModelPricing | null>;
}

export interface CostBreakdown {
  cacheRead: number;
  cacheWrite: number;
  currency: 'USD';
  input: number;
  output: number;
  pricingVersion: string;
  total: number;
}

export interface CacheMetrics {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  internalPrefixReuseRatio: number;
  providerCacheHitRate?: number;
  uncachedInputTokens?: number;
}

export interface TurnTokenSnapshot {
  cache: CacheMetrics;
  cost?: CostBreakdown;
  createdAt: number;
  generation: number;
  runtime?: RuntimeIdentity;
  segments: SegmentTokenRecord[];
  sessionId: string;
  totalCharacters: number;
  totalTokens: number;
  turnId: string;
  usage?: NormalizedUsage;
}

export interface TokenSourceSummary {
  characters: number;
  cost: number;
  percentage: number;
  sourceType: TokenSourceType;
  tokens: number;
}

export interface SessionTokenSummary {
  averageProviderCacheHitRate?: number;
  generations: number;
  instanceId: string;
  prefixViolations: number;
  sessionId: string;
  sources: TokenSourceSummary[];
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  turns: TurnTokenSnapshot[];
}

export type MessageEngineTelemetryEvent =
  | { snapshot: TurnTokenSnapshot; type: 'turn-compiled' }
  | { snapshot: TurnTokenSnapshot; type: 'usage-recorded' }
  | { summary: SessionTokenSummary; type: 'session-summary' };

export interface TelemetrySink {
  destroy?(): Promise<void> | void;
  flush?(): Promise<void> | void;
  write(event: MessageEngineTelemetryEvent): Promise<void> | void;
}

export interface TokenAccountingOptions {
  includeContent?: boolean;
  pricing?: PricingResolver;
  retainTurns?: number;
  sinks?: TelemetrySink[];
  strictTelemetry?: boolean;
  tokenizer: Tokenizer;
}
