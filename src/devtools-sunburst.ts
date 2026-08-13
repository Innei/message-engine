import type { SegmentTokenRecord, TokenSourceType, TurnTokenSnapshot } from './token-types.js';

export const TELEMETRY_SOURCE_COLORS: Record<TokenSourceType, string> = {
  assistant: '#9a7df0',
  document: '#d99b39',
  'history-summary': '#5e9ce6',
  knowledge: '#56b9a5',
  memory: '#c77dd4',
  'message-overhead': '#727b70',
  'runtime-state': '#dd7834',
  skill: '#d45e87',
  system: '#b188ef',
  'tool-call': '#f0b82f',
  'tool-result': '#8fcf2e',
  'tool-schema': '#37bdb4',
  unattributed: '#778078',
  user: '#5c9de7',
};

export interface TelemetrySunburstArc {
  color: string;
  cost: number;
  depth: 1 | 2 | 3;
  endAngle: number;
  id: string;
  innerRadius: number;
  label: string;
  outerRadius: number;
  percentage: number;
  sourceType: TokenSourceType;
  startAngle: number;
  tokens: number;
}

export interface TelemetrySunburstSource {
  color: string;
  cost: number;
  percentage: number;
  segmentCount: number;
  sourceType: TokenSourceType;
  tokens: number;
}

export interface TelemetrySunburstModel {
  arcs: TelemetrySunburstArc[];
  focusedSource?: TokenSourceType;
  sources: TelemetrySunburstSource[];
  totalCost: number;
  totalTokens: number;
  visibleCost: number;
  visibleTokens: number;
}

interface SegmentGroup {
  cost: number;
  label: string;
  segments: SegmentTokenRecord[];
  tokens: number;
}

interface SourceGroup extends SegmentGroup {
  modules: SegmentGroup[];
  sourceType: TokenSourceType;
}

const sumTokens = (segments: readonly SegmentTokenRecord[]): number =>
  segments.reduce((total, segment) => total + segment.tokens, 0);

const sumCost = (segments: readonly SegmentTokenRecord[]): number =>
  segments.reduce((total, segment) => total + (segment.estimatedCost ?? 0), 0);

const groupByModule = (segments: SegmentTokenRecord[]): SegmentGroup[] => {
  const grouped = new Map<string, SegmentTokenRecord[]>();
  for (const segment of segments) {
    const current = grouped.get(segment.moduleId) ?? [];
    current.push(segment);
    grouped.set(segment.moduleId, current);
  }

  return [...grouped.entries()]
    .map(([label, moduleSegments]) => ({
      cost: sumCost(moduleSegments),
      label,
      segments: moduleSegments,
      tokens: sumTokens(moduleSegments),
    }))
    .sort((left, right) => right.tokens - left.tokens);
};

const groupBySource = (segments: readonly SegmentTokenRecord[]): SourceGroup[] => {
  const grouped = new Map<TokenSourceType, SegmentTokenRecord[]>();
  for (const segment of segments) {
    if (segment.tokens <= 0) continue;
    const current = grouped.get(segment.sourceType) ?? [];
    current.push(segment);
    grouped.set(segment.sourceType, current);
  }

  return [...grouped.entries()]
    .map(([sourceType, sourceSegments]) => ({
      cost: sumCost(sourceSegments),
      label: sourceType,
      modules: groupByModule(sourceSegments),
      segments: sourceSegments,
      sourceType,
      tokens: sumTokens(sourceSegments),
    }))
    .sort((left, right) => right.tokens - left.tokens);
};

const appendChildren = (
  arcs: TelemetrySunburstArc[],
  children: readonly SegmentGroup[],
  parent: SourceGroup | SegmentGroup,
  sourceType: TokenSourceType,
  depth: 2 | 3,
  startAngle: number,
  span: number,
): void => {
  let cursor = startAngle;
  const color = TELEMETRY_SOURCE_COLORS[sourceType];

  children.forEach((child, index) => {
    const childSpan = parent.tokens === 0 ? 0 : span * (child.tokens / parent.tokens);
    const endAngle = cursor + childSpan;
    arcs.push({
      color,
      cost: child.cost,
      depth,
      endAngle,
      id: `${sourceType}:${depth}:${child.label}:${index}`,
      innerRadius: depth === 2 ? 108 : 143,
      label: child.label,
      outerRadius: depth === 2 ? 138 : 174,
      percentage: parent.tokens === 0 ? 0 : child.tokens / parent.tokens,
      sourceType,
      startAngle: cursor,
      tokens: child.tokens,
    });
    cursor = endAngle;
  });
};

