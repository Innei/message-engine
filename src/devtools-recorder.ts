import type {
  MessageEngineTelemetryEvent,
  SessionTokenSummary,
  TelemetrySink,
  TokenSourceSummary,
  TokenSourceType,
  TurnTokenSnapshot,
} from './token-types.js';
import type { PrefixMutationEvent } from './types.js';

export type MessageEngineTraceRunStatus = 'error' | 'running' | 'success';
export type MessageEngineTraceActivityKind = 'error' | 'info' | 'rate-limit' | 'retry' | 'tool';
export type MessageEngineTraceActivityStatus = 'error' | 'pending' | 'success' | 'warning';

export interface MessageEngineTraceActivity {
  detail?: string;
  durationMs?: number;
  id: string;
  kind: MessageEngineTraceActivityKind;
  label: string;
  status?: MessageEngineTraceActivityStatus;
  timestamp: number;
  turnId?: string;
}

export interface MessageEngineTraceRunMetadata {
  model?: string;
  provider?: string;
  sessionId: string;
  startedAt?: number;
  subtitle?: string;
  title?: string;
}

export interface MessageEngineTraceRun extends MessageEngineTraceRunMetadata {
  activities: MessageEngineTraceActivity[];
  endedAt?: number;
  error?: string;
  prefixMutations: PrefixMutationEvent[];
  status: MessageEngineTraceRunStatus;
  summary: SessionTokenSummary;
}

export interface MessageEngineDevtoolsSnapshot {
  runs: MessageEngineTraceRun[];
  version: 1;
}

