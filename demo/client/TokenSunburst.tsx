import { useMemo, useState, type KeyboardEvent } from 'react';

import {
  telemetryArcPath,
  toTelemetrySunburst,
  type TelemetrySunburstArc,
} from '../../src/devtools.js';
import type { TokenSourceType, TurnTokenSnapshot } from '../../src/index.js';

const formatInteger = (value: number): string =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

const formatCost = (value: number): string => `$${value.toFixed(6)}`;

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const EmptySunburst = () => (
  <div className="sunburst-empty">
    <svg aria-hidden="true" viewBox="0 0 360 360">
      <circle cx="180" cy="180" r="62" />
      <circle cx="180" cy="180" r="103" />
      <circle cx="180" cy="180" r="138" />
      <circle cx="180" cy="180" r="174" />
    </svg>
    <div className="sunburst-center">
      <span>AWAITING</span>
      <strong>—</strong>
      <small>compile a turn</small>
    </div>
  </div>
);

export const TokenSunburst = ({
  expanded = false,
  snapshot,
}: {
  expanded?: boolean;
  snapshot: TurnTokenSnapshot | undefined;
}) => {
  const [focusedSource, setFocusedSource] = useState<TokenSourceType>();
  const [hoveredArcId, setHoveredArcId] = useState<string>();
  const availableSources = snapshot?.segments.map((segment) => segment.sourceType) ?? [];
  const activeSource =
    focusedSource && availableSources.includes(focusedSource) ? focusedSource : undefined;
  const model = useMemo(
    () => (snapshot ? toTelemetrySunburst(snapshot, activeSource) : undefined),
    [activeSource, snapshot],
  );
  const hoveredArc = model?.arcs.find((arc) => arc.id === hoveredArcId);
  const activeDatum = hoveredArc;
  const centerLabel = activeDatum?.label ?? activeSource ?? 'LATEST TURN';
  const centerTokens = activeDatum?.tokens ?? model?.visibleTokens ?? 0;
  const centerCost = activeDatum?.cost ?? model?.visibleCost ?? 0;
  const centerPercentage = activeDatum
    ? activeDatum.tokens / Math.max(model?.visibleTokens ?? 0, 1)
    : 1;

  const toggleSource = (sourceType: TokenSourceType): void => {
    setFocusedSource((current) => (current === sourceType ? undefined : sourceType));
    setHoveredArcId(undefined);
  };

  const handleArcKeyDown = (
    event: KeyboardEvent<SVGPathElement>,
    arc: TelemetrySunburstArc,
  ): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleSource(arc.sourceType);
  };

  if (!snapshot || !model?.arcs.length) return <EmptySunburst />;

  return (
    <div className={`token-sunburst ${expanded ? 'token-sunburst-expanded' : ''}`}>
      <div className="sunburst-plot">
        <svg
          aria-label={`Token hierarchy for ${formatInteger(model.totalTokens)} tokens`}
          role="img"
          viewBox="0 0 360 360"
        >
          <circle className="sunburst-guide" cx="180" cy="180" r="62" />
          {model.arcs.map((arc) => (
            <path
              aria-label={`${arc.label}: ${formatInteger(arc.tokens)} tokens`}
              className={`sunburst-arc sunburst-depth-${arc.depth} ${hoveredArcId === arc.id ? 'sunburst-arc-active' : ''}`}
              d={telemetryArcPath(arc)}
              fill={arc.color}
              key={arc.id}
              onBlur={() => setHoveredArcId(undefined)}
              onClick={() => toggleSource(arc.sourceType)}
              onFocus={() => setHoveredArcId(arc.id)}
              onKeyDown={(event) => handleArcKeyDown(event, arc)}
              onMouseEnter={() => setHoveredArcId(arc.id)}
              onMouseLeave={() => setHoveredArcId(undefined)}
              role="button"
              tabIndex={0}
            >
              <title>
                {arc.label} · {formatInteger(arc.tokens)} tokens ·{' '}
                {formatPercent(arc.tokens / Math.max(model.visibleTokens, 1))}
              </title>
            </path>
          ))}
        </svg>
        <div className="sunburst-center" aria-live="polite">
          <span>{centerLabel}</span>
          <strong>{formatInteger(centerTokens)}</strong>
          <small>
            {formatCost(centerCost)} · {formatPercent(centerPercentage)}
          </small>
          {activeSource ? <em>click sector to reset</em> : <em>tokens</em>}
        </div>
      </div>

      <div className="sunburst-legend">
        <div className="sunburst-legend-caption">
          <span>Source</span>
          <span>Share</span>
        </div>
        {model.sources.map((source) => (
          <button
            className={activeSource === source.sourceType ? 'sunburst-source-active' : ''}
            key={source.sourceType}
            onClick={() => toggleSource(source.sourceType)}
            type="button"
          >
            <span className="sunburst-source-main">
              <i style={{ background: source.color }} />
              <strong>{source.sourceType}</strong>
              <small>
                {source.segmentCount} {source.segmentCount === 1 ? 'segment' : 'segments'}
              </small>
            </span>
            <span className="sunburst-source-value">
              <strong>{formatInteger(source.tokens)}</strong>
              <small>{formatPercent(source.percentage)}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
