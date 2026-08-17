import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import type {
  MessageEngineDevtoolsSource,
  MessageEngineTraceActivity,
  MessageEngineTraceRun,
} from './devtools-recorder.js';
import { MESSAGE_ENGINE_DEVTOOLS_CSS } from './devtools-react-styles.js';
import { TELEMETRY_SOURCE_COLORS } from './devtools-sunburst.js';
import {
  toTelemetryTimeline,
  type TelemetryCacheHint,
  type TelemetryCachePolicy,
  type TelemetryTimeline,
  type TelemetryTimelineSegment,
  type TelemetryTimelineTurn,
} from './devtools-timeline.js';
import type { SegmentTokenRecord, TokenSourceType, TurnTokenSnapshot } from './token-types.js';

export type MessageEngineDevtoolsTheme = 'dark' | 'light' | 'system';
export type MessageEngineDevtoolsInspectorView =
  'activities' | 'cache' | 'overview' | 'prompt' | 'raw';
/** `timeline` and `anatomy` remain accepted for compatibility with the first React release. */
export type MessageEngineDevtoolsView = MessageEngineDevtoolsInspectorView | 'anatomy' | 'timeline';

export interface MessageEngineDevtoolsLabels {
  activities: string;
  anatomy: string;
  cache: string;
  calls: string;
  emptyDescription: string;
  emptyTitle: string;
  export: string;
  input: string;
  output: string;
  overview: string;
  prompt: string;
  raw: string;
  runs: string;
  searchRuns: string;
  selectRun: string;
  timeline: string;
  title: string;
}

export interface MessageEngineTraceViewerProps {
  cachePolicy?: TelemetryCachePolicy | undefined;
  className?: string | undefined;
  defaultView?: MessageEngineDevtoolsView | undefined;
  formatCacheHint?: ((hint: TelemetryCacheHint) => ReactNode) | undefined;
  labels?: Partial<MessageEngineDevtoolsLabels> | undefined;
  run: MessageEngineTraceRun;
  sourceColors?: Partial<Record<TokenSourceType, string>> | undefined;
  styleNonce?: string | undefined;
  theme?: MessageEngineDevtoolsTheme | undefined;
}

export interface MessageEngineDevtoolsProps extends Omit<MessageEngineTraceViewerProps, 'run'> {
  onExport?: ((run: MessageEngineTraceRun) => void) | undefined;
  onSelectedRunChange?: ((sessionId: string) => void) | undefined;
  selectedRunId?: string | undefined;
  source: MessageEngineDevtoolsSource;
}

const DEFAULT_LABELS: MessageEngineDevtoolsLabels = {
  activities: 'Activities',
  anatomy: 'Prompt anatomy',
  cache: 'Cache',
  calls: 'Calls',
  emptyDescription: 'Compile a turn to inspect its execution context.',
  emptyTitle: 'No trace runs yet',
  export: 'Export',
  input: 'Input',
  output: 'Output',
  overview: 'Overview',
  prompt: 'Prompt',
  raw: 'Raw',
  runs: 'Runs',
  searchRuns: 'Search runs',
  selectRun: 'Select trace run',
  timeline: 'Trace',
  title: 'Message Engine',
};

const INSPECTOR_VIEWS: readonly MessageEngineDevtoolsInspectorView[] = [
  'overview',
  'prompt',
  'cache',
  'activities',
  'raw',
];

const INTEGER_FORMATTER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const TIME_FORMATTER = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
});

const cssVariables = (variables: Record<`--${string}`, string>): CSSProperties =>
  variables as CSSProperties;

const joinClassNames = (...values: Array<string | undefined>): string =>
  values.filter((value): value is string => Boolean(value)).join(' ');

const formatInteger = (value: number): string => INTEGER_FORMATTER.format(value);

const formatTokens = (value: number): string => {
  if (value < 1000) return formatInteger(value);
  const digits = value >= 10_000 ? 0 : 1;
  return `${(value / 1000).toFixed(digits).replace(/\.0$/u, '')}k`;
};

const formatPercent = (value: number | undefined): string =>
  value === undefined ? '—' : `${Math.round(value * 100)}%`;

const formatTime = (timestamp: number | undefined): string => {
  if (timestamp === undefined) return '—';
  return TIME_FORMATTER.format(timestamp);
};

const formatDuration = (run: MessageEngineTraceRun): string => {
  if (run.startedAt === undefined || run.endedAt === undefined) return 'LIVE';
  const duration = Math.max(0, run.endedAt - run.startedAt);
  if (duration < 1000) return `${formatInteger(duration)}ms`;
  return `${(duration / 1000).toFixed(duration < 10_000 ? 1 : 0)}s`;
};

const getInspectorView = (
  view: MessageEngineDevtoolsView | undefined,
): MessageEngineDevtoolsInspectorView => {
  if (view === 'anatomy') return 'prompt';
  if (view === undefined || view === 'timeline') return 'overview';
  return view;
};

