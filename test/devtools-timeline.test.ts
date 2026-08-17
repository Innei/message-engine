import { describe, expect, it } from 'vitest';

import { toTelemetryTimeline } from '../src/devtools-timeline.js';
import { createTelemetrySnapshot } from './telemetry-fixture.js';

describe('telemetry timeline', () => {
  it('projects provider cache coverage onto the reusable prefix without covering turn context', () => {
    const first = createTelemetrySnapshot('turn-1', {
      cacheReadTokens: 800,
      inputTokens: 500,
    });
    const second = createTelemetrySnapshot('turn-2', {
      cacheReadTokens: 0,
      inputTokens: 1300,
    });
    const timeline = toTelemetryTimeline([first, second], {
      cachePolicy: { minimumCacheTokens: 1024 },
    });
    const firstTurn = timeline.turns[0];
    const secondTurn = timeline.turns[1];
    if (!firstTurn || !secondTurn) throw new Error('Expected two timeline turns');

    expect(firstTurn.cachedTokens).toBe(800);
    expect(firstTurn.segments.find((item) => item.id === 'system')?.coverage).toBe('full');
    expect(firstTurn.segments.find((item) => item.id === 'stable-prefix')?.coverage).toBe(
      'partial',
    );
    expect(firstTurn.segments.find((item) => item.id === 'user')?.coverage).toBe('none');
    expect(secondTurn.hint).toEqual({ kind: 'missed-after-prefix', tokens: 1300 });
  });

  it('deduplicates engine framing artifacts while retaining attributed segment order', () => {
    const snapshot = createTelemetrySnapshot('turn-1');
    const system = snapshot.segments[0];
    if (!system) throw new Error('Expected system segment');
    snapshot.segments.splice(1, 0, { ...system, segmentId: 'duplicate-system' });
    snapshot.segments.push({
      ...snapshot.segments[1]!,
      framingType: 'message:user',
      processorId: 'raw-message',
      segmentId: 'duplicated-injected-message',
    });

    const timeline = toTelemetryTimeline([snapshot]);
    const projected = timeline.turns[0];
    if (!projected) throw new Error('Expected projected turn');

    expect(projected.segments.filter((item) => item.sourceType === 'system')).toHaveLength(1);
    expect(projected.segments.some((item) => item.id === 'duplicated-injected-message')).toBe(
      false,
    );
    expect(projected.segments.map((item) => item.id)).toEqual(['system', 'stable-prefix', 'user']);
  });
});
