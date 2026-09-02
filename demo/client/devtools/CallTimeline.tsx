import { AlertTriangle, ArrowRight, Wrench } from 'lucide-react';

import type { MessageEngineTraceActivity } from '../../../src/devtools-recorder.js';
import type { SegmentTokenRecord, TurnTokenSnapshot } from '../../../src/token-types.js';
import type { PrefixMutationEvent } from '../../../src/types.js';
import { formatInteger, formatPercent } from '../formatters.js';
import type { CallTimelineProps } from './types.js';

const getSourceColor = (type: SegmentTokenRecord['sourceType']) => {
  if (type === 'system') return '#8b5cf6';
  if (type === 'skill') return '#f43f5e';
  if (type === 'user') return '#38bdf8';
  if (type.startsWith('tool')) return '#f59e0b';
  return '#10b981';
};

const ActivityItem = ({ act }: { act: MessageEngineTraceActivity }) => (
  <div className="dt-activity-row" key={act.id}>
    <Wrench size={10} className="text-amber" />
    <span className="dt-act-label">{act.label}</span>
    <span className="dt-act-detail">{act.detail}</span>
    {act.durationMs ? <span className="dt-act-time">{act.durationMs}ms</span> : null}
  </div>
);

const CallCard = ({
  activities,
  index,
  isSelected,
  onSelect,
  turn,
}: {
  activities: MessageEngineTraceActivity[];
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  turn: TurnTokenSnapshot;
}) => {
  const cachedTokens = turn.cache.cacheReadTokens ?? 0;
  const uncachedTokens = turn.cache.uncachedInputTokens ?? 0;
  const totalTurnTokens = cachedTokens + uncachedTokens;
  const segments = turn.segments;

  return (
    <div
      className={`dt-call-card ${isSelected ? 'is-selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
    >
      <div className="dt-call-card-top">
        <div className="dt-call-idx-group">
          <span className="dt-call-badge">Call 0{index + 1}</span>
          <span className="dt-call-turn-id">{turn.turnId ?? `turn-${index + 1}`}</span>
        </div>

        <div className="dt-call-tokens-pills">
          <span className="dt-token-pill">
            <strong>{formatInteger(totalTurnTokens)}</strong> input
          </span>
          <span className="dt-token-pill">
            <strong>{formatInteger(turn.usage?.outputTokens ?? 0)}</strong> output
          </span>
          <span className="dt-token-pill pill-cache text-emerald">
            {formatPercent(turn.cache.internalPrefixReuseRatio)} cached
          </span>
        </div>
      </div>

      <div className="dt-segment-anatomy-track">
        {segments.map((seg: SegmentTokenRecord) => {
          const widthPercent = (seg.tokens / Math.max(totalTurnTokens, 1)) * 100;
          const color = getSourceColor(seg.sourceType);

          return (
            <div
              className="dt-segment-slice"
              key={seg.segmentId}
              style={{
                backgroundColor: color,
                width: `${Math.max(widthPercent, 2)}%`,
              }}
              title={`${seg.sourceType} (${seg.processorId}): ${formatInteger(seg.tokens)} tokens (${widthPercent.toFixed(1)}%)`}
            >
              {widthPercent > 14 ? (
                <span className="dt-slice-label">
                  {seg.sourceType}: {formatInteger(seg.tokens)}t
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="dt-call-segments-legend">
        {segments.map((seg: SegmentTokenRecord) => (
          <div className="dt-legend-chip" key={seg.segmentId}>
            <span
              className="dt-chip-dot"
              style={{ backgroundColor: getSourceColor(seg.sourceType) }}
            />
            <span className="dt-chip-name">{seg.sourceType}</span>
            <span className="dt-chip-val">{formatInteger(seg.tokens)}t</span>
          </div>
        ))}
      </div>

      {activities.length > 0 ? (
        <div className="dt-call-activities">
          {activities.map((act) => (
            <ActivityItem act={act} key={act.id} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const CallTimeline = ({ onSelectTurn, run, selectedTurnIndex }: CallTimelineProps) => {
  const turns = run.summary.turns;
  const isError = run.status === 'error';
  const prefixMutations = run.prefixMutations;

  const totalInputTokens = run.summary.totalInputTokens;
  const totalOutputTokens = run.summary.totalOutputTokens;
  const averageHitRate = run.summary.averageProviderCacheHitRate;

  return (
    <div className="dt-timeline-canvas">
      <header className="dt-run-hero-bar">
        <div className="dt-hero-title-group">
          <div className="dt-hero-tag-row">
            <span className="dt-hero-label">TRACE RUN</span>
            <span className={`dt-status-pill ${isError ? 'pill-error' : 'pill-success'}`}>
              {isError ? 'Blocked Mutation' : 'Completed'}
            </span>
          </div>
          <h1 className="dt-hero-title">{run.title ?? run.sessionId}</h1>
          <p className="dt-hero-subtitle">
            Model: <strong>{run.model ?? 'default'}</strong> · Session ID:{' '}
            <code>{run.sessionId}</code>
          </p>
        </div>
      </header>

      <div className="dt-run-kpi-grid">
        <div className="dt-kpi-tile">
          <span className="dt-kpi-label">Execution Calls</span>
          <strong className="dt-kpi-number">{turns.length}</strong>
        </div>

        <div className="dt-kpi-tile">
          <span className="dt-kpi-label">Input Processed</span>
          <strong className="dt-kpi-number">
            {formatInteger(totalInputTokens)} <small>tokens</small>
          </strong>
        </div>

        <div className="dt-kpi-tile">
          <span className="dt-kpi-label">Cache Hit Rate</span>
          <strong className="dt-kpi-number text-emerald">{formatPercent(averageHitRate)}</strong>
        </div>

        <div className="dt-kpi-tile">
          <span className="dt-kpi-label">Output Tokens</span>
          <strong className="dt-kpi-number">{formatInteger(totalOutputTokens)}</strong>
        </div>
      </div>

      {prefixMutations.map((mutation: PrefixMutationEvent, idx: number) => (
        <div className={`dt-violation-banner banner-${mutation.action}`} key={idx}>
          <div className="dt-violation-top">
            <AlertTriangle size={13} />
            <span className="dt-violation-action">
              PREFIX MUTATION {mutation.action.toUpperCase()}
            </span>
          </div>
          <p className="dt-violation-reason">{mutation.reason}</p>
          <div className="dt-violation-meta">
            <span>First changed index: {mutation.firstChangedIndex}</span>
            <span className="dt-shift-badge">
              g{mutation.previousGeneration} <ArrowRight size={10} /> g{mutation.nextGeneration}
            </span>
          </div>
        </div>
      ))}

      <div className="dt-calls-stack">
        <div className="dt-calls-header-row">
          <span className="dt-calls-header-title">EXECUTION CALL TIMELINE</span>
          <span className="dt-calls-header-count">{turns.length} calls</span>
        </div>

        {turns.map((turn: TurnTokenSnapshot, index: number) => (
          <CallCard
            activities={run.activities.filter(
              (act: MessageEngineTraceActivity) => act.turnId === turn.turnId,
            )}
            index={index}
            isSelected={index === selectedTurnIndex}
            key={turn.turnId ?? index}
            onSelect={() => onSelectTurn(index)}
            turn={turn}
          />
        ))}
      </div>
    </div>
  );
};