export interface MessageEngineDevtoolsSource {
  getSnapshot(): MessageEngineDevtoolsSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface MessageEngineTraceActivityInput {
  detail?: string;
  durationMs?: number;
  id?: string;
  kind: MessageEngineTraceActivityKind;
  label: string;
  status?: MessageEngineTraceActivityStatus;
  timestamp?: number;
  turnId?: string;
}

export interface MessageEngineTraceRunBinding {
  end(input?: {
    endedAt?: number;
    error?: string;
    status?: Exclude<MessageEngineTraceRunStatus, 'running'>;
  }): void;
  recordActivity(activity: MessageEngineTraceActivityInput): void;
  recordPrefixMutation(event: PrefixMutationEvent): void;
  telemetrySink: TelemetrySink;
  updateMetadata(metadata: Partial<Omit<MessageEngineTraceRunMetadata, 'sessionId'>>): void;
}

export interface MessageEngineDevtoolsRecorder extends MessageEngineDevtoolsSource {
  clear(): void;
  getRun(sessionId: string): MessageEngineTraceRun | undefined;
  startRun(metadata: MessageEngineTraceRunMetadata): MessageEngineTraceRunBinding;
}

interface MutableSourceAggregate {
  characters: number;
  cost: number;
  tokens: number;
}

const emptySummary = (sessionId: string): SessionTokenSummary => ({
  generations: 0,
  instanceId: `devtools:${sessionId}`,
  prefixViolations: 0,
  sessionId,
  sources: [],
  totalCacheReadTokens: 0,
  totalCacheWriteTokens: 0,
  totalCost: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  turns: [],
});

const cloneRun = (run: MessageEngineTraceRun): MessageEngineTraceRun => ({
  ...run,
  activities: [...run.activities],
  prefixMutations: [...run.prefixMutations],
  summary: {
    ...run.summary,
    sources: [...run.summary.sources],
    turns: [...run.summary.turns],
  },
});

const rebuildSummary = (
  current: SessionTokenSummary,
  turns: readonly TurnTokenSnapshot[],
  prefixViolations: number,
): SessionTokenSummary => {
  const sourceAggregates = new Map<TokenSourceType, MutableSourceAggregate>();
  const generations = new Set<number>();
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;

  for (const turn of turns) {
    generations.add(turn.generation);
    totalCacheReadTokens += turn.usage?.cacheReadTokens ?? 0;
    totalCacheWriteTokens += turn.usage?.cacheWriteTokens ?? 0;
    totalCost += turn.cost?.total ?? 0;
    totalInputTokens += turn.usage?.inputTokens ?? 0;
    totalOutputTokens += turn.usage?.outputTokens ?? 0;
    totalTokens += turn.totalTokens;
    for (const segment of turn.segments) {
      const aggregate = sourceAggregates.get(segment.sourceType) ?? {
        characters: 0,
        cost: 0,
        tokens: 0,
      };
      aggregate.characters += segment.characters;
      aggregate.cost += segment.estimatedCost ?? 0;
      aggregate.tokens += segment.tokens;
      sourceAggregates.set(segment.sourceType, aggregate);
    }
  }

  const sources: TokenSourceSummary[] = [...sourceAggregates.entries()]
    .map(([sourceType, aggregate]) => ({
      ...aggregate,
      percentage: totalTokens === 0 ? 0 : aggregate.tokens / totalTokens,
      sourceType,
    }))
    .sort((left, right) => right.tokens - left.tokens);
  const providerInput = totalInputTokens + totalCacheReadTokens;

  return {
    ...(providerInput > 0
      ? { averageProviderCacheHitRate: totalCacheReadTokens / providerInput }
      : {}),
    generations: generations.size,
    instanceId: current.instanceId,
    prefixViolations,
    sessionId: current.sessionId,
    sources,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    turns: [...turns],
  };
};

const upsertTurn = (
  summary: SessionTokenSummary,
  snapshot: TurnTokenSnapshot,
  prefixViolations: number,
): SessionTokenSummary => {
  const turns = [...summary.turns];
  const index = turns.findIndex((turn) => turn.turnId === snapshot.turnId);
  if (index < 0) turns.push(snapshot);
  else turns[index] = snapshot;
  return rebuildSummary(summary, turns, prefixViolations);
};

export const createMessageEngineDevtoolsRecorder = (options?: {
  maxActivitiesPerRun?: number;
  maxRuns?: number;
}): MessageEngineDevtoolsRecorder => {
  const maxActivities = Math.max(1, options?.maxActivitiesPerRun ?? 400);
  const maxRuns = Math.max(1, options?.maxRuns ?? 20);
  const listeners = new Set<() => void>();
  const order: string[] = [];
  const runs = new Map<string, MessageEngineTraceRun>();
  let activitySequence = 0;
  let published: MessageEngineDevtoolsSnapshot = { runs: [], version: 1 };

  const publish = (): void => {
    published = {
      runs: order.flatMap((sessionId) => {
        const run = runs.get(sessionId);
        return run ? [cloneRun(run)] : [];
      }),
      version: 1,
    };
    for (const listener of listeners) listener();
  };

  const ensureRun = (sessionId: string): MessageEngineTraceRun => {
    const existing = runs.get(sessionId);
    if (existing) return existing;
    const created: MessageEngineTraceRun = {
      activities: [],
      prefixMutations: [],
      sessionId,
      startedAt: Date.now(),
      status: 'running',
      summary: emptySummary(sessionId),
      title: sessionId,
    };
    runs.set(sessionId, created);
    order.push(sessionId);
    while (order.length > maxRuns) {
      const removed = order.shift();
      if (removed) runs.delete(removed);
    }
    return created;
  };

  const startRun = (metadata: MessageEngineTraceRunMetadata): MessageEngineTraceRunBinding => {
    const run = ensureRun(metadata.sessionId);
    Object.assign(run, metadata, {
      startedAt: metadata.startedAt ?? run.startedAt,
      status: 'running' as const,
    });
    publish();

    const telemetrySink: TelemetrySink = {
      write(event: MessageEngineTelemetryEvent) {
        const targetSessionId =
          event.type === 'session-summary' ? event.summary.sessionId : event.snapshot.sessionId;
        const target = ensureRun(targetSessionId);
        if (event.type === 'session-summary') {
          target.summary = event.summary;
        } else {
          target.summary = upsertTurn(
            target.summary,
            event.snapshot,
            Math.max(target.summary.prefixViolations, target.prefixMutations.length),
          );
        }
        publish();
      },
    };

    return {
      end(input) {
        const target = ensureRun(metadata.sessionId);
        target.endedAt = input?.endedAt ?? Date.now();
        target.status = input?.status ?? 'success';
        if (input?.error) target.error = input.error;
        publish();
      },
      recordActivity(activity) {
        const target = ensureRun(metadata.sessionId);
        activitySequence += 1;
        target.activities.push({
          ...activity,
          id: activity.id ?? `activity-${activitySequence}`,
          timestamp: activity.timestamp ?? Date.now(),
        });
        if (target.activities.length > maxActivities) {
          target.activities.splice(0, target.activities.length - maxActivities);
        }
        publish();
      },
      recordPrefixMutation(event) {
        const target = ensureRun(metadata.sessionId);
        target.prefixMutations.push(event);
        target.summary = {
          ...target.summary,
          prefixViolations: Math.max(
            target.summary.prefixViolations,
            target.prefixMutations.length,
          ),
        };
        publish();
      },
      telemetrySink,
      updateMetadata(nextMetadata) {
        Object.assign(ensureRun(metadata.sessionId), nextMetadata);
        publish();
      },
    };
  };

  return {
    clear() {
      order.length = 0;
      runs.clear();
      publish();
    },
    getRun(sessionId) {
      const run = runs.get(sessionId);
      return run ? cloneRun(run) : undefined;
    },
    getSnapshot() {
      return published;
    },
    startRun,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
