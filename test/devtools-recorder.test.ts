import { describe, expect, it } from 'vitest';

import { createMessageEngineDevtoolsRecorder } from '../src/devtools-recorder.js';
import { createTelemetrySnapshot } from './telemetry-fixture.js';

describe('message engine devtools recorder', () => {
  it('replaces preflight telemetry with provider usage and retains correlated activities', async () => {
    const recorder = createMessageEngineDevtoolsRecorder();
    const binding = recorder.startRun({
      model: 'gpt-5.6-luna',
      provider: 'openai',
      sessionId: 'session-1',
      title: 'Inspect cache behavior',
    });
    await binding.telemetrySink.write({
      snapshot: createTelemetrySnapshot('turn-1'),
      type: 'turn-compiled',
    });
    binding.recordActivity({
      kind: 'tool',
      label: 'search',
      status: 'success',
      turnId: 'turn-1',
    });
    await binding.telemetrySink.write({
      snapshot: createTelemetrySnapshot('turn-1', {
        cacheReadTokens: 800,
        inputTokens: 500,
        outputTokens: 40,
      }),
      type: 'usage-recorded',
    });
    binding.recordPrefixMutation({
      action: 'blocked',
      committedBoundary: 2,
      expected: false,
      firstChangedIndex: 0,
      instanceId: 'instance-1',
      nextGeneration: 1,
      previousGeneration: 0,
      reason: 'content-changed',
      sessionId: 'session-1',
      strict: true,
    });
    binding.end({ status: 'success' });

    const run = recorder.getRun('session-1');
    expect(run?.summary.turns).toHaveLength(1);
    expect(run?.summary.totalCacheReadTokens).toBe(800);
    expect(run?.summary.averageProviderCacheHitRate).toBeCloseTo(800 / 1300);
    expect(run?.activities[0]).toMatchObject({ label: 'search', turnId: 'turn-1' });
    expect(run?.summary.prefixViolations).toBe(1);
    expect(run?.status).toBe('success');
  });

  it('keeps one stable snapshot until recorder state changes', () => {
    const recorder = createMessageEngineDevtoolsRecorder();
    const initial = recorder.getSnapshot();
    expect(recorder.getSnapshot()).toBe(initial);

    recorder.startRun({ sessionId: 'session-1' });
    expect(recorder.getSnapshot()).not.toBe(initial);
  });
});