const defaultFormatCacheHint = (hint: TelemetryCacheHint): ReactNode => {
  const tokens = formatTokens(hint.tokens);
  switch (hint.kind) {
    case 'below-floor':
      return `Prefix ${tokens} is below the provider cache floor`;
    case 'near-floor':
      return `Prefix ${tokens} is near the provider cache floor`;
    case 'missed-after-prefix':
      return `Expected reusable prefix ${tokens}, but the provider reported no cache read`;
    case 'page-remainder':
      return `${tokens} of the previous prefix was not covered by the provider cache`;
  }
};

const MessageEngineDevtoolsStyles = ({ nonce }: { nonce?: string | undefined }) => (
  <style {...(nonce ? { nonce } : {})}>{MESSAGE_ENGINE_DEVTOOLS_CSS}</style>
);

const StatusMark = ({ status }: { status: MessageEngineTraceRun['status'] }) => (
  <span aria-label={status} className="me-status-mark" data-status={status}>
    <i />
    {status}
  </span>
);

const PropertyRow = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="me-property-row">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

const EmptyPane = ({ children }: { children: ReactNode }) => (
  <div className="me-empty-pane">
    <span className="me-empty-cross" />
    <p>{children}</p>
  </div>
);

const ActivityList = ({ activities }: { activities: readonly MessageEngineTraceActivity[] }) => {
  if (activities.length === 0) return <EmptyPane>No activities recorded for this call.</EmptyPane>;
  return (
    <div className="me-activity-list">
      {activities.map((activity) => (
        <div
          className="me-activity-row"
          data-kind={activity.kind}
          data-status={activity.status}
          key={activity.id}
          title={activity.detail}
        >
          <span className="me-tree-joint" />
          <i className="me-event-mark" />
          <strong>{activity.label}</strong>
          <span>{activity.detail ?? '—'}</span>
          <time>
            {activity.durationMs === undefined ? '—' : `${formatInteger(activity.durationMs)}ms`}
          </time>
        </div>
      ))}
    </div>
  );
};

interface BlueprintModule {
  id: string;
  segments: SegmentTokenRecord[];
  tokens: number;
}

interface BlueprintSource {
  modules: BlueprintModule[];
  sourceType: TokenSourceType;
  tokens: number;
}

const toBlueprintSources = (snapshot: TurnTokenSnapshot): BlueprintSource[] => {
  const sources = new Map<TokenSourceType, Map<string, SegmentTokenRecord[]>>();
  for (const segment of snapshot.segments) {
    const modules = sources.get(segment.sourceType) ?? new Map<string, SegmentTokenRecord[]>();
    const segments = modules.get(segment.moduleId) ?? [];
    segments.push(segment);
    modules.set(segment.moduleId, segments);
    sources.set(segment.sourceType, modules);
  }
  return [...sources.entries()].map(([sourceType, modules]) => {
    const moduleList = [...modules.entries()].map(([id, segments]) => ({
      id,
      segments,
      tokens: segments.reduce((total, segment) => total + segment.tokens, 0),
    }));
    return {
      modules: moduleList,
      sourceType,
      tokens: moduleList.reduce((total, module) => total + module.tokens, 0),
    };
  });
};

const cacheLabel = (segment: SegmentTokenRecord): string => {
  if (segment.cacheStatus === 'provider-cache-read') return 'read';
  if (segment.cacheStatus === 'provider-cache-write') return 'write';
  if (segment.cacheStatus === 'reused-internally') return 'reused';
  if (segment.cacheScope === 'turn') return 'turn';
  return segment.cacheStatus === 'eligible' ? 'eligible' : 'none';
};