export const toTelemetrySunburst = (
  snapshot: TurnTokenSnapshot,
  focusedSource?: TokenSourceType,
): TelemetrySunburstModel => {
  const sourceGroups = groupBySource(snapshot.segments);
  const totalTokens = sourceGroups.reduce((total, source) => total + source.tokens, 0);
  const totalCost = sourceGroups.reduce((total, source) => total + source.cost, 0);
  const selectedGroups = focusedSource
    ? sourceGroups.filter((source) => source.sourceType === focusedSource)
    : sourceGroups;
  const visibleTokens = selectedGroups.reduce((total, source) => total + source.tokens, 0);
  const visibleCost = selectedGroups.reduce((total, source) => total + source.cost, 0);
  const arcs: TelemetrySunburstArc[] = [];
  let cursor = -Math.PI / 2;

  for (const source of selectedGroups) {
    const span = visibleTokens === 0 ? 0 : Math.PI * 2 * (source.tokens / visibleTokens);
    const endAngle = cursor + span;
    arcs.push({
      color: TELEMETRY_SOURCE_COLORS[source.sourceType],
      cost: source.cost,
      depth: 1,
      endAngle,
      id: `source:${source.sourceType}`,
      innerRadius: 62,
      label: source.sourceType,
      outerRadius: 103,
      percentage: visibleTokens === 0 ? 0 : source.tokens / visibleTokens,
      sourceType: source.sourceType,
      startAngle: cursor,
      tokens: source.tokens,
    });
    appendChildren(arcs, source.modules, source, source.sourceType, 2, cursor, span);

    let moduleCursor = cursor;
    source.modules.forEach((module) => {
      const moduleSpan = source.tokens === 0 ? 0 : span * (module.tokens / source.tokens);
      const segmentGroups = module.segments.map((segment) => ({
        cost: segment.estimatedCost ?? 0,
        label: `${segment.processorId} · ${segment.framingType}`,
        segments: [segment],
        tokens: segment.tokens,
      }));
      appendChildren(arcs, segmentGroups, module, source.sourceType, 3, moduleCursor, moduleSpan);
      moduleCursor += moduleSpan;
    });
    cursor = endAngle;
  }

  return {
    arcs,
    ...(focusedSource ? { focusedSource } : {}),
    sources: sourceGroups.map((source) => ({
      color: TELEMETRY_SOURCE_COLORS[source.sourceType],
      cost: source.cost,
      percentage: totalTokens === 0 ? 0 : source.tokens / totalTokens,
      segmentCount: source.segments.length,
      sourceType: source.sourceType,
      tokens: source.tokens,
    })),
    totalCost,
    totalTokens,
    visibleCost,
    visibleTokens,
  };
};

const polarPoint = (center: number, radius: number, angle: number): [number, number] => [
  center + radius * Math.cos(angle),
  center + radius * Math.sin(angle),
];

export const telemetryArcPath = (
  arc: Pick<TelemetrySunburstArc, 'endAngle' | 'innerRadius' | 'outerRadius' | 'startAngle'>,
  center = 180,
): string => {
  const span = Math.max(arc.endAngle - arc.startAngle, 0);
  const gap = Math.min(0.012, span * 0.12);
  const startAngle = arc.startAngle + gap;
  const endAngle = arc.endAngle - gap;
  if (endAngle <= startAngle) return '';

  const safeEndAngle = Math.min(endAngle, startAngle + Math.PI * 2 - 0.0001);
  const [outerStartX, outerStartY] = polarPoint(center, arc.outerRadius, startAngle);
  const [outerEndX, outerEndY] = polarPoint(center, arc.outerRadius, safeEndAngle);
  const [innerEndX, innerEndY] = polarPoint(center, arc.innerRadius, safeEndAngle);
  const [innerStartX, innerStartY] = polarPoint(center, arc.innerRadius, startAngle);
  const largeArc = safeEndAngle - startAngle > Math.PI ? 1 : 0;

  return [
    `M ${outerStartX.toFixed(3)} ${outerStartY.toFixed(3)}`,
    `A ${arc.outerRadius} ${arc.outerRadius} 0 ${largeArc} 1 ${outerEndX.toFixed(3)} ${outerEndY.toFixed(3)}`,
    `L ${innerEndX.toFixed(3)} ${innerEndY.toFixed(3)}`,
    `A ${arc.innerRadius} ${arc.innerRadius} 0 ${largeArc} 0 ${innerStartX.toFixed(3)} ${innerStartY.toFixed(3)}`,
    'Z',
  ].join(' ');
};
