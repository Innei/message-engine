import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { createMessageEngineDevtoolsRecorder } from '../src/devtools-recorder.js';
import { MessageEngineDevtools, MessageEngineTraceViewer } from '../src/devtools-react.js';
import { createTelemetrySnapshot } from './telemetry-fixture.js';

describe('message engine React devtools', () => {
  it('renders a complete context timeline from recorder telemetry', async () => {
    const recorder = createMessageEngineDevtoolsRecorder();
    const binding = recorder.startRun({
      model: 'gpt-5.6-luna',
      provider: 'openai',
      sessionId: 'session-1',
      title: 'Torrent analysis',
    });
    await binding.telemetrySink.write({
      snapshot: createTelemetrySnapshot('turn-1', {
        cacheReadTokens: 800,
        inputTokens: 500,
        outputTokens: 40,
      }),
      type: 'usage-recorded',
    });
    binding.recordActivity({
      detail: 'completed in 82ms',
      durationMs: 82,
      kind: 'tool',
      label: 'tmdbSearch',
      status: 'success',
      turnId: 'turn-1',
    });

    const html = renderToStaticMarkup(
      <MessageEngineDevtools
        cachePolicy={{ minimumCacheTokens: 1024 }}
        source={recorder}
        theme="dark"
      />,
    );

    expect(html).toContain('Torrent analysis');
    expect(html).toContain('Call 1');
    expect(html).toContain('tmdbSearch');
    expect(html).toContain('Message Engine');
    expect(html).toContain('aria-label="Trace runs"');
    expect(html).toContain('Context scale up to 1,300 tokens');
    expect(html).toContain('Overview');
    expect(html).toContain('data-theme="dark"');
  });

  it('renders prompt anatomy without a downstream chart implementation', () => {
    const recorder = createMessageEngineDevtoolsRecorder();
    recorder.startRun({ sessionId: 'session-1', title: 'Prompt anatomy' });
    const run = recorder.getRun('session-1');
    if (!run) throw new Error('Expected recorder run');
    run.summary.turns = [createTelemetrySnapshot('turn-1')];

    const html = renderToStaticMarkup(<MessageEngineTraceViewer defaultView="anatomy" run={run} />);

    expect(html).toContain('Source / module / segment');
    expect(html).toContain('stable-prefix');
    expect(html).toContain('not captured');
    expect(html).toContain('me-blueprint');
  });
});
