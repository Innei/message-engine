import { describe, expect, it } from 'vitest';

import { telemetryArcPath, toTelemetrySunburst } from '../src/devtools.js';
import type { TurnTokenSnapshot } from '../src/token-types.js';

const snapshot: TurnTokenSnapshot = {
  cache: { internalPrefixReuseRatio: 0.75 },
  createdAt: 1,
  generation: 0,
  segments: [
    {
      accuracy: 'exact',
      cacheScope: 'session',
      cacheStatus: 'provider-cache-read',
      characters: 320,
      contentDigest: 'system-digest',
      framingType: 'system-prompt',
      moduleId: 'core',
      percentage: 0.75,
      processorId: 'system-processor',
      segmentId: 'system-segment',
      sourceType: 'system',
      tokens: 75,
    },
    {
      accuracy: 'exact',
      cacheScope: 'turn',
      cacheStatus: 'not-eligible',
      characters: 100,
      contentDigest: 'user-digest',
      framingType: 'message',
      moduleId: 'transcript',
      percentage: 0.25,
      processorId: 'message-processor',
      segmentId: 'user-segment',
      sourceType: 'user',
      tokens: 25,
    },
  ],
  sessionId: 'session',
  totalCharacters: 420,
  totalTokens: 100,
  turnId: 'turn',
};

describe('telemetry sunburst', () => {
  it('builds source, module, and segment rings with proportional source arcs', () => {
    const model = toTelemetrySunburst(snapshot);
    const sourceArcs = model.arcs.filter((arc) => arc.depth === 1);
    const firstSourceArc = sourceArcs[0];
    if (!firstSourceArc) throw new Error('Expected a source arc');

    expect(model.sources.map((source) => source.sourceType)).toEqual(['system', 'user']);
    expect(model.arcs.some((arc) => arc.depth === 2 && arc.label === 'core')).toBe(true);
    expect(model.arcs.some((arc) => arc.depth === 3 && arc.label.includes('system-prompt'))).toBe(
      true,
    );
    expect(firstSourceArc.endAngle - firstSourceArc.startAngle).toBeCloseTo(Math.PI * 1.5);
    expect(telemetryArcPath(firstSourceArc)).toContain('A 103 103');
  });

  it('drills into a source without changing the complete source legend', () => {
    const model = toTelemetrySunburst(snapshot, 'user');

    expect(model.visibleTokens).toBe(25);
    expect(model.arcs.every((arc) => arc.sourceType === 'user')).toBe(true);
    expect(model.sources).toHaveLength(2);
  });
});