export const MessageEnginePromptBlueprint = ({
  onSelectedSegmentChange,
  selectedSegmentId,
  snapshot,
  sourceColors,
}: {
  onSelectedSegmentChange?: ((segmentId: string) => void) | undefined;
  selectedSegmentId?: string | undefined;
  snapshot?: TurnTokenSnapshot | undefined;
  sourceColors?: Partial<Record<TokenSourceType, string>> | undefined;
}) => {
  const sources = useMemo(() => (snapshot ? toBlueprintSources(snapshot) : []), [snapshot]);
  if (!snapshot || sources.length === 0) {
    return <EmptyPane>Compile a turn to inspect its prompt blueprint.</EmptyPane>;
  }
  return (
    <div className="me-blueprint">
      <div className="me-blueprint-head" aria-hidden="true">
        <span>Source / module / segment</span>
        <span>Tokens</span>
        <span>Cache</span>
        <span>Composition</span>
      </div>
      {sources.map((source) => {
        const sourceColor =
          sourceColors?.[source.sourceType] ?? TELEMETRY_SOURCE_COLORS[source.sourceType];
        const sourceWidth = (source.tokens / Math.max(snapshot.totalTokens, 1)) * 100;
        return (
          <section className="me-blueprint-source" key={source.sourceType}>
            <div className="me-blueprint-source-row">
              <strong>{source.sourceType}</strong>
              <span>{formatTokens(source.tokens)}</span>
              <span>—</span>
              <span className="me-blueprint-meter">
                <i
                  style={cssVariables({
                    '--me-meter-color': sourceColor,
                    '--me-meter-width': `${sourceWidth}%`,
                  })}
                />
              </span>
            </div>
            {source.modules.map((module) => (
              <div className="me-blueprint-module" key={`${source.sourceType}:${module.id}`}>
                <div className="me-blueprint-module-row">
                  <span>{module.id}</span>
                  <span>{formatTokens(module.tokens)}</span>
                  <span />
                  <span />
                </div>
                {module.segments.map((segment) => {
                  const segmentWidth = (segment.tokens / Math.max(snapshot.totalTokens, 1)) * 100;
                  return (
                    <button
                      aria-pressed={selectedSegmentId === segment.segmentId}
                      className="me-blueprint-segment"
                      data-selected={selectedSegmentId === segment.segmentId}
                      key={segment.segmentId}
                      onClick={() => onSelectedSegmentChange?.(segment.segmentId)}
                      type="button"
                    >
                      <span title={segment.segmentId}>{segment.segmentId}</span>
                      <span>{formatTokens(segment.tokens)}</span>
                      <span>{cacheLabel(segment)}</span>
                      <span className="me-blueprint-meter">
                        <i
                          style={cssVariables({
                            '--me-meter-color': sourceColor,
                            '--me-meter-width': `${segmentWidth}%`,
                          })}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
};

/** @deprecated Use MessageEnginePromptBlueprint for the linear inspector. */
export const MessageEngineTokenSunburst = ({
  snapshot,
  sourceColors,
}: {
  snapshot?: TurnTokenSnapshot | undefined;
  sourceColors?: Partial<Record<TokenSourceType, string>> | undefined;
}) => <MessageEnginePromptBlueprint snapshot={snapshot} sourceColors={sourceColors} />;

const segmentTitle = (segment: TelemetryTimelineSegment): string => {
  const cache = segment.cachedTokens > 0 ? ` · ${formatTokens(segment.cachedTokens)} cached` : '';
  return `${segment.sourceType} · ${formatTokens(segment.tokens)}${cache} · ${segment.processorId}`;
};

const TraceSegment = ({
  color,
  onSelect,
  segment,
  selected,
  total,
}: {
  color: string;
  onSelect: () => void;
  segment: TelemetryTimelineSegment;
  selected: boolean;
  total: number;
}) => {
  const width = total <= 0 ? 0 : (segment.tokens / total) * 100;
  const cacheWidth =
    segment.tokens <= 0 ? 0 : Math.min(100, (segment.cachedTokens / segment.tokens) * 100);
  return (
    <button
      aria-label={segmentTitle(segment)}
      aria-pressed={selected}
      className="me-trace-segment"
      data-boundary={segment.boundary}
      data-selected={selected}
      onClick={onSelect}
      style={{
        ...cssVariables({ '--me-cache-width': `${cacheWidth}%`, '--me-segment-color': color }),
        width: `${Math.max(width, 0.5)}%`,
      }}
      title={segmentTitle(segment)}
      type="button"
    >
      {cacheWidth > 0 ? <span className="me-segment-cache" /> : null}
      {segment.injected ? <span className="me-injected-mark">i</span> : null}
    </button>
  );
};

const TraceRuler = ({ maxTokens }: { maxTokens: number }) => (
  <div
    className="me-trace-ruler"
    aria-label={`Context scale up to ${formatInteger(maxTokens)} tokens`}
  >
    <span>Context scale</span>
    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
      <i key={ratio} style={{ left: `${ratio * 100}%` }}>
        {formatTokens(Math.round(maxTokens * ratio))}
      </i>
    ))}
  </div>
);

const TraceTurnRow = ({
  activities,
  colors,
  formatCacheHint,
  maxVisualTokens,
  onSelectSegment,
  onSelectTurn,
  selected,
  selectedSegmentId,
  turn,
}: {
  activities: readonly MessageEngineTraceActivity[];
  colors: Record<TokenSourceType, string>;
  formatCacheHint: (hint: TelemetryCacheHint) => ReactNode;
  maxVisualTokens: number;
  onSelectSegment: (segmentId: string) => void;
  onSelectTurn: () => void;
  selected: boolean;
  selectedSegmentId?: string | undefined;
  turn: TelemetryTimelineTurn;
}) => {
  const barWidth =
    maxVisualTokens <= 0 ? 8 : Math.max(0.8, (turn.visualTokens / maxVisualTokens) * 100);
  const cacheLineWidth =
    turn.visualTokens <= 0 ? 0 : barWidth * (turn.cachedTokens / turn.visualTokens);
  return (
    <article className="me-trace-turn" data-selected={selected}>
      <button className="me-call-cell" onClick={onSelectTurn} type="button">
        <strong>{`Call ${String(turn.index).padStart(2, '0')}`}</strong>
        <span title={turn.turnId}>{turn.turnId}</span>
      </button>
      <div className="me-trace-cell">
        <div className="me-token-grid">
          <div
            aria-label={`Call ${turn.index}: ${formatInteger(turn.visualTokens)} prompt tokens`}
            className="me-token-bar"
            role="group"
            style={cssVariables({ '--me-bar-width': `${barWidth}%` })}
          >
            {turn.segments.map((segment, index) => (
              <TraceSegment
                color={colors[segment.sourceType]}
                key={`${segment.id}:${index}`}
                onSelect={() => onSelectSegment(segment.id)}
                segment={segment}
                selected={selected && selectedSegmentId === segment.id}
                total={turn.visualTokens}
              />
            ))}
          </div>
          <span
            className="me-cache-range"
            style={cssVariables({ '--me-cache-line-width': `${cacheLineWidth}%` })}
            title={`${formatTokens(turn.cachedTokens)} cached prefix tokens`}
          />
        </div>
        {activities.length > 0 ? <ActivityList activities={activities} /> : null}
        {turn.hint ? <div className="me-inline-warning">{formatCacheHint(turn.hint)}</div> : null}
      </div>
      <button className="me-call-metric" onClick={onSelectTurn} type="button">
        <span>{formatTokens(turn.promptTokens)}</span>
        <small>{`cache ${formatPercent(turn.cacheHitPercent)}`}</small>
      </button>
      <button className="me-call-metric" onClick={onSelectTurn} type="button">
        <span>{turn.outputTokens === undefined ? '—' : formatTokens(turn.outputTokens)}</span>
        <small>output</small>
      </button>
    </article>
  );
};

const TraceWorkspace = ({
  activitiesByTurn,
  colors,
  formatCacheHint,
  onSelectSegment,
  onSelectTurn,
  selectedSegmentId,
  selectedTurnId,
  timeline,
}: {
  activitiesByTurn: ReadonlyMap<string, MessageEngineTraceActivity[]>;
  colors: Record<TokenSourceType, string>;
  formatCacheHint: (hint: TelemetryCacheHint) => ReactNode;
  onSelectSegment: (turnId: string, segmentId: string) => void;
  onSelectTurn: (turnId: string) => void;
  selectedSegmentId?: string | undefined;
  selectedTurnId?: string | undefined;
  timeline: TelemetryTimeline;
}) => {
  if (timeline.turns.length === 0)
    return <EmptyPane>Compile a turn to inspect its context trace.</EmptyPane>;
  return (
    <div className="me-trace-table">
      <div className="me-trace-head">
        <span>Call</span>
        <TraceRuler maxTokens={timeline.maxVisualTokens} />
        <span>Input</span>
        <span>Output</span>
      </div>
      {timeline.turns.map((turn) => (
        <TraceTurnRow
          activities={activitiesByTurn.get(turn.turnId) ?? []}
          colors={colors}
          formatCacheHint={formatCacheHint}
          key={turn.turnId}
          maxVisualTokens={timeline.maxVisualTokens}
          onSelectSegment={(segmentId) => onSelectSegment(turn.turnId, segmentId)}
          onSelectTurn={() => onSelectTurn(turn.turnId)}
          selected={turn.turnId === selectedTurnId}
          selectedSegmentId={selectedSegmentId}
          turn={turn}
        />
      ))}
      <div aria-hidden="true" className="me-trace-floor" />
    </div>
  );
};

const InspectorTabs = ({
  labels,
  onChange,
  value,
}: {
  labels: MessageEngineDevtoolsLabels;
  onChange: (view: MessageEngineDevtoolsInspectorView) => void;
  value: MessageEngineDevtoolsInspectorView;
}) => (
  <div className="me-inspector-tabs" role="tablist">
    {INSPECTOR_VIEWS.map((view) => (
      <button
        aria-selected={view === value}
        key={view}
        onClick={() => onChange(view)}
        role="tab"
        type="button"
      >
        {labels[view]}
      </button>
    ))}
  </div>
);

const OverviewInspector = ({
  run,
  selectedTurn,
  timelineTurn,
}: {
  run: MessageEngineTraceRun;
  selectedTurn?: TurnTokenSnapshot | undefined;
  timelineTurn?: TelemetryTimelineTurn | undefined;
}) => {
  const model = [run.provider, run.model].filter(Boolean).join('/') || '—';
  const reasoningLabel =
    timelineTurn?.reasoningTokens === undefined ? '—' : formatTokens(timelineTurn.reasoningTokens);
  return (
    <div className="me-inspector-pane">
      <section className="me-inspector-section">
        <h3>Run</h3>
        <dl className="me-property-grid">
          <PropertyRow label="Status" value={<StatusMark status={run.status} />} />
          <PropertyRow label="Model" value={model} />
          <PropertyRow label="Calls" value={formatInteger(run.summary.turns.length)} />
          <PropertyRow label="Input" value={formatTokens(run.summary.totalInputTokens)} />
          <PropertyRow label="Cache read" value={formatTokens(run.summary.totalCacheReadTokens)} />
          <PropertyRow label="Output" value={formatTokens(run.summary.totalOutputTokens)} />
          <PropertyRow label="Estimated cost" value={`$${run.summary.totalCost.toFixed(6)}`} />
        </dl>
      </section>
      <section className="me-inspector-section">
        <h3>Selected call</h3>
        {selectedTurn && timelineTurn ? (
          <dl className="me-property-grid">
            <PropertyRow label="Turn" value={selectedTurn.turnId} />
            <PropertyRow label="Prompt" value={formatTokens(timelineTurn.promptTokens)} />
            <PropertyRow label="Cache hit" value={formatPercent(timelineTurn.cacheHitPercent)} />
            <PropertyRow label="Reprocessed" value={formatTokens(timelineTurn.reprocessedTokens)} />
            <PropertyRow label="Reasoning" value={reasoningLabel} />
          </dl>
        ) : (
          <EmptyPane>Select a call to inspect it.</EmptyPane>
        )}
      </section>
    </div>
  );
};

const PromptInspector = ({
  colors,
  onSelectedSegmentChange,
  selectedSegment,
  selectedSegmentId,
  selectedTurn,
}: {
  colors: Record<TokenSourceType, string>;
  onSelectedSegmentChange: (segmentId: string) => void;
  selectedSegment?: SegmentTokenRecord | undefined;
  selectedSegmentId?: string | undefined;
  selectedTurn?: TurnTokenSnapshot | undefined;
}) => {
  const contentLabel = selectedSegment?.content ?? 'not captured';
  const detail = selectedSegment ? (
    <section className="me-inspector-section me-segment-detail">
      <h3>Segment detail</h3>
      <dl className="me-property-grid">
        <PropertyRow label="Source" value={selectedSegment.sourceType} />
        <PropertyRow label="Module" value={selectedSegment.moduleId} />
        <PropertyRow label="Processor" value={selectedSegment.processorId} />
        <PropertyRow label="Framing" value={selectedSegment.framingType} />
        <PropertyRow label="Cache" value={selectedSegment.cacheStatus} />
        <PropertyRow label="Scope" value={selectedSegment.cacheScope} />
        <PropertyRow label="Tokens" value={formatInteger(selectedSegment.tokens)} />
        <PropertyRow label="Content" value={contentLabel} />
      </dl>
    </section>
  ) : null;
  return (
    <div className="me-inspector-pane">
      <MessageEnginePromptBlueprint
        onSelectedSegmentChange={onSelectedSegmentChange}
        selectedSegmentId={selectedSegmentId}
        snapshot={selectedTurn}
        sourceColors={colors}
      />
      {detail}
    </div>
  );
};

const CacheInspector = ({
  formatCacheHint,
  timelineTurn,
}: {
  formatCacheHint: (hint: TelemetryCacheHint) => ReactNode;
  timelineTurn?: TelemetryTimelineTurn | undefined;
}) => {
  if (!timelineTurn) return <EmptyPane>Select a call to inspect provider cache.</EmptyPane>;
  return (
    <div className="me-inspector-pane">
      <section className="me-inspector-section">
        <h3>Provider cache</h3>
        <dl className="me-property-grid">
          <PropertyRow label="Prompt" value={formatTokens(timelineTurn.promptTokens)} />
          <PropertyRow label="Cache read" value={formatTokens(timelineTurn.cacheReadTokens)} />
          <PropertyRow label="Cache write" value={formatTokens(timelineTurn.cacheWriteTokens)} />
          <PropertyRow label="Hit rate" value={formatPercent(timelineTurn.cacheHitPercent)} />
          <PropertyRow label="Covered" value={formatTokens(timelineTurn.cachedTokens)} />
          <PropertyRow label="Reprocessed" value={formatTokens(timelineTurn.reprocessedTokens)} />
        </dl>
      </section>
      {timelineTurn.hint ? (
        <section className="me-cache-diagnostic">
          <span>DIAGNOSTIC</span>
          <p>{formatCacheHint(timelineTurn.hint)}</p>
        </section>
      ) : null}
    </div>
  );
};

const ActivitiesInspector = ({
  activities,
  run,
}: {
  activities: readonly MessageEngineTraceActivity[];
  run: MessageEngineTraceRun;
}) => (
  <div className="me-inspector-pane">
    <section className="me-inspector-section">
      <h3>Call activities</h3>
      <ActivityList activities={activities} />
    </section>
    {run.prefixMutations.length > 0 ? (
      <section className="me-inspector-section">
        <h3>Prefix mutations</h3>
        <div className="me-mutation-list">
          {run.prefixMutations.map((event, index) => (
            <div key={`${event.nextGeneration}:${index}`}>
              <span>{event.action}</span>
              <strong>{event.reason}</strong>
              <small>{`message ${event.firstChangedIndex} · generation ${event.previousGeneration} → ${event.nextGeneration}`}</small>
            </div>
          ))}
        </div>
      </section>
    ) : null}
  </div>
);

const RawInspector = ({
  activities,
  selectedTurn,
}: {
  activities: readonly MessageEngineTraceActivity[];
  selectedTurn?: TurnTokenSnapshot | undefined;
}) => (
  <div className="me-inspector-pane me-raw-pane">
    <pre>{JSON.stringify({ activities, turn: selectedTurn ?? null }, null, 2)}</pre>
  </div>
);

const Inspector = ({
  activities,
  colors,
  formatCacheHint,
  labels,
  onSelectedSegmentChange,
  onViewChange,
  run,
  selectedSegment,
  selectedSegmentId,
  selectedTurn,
  timelineTurn,
  view,
}: {
  activities: readonly MessageEngineTraceActivity[];
  colors: Record<TokenSourceType, string>;
  formatCacheHint: (hint: TelemetryCacheHint) => ReactNode;
  labels: MessageEngineDevtoolsLabels;
  onSelectedSegmentChange: (segmentId: string) => void;
  onViewChange: (view: MessageEngineDevtoolsInspectorView) => void;
  run: MessageEngineTraceRun;
  selectedSegment?: SegmentTokenRecord | undefined;
  selectedSegmentId?: string | undefined;
  selectedTurn?: TurnTokenSnapshot | undefined;
  timelineTurn?: TelemetryTimelineTurn | undefined;
  view: MessageEngineDevtoolsInspectorView;
}) => {
  let content: ReactNode;
  if (view === 'prompt')
    content = (
      <PromptInspector
        colors={colors}
        onSelectedSegmentChange={onSelectedSegmentChange}
        selectedSegment={selectedSegment}
        selectedSegmentId={selectedSegmentId}
        selectedTurn={selectedTurn}
      />
    );
  else if (view === 'cache')
    content = <CacheInspector formatCacheHint={formatCacheHint} timelineTurn={timelineTurn} />;
  else if (view === 'activities')
    content = <ActivitiesInspector activities={activities} run={run} />;
  else if (view === 'raw')
    content = <RawInspector activities={activities} selectedTurn={selectedTurn} />;
  else
    content = (
      <OverviewInspector run={run} selectedTurn={selectedTurn} timelineTurn={timelineTurn} />
    );
  return (
    <aside className="me-inspector">
      <InspectorTabs labels={labels} onChange={onViewChange} value={view} />
      {content}
    </aside>
  );
};

const RunHeader = ({ run }: { run: MessageEngineTraceRun }) => {
  const modelLabel = [run.provider, run.model].filter(Boolean).join('/') || run.sessionId;
  return (
    <header className="me-run-header">
      <div>
        <span>TRACE / ACTIVE RUN</span>
        <h2>{run.title ?? run.sessionId}</h2>
        <p>{run.subtitle || modelLabel}</p>
      </div>
      <StatusMark status={run.status} />
    </header>
  );
};

const RunMetrics = ({
  labels,
  run,
}: {
  labels: MessageEngineDevtoolsLabels;
  run: MessageEngineTraceRun;
}) => (
  <div className="me-run-metrics">
    <div>
      <span>{labels.calls}</span>
      <strong>{formatInteger(run.summary.turns.length)}</strong>
    </div>
    <div>
      <span>{labels.input}</span>
      <strong>
        {formatTokens(run.summary.totalInputTokens + run.summary.totalCacheReadTokens)}
      </strong>
    </div>
    <div>
      <span>{labels.cache}</span>
      <strong>{formatPercent(run.summary.averageProviderCacheHitRate)}</strong>
    </div>
    <div>
      <span>{labels.output}</span>
      <strong>{formatTokens(run.summary.totalOutputTokens)}</strong>
    </div>
  </div>
);

const TraceWorkbench = ({
  cachePolicy,
  defaultView,
  formatCacheHint,
  labels,
  run,
  sourceColors,
}: {
  cachePolicy?: TelemetryCachePolicy | undefined;
  defaultView?: MessageEngineDevtoolsView | undefined;
  formatCacheHint: (hint: TelemetryCacheHint) => ReactNode;
  labels: MessageEngineDevtoolsLabels;
  run: MessageEngineTraceRun;
  sourceColors?: Partial<Record<TokenSourceType, string>> | undefined;
}) => {
  const [requestedTurnId, setRequestedTurnId] = useState<string>();
  const [requestedSegmentId, setRequestedSegmentId] = useState<string>();
  const [view, setView] = useState<MessageEngineDevtoolsInspectorView>(() =>
    getInspectorView(defaultView),
  );
  const colors = { ...TELEMETRY_SOURCE_COLORS, ...sourceColors };
  const timeline = useMemo(
    () => toTelemetryTimeline(run.summary.turns, cachePolicy ? { cachePolicy } : undefined),
    [cachePolicy, run.summary.turns],
  );
  const selectedTurn =
    run.summary.turns.find((turn) => turn.turnId === requestedTurnId) ?? run.summary.turns.at(-1);
  const selectedTimelineTurn = timeline.turns.find((turn) => turn.turnId === selectedTurn?.turnId);
  const selectedSegment =
    selectedTurn?.segments.find((segment) => segment.segmentId === requestedSegmentId) ??
    selectedTurn?.segments[0];
  const activities = useMemo(() => {
    const byTurn = new Map<string, MessageEngineTraceActivity[]>();
    const unassigned: MessageEngineTraceActivity[] = [];
    for (const activity of run.activities) {
      if (!activity.turnId) {
        unassigned.push(activity);
        continue;
      }
      const current = byTurn.get(activity.turnId) ?? [];
      current.push(activity);
      byTurn.set(activity.turnId, current);
    }
    return { byTurn, unassigned };
  }, [run.activities]);
  const selectedActivities = selectedTurn
    ? (activities.byTurn.get(selectedTurn.turnId) ?? [])
    : activities.unassigned;
  const selectTurn = (turnId: string): void => {
    setRequestedTurnId(turnId);
    setRequestedSegmentId(undefined);
  };
  const selectSegment = (turnId: string, segmentId: string): void => {
    setRequestedTurnId(turnId);
    setRequestedSegmentId(segmentId);
    setView('prompt');
  };
  const mutationLabel = `${run.prefixMutations.length} mutation${
    run.prefixMutations.length === 1 ? '' : 's'
  } recorded`;
  return (
    <>
      <main className="me-trace-workspace">
        <RunHeader run={run} />
        <RunMetrics labels={labels} run={run} />
        {run.prefixMutations.length > 0 ? (
          <button className="me-prefix-alert" onClick={() => setView('activities')} type="button">
            <span>PREFIX VIOLATION</span>
            <strong>{mutationLabel}</strong>
            <i>Inspect →</i>
          </button>
        ) : null}
        <TraceWorkspace
          activitiesByTurn={activities.byTurn}
          colors={colors}
          formatCacheHint={formatCacheHint}
          onSelectSegment={selectSegment}
          onSelectTurn={selectTurn}
          selectedSegmentId={selectedSegment?.segmentId}
          selectedTurnId={selectedTurn?.turnId}
          timeline={timeline}
        />
      </main>
      <Inspector
        activities={selectedActivities}
        colors={colors}
        formatCacheHint={formatCacheHint}
        labels={labels}
        onSelectedSegmentChange={setRequestedSegmentId}
        onViewChange={setView}
        run={run}
        selectedSegment={selectedSegment}
        selectedSegmentId={selectedSegment?.segmentId}
        selectedTurn={selectedTurn}
        timelineTurn={selectedTimelineTurn}
        view={view}
      />
    </>
  );
};

const RunRail = ({
  onSelect,
  runs,
  selectedRunId,
}: {
  onSelect: (sessionId: string) => void;
  runs: readonly MessageEngineTraceRun[];
  selectedRunId?: string | undefined;
}) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const next = runs[index + direction];
    if (!next) return;
    onSelect(next.sessionId);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('.me-run-item')
      [index + direction]?.focus();
  };
  return (
    <nav aria-label="Trace runs" className="me-run-rail">
      <div className="me-rail-head">
        <span>Runs</span>
        <strong>{formatInteger(runs.length)}</strong>
      </div>
      <div className="me-run-list">
        {runs.map((run, index) => (
          <button
            aria-current={run.sessionId === selectedRunId}
            className="me-run-item"
            data-selected={run.sessionId === selectedRunId}
            key={run.sessionId}
            onClick={() => onSelect(run.sessionId)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            type="button"
          >
            <span className="me-run-time">{formatTime(run.startedAt)}</span>
            <span className="me-run-state" data-status={run.status} />
            <span className="me-run-copy">
              <strong>{run.title ?? run.sessionId}</strong>
              <small>{[run.provider, run.model].filter(Boolean).join('/') || run.sessionId}</small>
            </span>
            <span className="me-run-duration">{formatDuration(run)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};

export const MessageEngineTraceViewer = ({
  cachePolicy,
  className,
  defaultView,
  formatCacheHint = defaultFormatCacheHint,
  labels: labelOverrides,
  run,
  sourceColors,
  styleNonce,
  theme = 'system',
}: MessageEngineTraceViewerProps) => {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  return (
    <section
      className={joinClassNames('me-devtools me-trace-viewer', className)}
      data-me-devtools=""
      data-theme={theme}
    >
      <MessageEngineDevtoolsStyles nonce={styleNonce} />
      <div className="me-viewer-grid">
        <TraceWorkbench
          cachePolicy={cachePolicy}
          defaultView={defaultView}
          formatCacheHint={formatCacheHint}
          labels={labels}
          run={run}
          sourceColors={sourceColors}
        />
      </div>
    </section>
  );
};

const downloadMessageEngineTraceRun = (run: MessageEngineTraceRun): void => {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const content = `${JSON.stringify({ exportedAt: new Date().toISOString(), run, version: 1 }, null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `message-engine-trace-${run.sessionId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const MessageEngineDevtools = ({
  cachePolicy,
  className,
  defaultView,
  formatCacheHint = defaultFormatCacheHint,
  labels: labelOverrides,
  onExport,
  onSelectedRunChange,
  selectedRunId,
  source,
  sourceColors,
  styleNonce,
  theme = 'system',
}: MessageEngineDevtoolsProps) => {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const [requestedRunId, setRequestedRunId] = useState<string>();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const candidateId = selectedRunId ?? requestedRunId;
  const selectedRun =
    snapshot.runs.find((run) => run.sessionId === candidateId) ?? snapshot.runs.at(-1);
  const visibleRuns = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const reversed = [...snapshot.runs].reverse();
    if (!normalized) return reversed;
    return reversed.filter((run) =>
      [run.title, run.subtitle, run.provider, run.model, run.sessionId]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalized)),
    );
  }, [query, snapshot.runs]);
  const selectRun = (sessionId: string): void => {
    setRequestedRunId(sessionId);
    onSelectedRunChange?.(sessionId);
  };
  const exportRun = (): void => {
    if (!selectedRun) return;
    if (onExport) onExport(selectedRun);
    else downloadMessageEngineTraceRun(selectedRun);
  };
  const handleWorkbenchKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    searchRef.current?.focus();
  };
  return (
    <div
      className={joinClassNames('me-devtools', className)}
      data-me-devtools=""
      data-theme={theme}
      onKeyDown={handleWorkbenchKeyDown}
    >
      <MessageEngineDevtoolsStyles nonce={styleNonce} />
      <header className="me-command-bar">
        <div className="me-product-mark" aria-label={labels.title}>
          <i />
          <strong>{labels.title}</strong>
          <span>/</span>
          <small>{labels.timeline}</small>
        </div>
        <label className="me-run-search">
          <span>⌕</span>
          <input
            aria-label={labels.searchRuns}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={labels.searchRuns}
            ref={searchRef}
            type="search"
            value={query}
          />
          <kbd>⌘K</kbd>
        </label>
        <div className="me-command-actions">
          {selectedRun ? <StatusMark status={selectedRun.status} /> : null}
          <button disabled={!selectedRun} onClick={exportRun} type="button">
            {labels.export}
          </button>
        </div>
      </header>
      <div className="me-mobile-run-picker">
        <label htmlFor="me-run-select">{labels.runs}</label>
        <select
          aria-label={labels.selectRun}
          disabled={snapshot.runs.length === 0}
          id="me-run-select"
          onChange={(event) => selectRun(event.currentTarget.value)}
          value={selectedRun?.sessionId ?? ''}
        >
          {snapshot.runs.length === 0 ? <option value="">{labels.selectRun}</option> : null}
          {visibleRuns.map((run) => (
            <option key={run.sessionId} value={run.sessionId}>
              {run.title ?? run.sessionId}
            </option>
          ))}
        </select>
      </div>
      {selectedRun ? (
        <div className="me-workbench">
          <RunRail onSelect={selectRun} runs={visibleRuns} selectedRunId={selectedRun.sessionId} />
          <TraceWorkbench
            cachePolicy={cachePolicy}
            defaultView={defaultView}
            formatCacheHint={formatCacheHint}
            labels={labels}
            run={selectedRun}
            sourceColors={sourceColors}
          />
        </div>
      ) : (
        <div className="me-devtools-empty">
          <EmptyPane>
            <strong>{labels.emptyTitle}</strong>
            <span>{labels.emptyDescription}</span>
          </EmptyPane>
        </div>
      )}
      <footer className="me-status-bar">
        <span>{selectedRun?.sessionId ?? 'NO SESSION'}</span>
        <span>{selectedRun ? `${selectedRun.summary.turns.length} calls` : '0 calls'}</span>
        <span>
          {selectedRun
            ? `${formatPercent(selectedRun.summary.averageProviderCacheHitRate)} cache`
            : '—'}
        </span>
        <span>
          {selectedRun ? `${selectedRun.summary.prefixViolations} violations` : '0 violations'}
        </span>
        <span className="me-connection-state">source ready</span>
      </footer>
    </div>
  );
};
