import { describe, expect, it } from 'vitest';

import { renderSessionTelemetryHtml, toTelemetryChartData } from '../src/devtools.js';
import type { SessionTokenSummary } from '../src/token-types.js';

describe('telemetry visualization', () => {
  it('renders attributed source data and escapes session-controlled labels', () => {
    const summary: SessionTokenSummary = {
      generations: 1,
      instanceId: 'instance-1',
      prefixViolations: 0,
      sessionId: '<script>alert(1)</script>',
      sources: [
        {
          characters: 20,
          cost: 0.001,
          percentage: 1,
          sourceType: 'system',
          tokens: 5,
        },
      ],
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCost: 0.001,
      totalInputTokens: 5,
      totalOutputTokens: 0,
      totalTokens: 5,
      turns: [],
    };

    expect(toTelemetryChartData(summary)[0]).toEqual(
      expect.objectContaining({ color: expect.stringMatching(/^#/u), sourceType: 'system' }),
    );
    const html = renderSessionTelemetryHtml(summary);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Token sources');
    expect(html).toContain('REPORT / SESSION TELEMETRY');
    expect(html).toContain('Composition');
  });
});
