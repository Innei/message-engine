import { useEffect, useMemo, useRef, useState } from 'react';

import { renderSessionTelemetryHtml } from '../../src/devtools.js';
import type {
  PrefixMutationEvent,
  SessionTokenSummary,
  TurnTokenSnapshot,
} from '../../src/index.js';
import type {
  DemoContextStageState,
  DemoMessageView,
  DemoModelOption,
  DemoMutationResult,
  DemoSessionContextInput,
  DemoSessionState,
  DemoStreamEvent,
  DemoTurnContextInput,
} from '../shared/protocol.js';
import { readStoredOpenRouterKey, storeOpenRouterKey } from './api-key-storage.js';
import { TokenSunburst } from './TokenSunburst.js';

const STARTERS = [
  'Explain why an append-only transcript improves provider prompt caching in three points.',
  'Remember that the experiment codename is Green Ribbon. Confirm it briefly.',
  'What was the experiment codename, and which earlier message established it?',
];

const DEFAULT_SESSION_CONTEXT: DemoSessionContextInput = {
  policy: 'research-only',
  workspace: 'Kansoku Trading Desk',
};

const DEFAULT_TURN_CONTEXT: DemoTurnContextInput = {
  route: '/markets/MU.US',
  selection: 'MU.US · daily candle',
};

interface TraceEntry {
  id: number;
  kind: 'error' | 'info' | 'prefix' | 'usage';
  message: string;
  time: string;
}

const formatInteger = (value: number): string =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

const formatCost = (value: number): string => `$${value.toFixed(6)}`;

const formatRate = (value: number): string =>
  `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value)}/M in`;

const formatPercent = (value: number | undefined): string => {
  if (value === undefined) return '—';
  return `${(value * 100).toFixed(1)}%`;
};

const shortId = (value: string): string => value.slice(0, 8);

const summarizeContextValue = (value: string | undefined): string => {
  if (!value) return 'not built yet';
  return value
    .split('\n')
    .filter((line) => !line.startsWith('<'))
    .join(' · ');
};

const readError = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
};

const consumeNdjson = async (
  response: Response,
  onEvent: (event: DemoStreamEvent) => void,
): Promise<void> => {
  if (!response.body) throw new Error('Streaming response body is unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as DemoStreamEvent);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) onEvent(JSON.parse(buffer) as DemoStreamEvent);
};

const downloadTelemetryReport = (summary: SessionTokenSummary): void => {
  const html = renderSessionTelemetryHtml(summary);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `message-engine-${summary.sessionId}.html`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const Conversation = ({
  messages,
  pendingText,
  streaming,
}: {
  messages: DemoMessageView[];
  pendingText: string;
  streaming: boolean;
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pendingText]);

  if (messages.length === 0 && !streaming) {
    return (
      <div className="conversation-empty">
        <span className="eyebrow">READY FOR A REAL PROVIDER TURN</span>
        <h2>The transcript begins when the first request leaves this machine.</h2>
        <p>Choose a starter below or enter a prompt. No synthetic usage is inserted.</p>
      </div>
    );
  }

  return (
    <div className="conversation-list" aria-live="polite">
      {messages.map((message) => (
        <article className={`message message-${message.role}`} key={message.id}>
          <div className="message-label">{message.role}</div>
          <div className="message-copy">{message.text}</div>
          {message.stopReason ? (
            <div className="message-meta">stop: {message.stopReason}</div>
          ) : null}
        </article>
      ))}
      {streaming ? (
        <article className="message message-assistant message-streaming">
          <div className="message-label">assistant · streaming</div>
          <div className="message-copy">
            {pendingText}
            <span className="cursor" aria-hidden="true" />
          </div>
        </article>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
};

const ContextPipeline = ({ stages }: { stages: DemoContextStageState[] }) => (
  <section className="inspector-section context-pipeline-section">
    <div className="section-heading">
      <div>
        <h3>Context pipeline</h3>
        <small>phase × lifetime × model position</small>
      </div>
      <span>{stages.filter((stage) => stage.tokens > 0).length}/4 active</span>
    </div>
    <div className="context-stage-list">
      {stages.map((stage, index) => (
        <div className="context-stage" key={stage.id}>
          <span className="context-stage-index">0{index + 1}</span>
          <div className="context-stage-main">
            <strong>{stage.phase}</strong>
            <small>{stage.modelPosition}</small>
            <code title={stage.value}>{summarizeContextValue(stage.value)}</code>
          </div>
          <div className="context-stage-status">
            <span className={`context-scope context-scope-${stage.cacheScope}`}>
              {stage.cacheScope}
            </span>
            <strong>{formatInteger(stage.tokens)}t</strong>
            <small>
              {stage.replayed ? 'replayed' : `built ×${stage.buildCount}`}
              {stage.cacheStatus ? ` · ${stage.cacheStatus}` : ''}
            </small>
          </div>
        </div>
      ))}
      {stages.length === 0 ? (
        <p className="empty-note">Start a session to inspect injection timing.</p>
      ) : null}
    </div>
  </section>
);

const TelemetryInspector = ({
  prefixEvent,
  snapshot,
  state,
}: {
  prefixEvent: PrefixMutationEvent | undefined;
  snapshot: TurnTokenSnapshot | undefined;
  state: DemoSessionState | undefined;
}) => {
  const [tokenMapExpanded, setTokenMapExpanded] = useState(false);
  const summary = state?.summary;
  const providerHit = summary?.averageProviderCacheHitRate;
  const latestTurn = summary?.turns.at(-1);
  const prefixGenerationLabel =
    prefixEvent?.action === 'blocked' ? 'proposed generation' : 'generation';

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <span className="eyebrow">LIVE TELEMETRY</span>
        <span className={`live-dot ${state ? 'live-dot-on' : ''}`} />
      </div>

      <div className="metric-ledger">
        <div>
          <span>Input processed</span>
          <strong>{formatInteger(summary?.totalInputTokens ?? 0)}</strong>
        </div>
        <div>
          <span>Provider cache</span>
          <strong>{formatPercent(providerHit)}</strong>
        </div>
        <div>
          <span>Actual cost</span>
          <strong>{formatCost(summary?.totalCost ?? 0)}</strong>
        </div>
        <div>
          <span>Generation</span>
          <strong>{state?.generation ?? 0}</strong>
        </div>
      </div>

      <ContextPipeline stages={state?.contextStages ?? []} />

      <section className="inspector-section token-map-section">
        <div className="section-heading">
          <div>
            <h3>Prompt anatomy</h3>
            <small>source → module → segment</small>
          </div>
          <button
            className="token-map-expand"
            disabled={!latestTurn && !snapshot}
            onClick={() => setTokenMapExpanded(true)}
            type="button"
          >
            Expand
          </button>
        </div>
        <TokenSunburst snapshot={latestTurn ?? snapshot} />
      </section>

      <section className="inspector-section">
        <div className="section-heading">
          <h3>Latest provider turn</h3>
          <span>{latestTurn ? `g${latestTurn.generation}` : '—'}</span>
        </div>
        <dl className="turn-facts">
          <div>
            <dt>Internal prefix reuse</dt>
            <dd>{formatPercent(latestTurn?.cache.internalPrefixReuseRatio)}</dd>
          </div>
          <div>
            <dt>Cache-read tokens</dt>
            <dd>{formatInteger(latestTurn?.cache.cacheReadTokens ?? 0)}</dd>
          </div>
          <div>
            <dt>Uncached input</dt>
            <dd>{formatInteger(latestTurn?.cache.uncachedInputTokens ?? 0)}</dd>
          </div>
          <div>
            <dt>Segment accuracy</dt>
            <dd>{snapshot?.segments[0]?.accuracy ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="inspector-section segment-section">
        <div className="section-heading">
          <h3>Attributed segments</h3>
          <span>{snapshot?.segments.length ?? 0}</span>
        </div>
        <div className="segment-list">
          {(snapshot?.segments ?? []).map((segment) => (
            <div className="segment-row" key={segment.segmentId}>
              <div>
                <span>{segment.sourceType}</span>
                <small>{segment.processorId}</small>
              </div>
              <strong>{segment.tokens}</strong>
              <span className={`cache-status cache-${segment.cacheStatus}`}>
                {segment.cacheStatus}
              </span>
            </div>
          ))}
          {!snapshot?.segments.length ? (
            <p className="empty-note">Compile a turn to inspect.</p>
          ) : null}
        </div>
      </section>

      {prefixEvent ? (
        <section className={`prefix-alert prefix-${prefixEvent.action}`}>
          <span className="eyebrow">PREFIX EVENT</span>
          <strong>{prefixEvent.action}</strong>
          <p>
            {prefixEvent.reason} at index {prefixEvent.firstChangedIndex}; {prefixGenerationLabel}{' '}
            {prefixEvent.previousGeneration} → {prefixEvent.nextGeneration}
          </p>
        </section>
      ) : null}

      {tokenMapExpanded ? (
        <div
          className="token-map-overlay"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setTokenMapExpanded(false);
          }}
          role="presentation"
        >
          <section aria-label="Prompt token anatomy" aria-modal="true" role="dialog">
            <header>
              <div>
                <span className="eyebrow">PROMPT TOKEN ANATOMY</span>
                <h2>Every ring resolves one level deeper.</h2>
                <p>Arc length is the token share within its parent. Select any sector to focus.</p>
              </div>
              <button
                aria-label="Close token map"
                className="token-map-close"
                onClick={() => setTokenMapExpanded(false)}
                type="button"
              >
                Close
              </button>
            </header>
            <TokenSunburst expanded snapshot={latestTurn ?? snapshot} />
          </section>
        </div>
      ) : null}
    </aside>
  );
};

export const App = () => {
  const [models, setModels] = useState<DemoModelOption[]>([]);
  const [modelId, setModelId] = useState('openai/gpt-5.6-luna');
  const [apiKey, setApiKey] = useState(readStoredOpenRouterKey);
  const [sessionContext, setSessionContext] =
    useState<DemoSessionContextInput>(DEFAULT_SESSION_CONTEXT);
  const [turnContext, setTurnContext] = useState<DemoTurnContextInput>(DEFAULT_TURN_CONTEXT);
  const [environmentKeyAvailable, setEnvironmentKeyAvailable] = useState(false);
  const [strict, setStrict] = useState(true);
  const [session, setSession] = useState<DemoSessionState>();
  const [messages, setMessages] = useState<DemoMessageView[]>([]);
  const [prompt, setPrompt] = useState(STARTERS[0] ?? '');
  const [pendingText, setPendingText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [prefixEvent, setPrefixEvent] = useState<PrefixMutationEvent>();
  const [latestSnapshot, setLatestSnapshot] = useState<TurnTokenSnapshot>();
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [error, setError] = useState<string>();
  const traceSequence = useRef(0);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === modelId),
    [modelId, models],
  );

  const addTrace = (kind: TraceEntry['kind'], message: string): void => {
    traceSequence.current += 1;
    setTraces((current) => [
      ...current.slice(-19),
      {
        id: traceSequence.current,
        kind,
        message,
        time: new Date().toLocaleTimeString([], { hour12: false }),
      },
    ]);
  };

  const updateApiKey = (value: string): void => {
    setApiKey(value);
    storeOpenRouterKey(value);
  };

  useEffect(() => {
    const load = async (): Promise<void> => {
      const [modelsResponse, healthResponse] = await Promise.all([
        fetch('/api/models'),
        fetch('/api/health'),
      ]);
      if (!modelsResponse.ok) throw new Error(await readError(modelsResponse));
      if (!healthResponse.ok) throw new Error(await readError(healthResponse));
      const modelsBody = (await modelsResponse.json()) as { models: DemoModelOption[] };
      const healthBody = (await healthResponse.json()) as {
        environmentKeyAvailable: boolean;
      };
      setModels(modelsBody.models);
      setEnvironmentKeyAvailable(healthBody.environmentKeyAvailable);
      if (!modelsBody.models.some((model) => model.id === modelId)) {
        setModelId(modelsBody.models[0]?.id ?? '');
      }
    };

    void load().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
  }, []);

  const destroyCurrentSession = async (): Promise<void> => {
    if (!session) return;
    await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}`, { method: 'DELETE' });
  };

  const startSession = async (): Promise<void> => {
    setError(undefined);
    if (!modelId) {
      setError('Select an OpenRouter model first.');
      return;
    }
    await destroyCurrentSession();
    const response = await fetch('/api/sessions', {
      body: JSON.stringify({ context: sessionContext, modelId, strict }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error(await readError(response));
    const state = (await response.json()) as DemoSessionState;
    setSession(state);
    setMessages([]);
    setLatestSnapshot(undefined);
    setPrefixEvent(undefined);
    setTraces([]);
    addTrace(
      'info',
      `Session ${shortId(state.sessionId)} created in ${strict ? 'strict' : 'relaxed'} mode.`,
    );
  };

  const handleStreamEvent = (event: DemoStreamEvent): void => {
    if (event.type === 'turn-start') return;
    if (event.type === 'text-delta') {
      setPendingText((current) => current + event.delta);
      return;
    }
    if (event.type === 'token-snapshot') {
      setLatestSnapshot(event.snapshot);
      setSession((current) => {
        if (!current) return current;
        return {
          ...current,
          contextStages: event.contextStages,
          ...(event.summary ? { summary: event.summary } : {}),
        };
      });
      addTrace('info', `${event.snapshot.segments.length} prompt segments tokenized.`);
      addTrace(
        'info',
        `Context stages: ${event.contextStages
          .map(
            (stage) =>
              `${stage.phase} ${stage.tokens}t/${stage.replayed ? 'replay' : `build×${stage.buildCount}`}`,
          )
          .join(' · ')}.`,
      );
      return;
    }
    if (event.type === 'provider-usage') {
      const reasoning = event.reasoningTokens ? `, reasoning ${event.reasoningTokens}` : '';
      addTrace(
        'usage',
        `${event.modelId} · input ${event.inputTokens} + cache ${event.cacheReadTokens}, output ${event.outputTokens}${reasoning}; ${formatCost(event.totalCost)} (${formatCost(event.inputCost)} in / ${formatCost(event.outputCost)} out / ${formatCost(event.cacheReadCost + event.cacheWriteCost)} cache).`,
      );
      return;
    }
    if (event.type === 'assistant-final') {
      setPendingText(event.message.text);
      return;
    }
    if (event.type === 'prefix-mutation') {
      setPrefixEvent(event.event);
      addTrace('prefix', `${event.event.action}: ${event.event.reason}.`);
      return;
    }
    if (event.type === 'trace') {
      addTrace('info', event.message);
      return;
    }
    if (event.type === 'error') {
      setError(event.message);
      addTrace('error', event.message);
      return;
    }
    setSession(event.state);
    setMessages(event.state.messages);
  };

  const runTurn = async (): Promise<void> => {
    if (!session) {
      setError('Start a session before sending a turn.');
      return;
    }
    if (!apiKey.trim() && !environmentKeyAvailable) {
      setError('Enter an OpenRouter key. It will be stored in this browser.');
      return;
    }
    if (!prompt.trim()) return;

    const submittedPrompt = prompt.trim();
    setError(undefined);
    setStreaming(true);
    setPendingText('');
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: 'user', text: submittedPrompt },
    ]);
    setPrompt('');

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/turn`, {
        body: JSON.stringify({ context: turnContext, key: apiKey, prompt: submittedPrompt }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error(await readError(response));
      await consumeNdjson(response, handleStreamEvent);
    } catch (turnError) {
      const message = turnError instanceof Error ? turnError.message : String(turnError);
      setError(message);
      addTrace('error', message);
    } finally {
      setStreaming(false);
      setPendingText('');
    }
  };

  const mutatePrefix = async (): Promise<void> => {
    if (!session) return;
    setError(undefined);
    const replacement = `MUTATED PREFIX · ${new Date().toISOString()}`;
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(session.sessionId)}/mutate-prefix`,
      {
        body: JSON.stringify({ replacement }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );
    if (!response.ok) throw new Error(await readError(response));
    const result = (await response.json()) as DemoMutationResult;
    setSession(result.state);
    setMessages(result.state.messages);
    if (result.event) {
      setPrefixEvent(result.event);
      addTrace('prefix', `${result.event.action}: ${result.event.reason}.`);
    }
  };

  const teardownSession = async (): Promise<void> => {
    if (!session) return;
    await destroyCurrentSession();
    addTrace('info', `Session ${shortId(session.sessionId)} destroyed; in-memory state cleared.`);
    setSession(undefined);
    setMessages([]);
    setLatestSnapshot(undefined);
    setPrefixEvent(undefined);
  };

  const canRun = Boolean(session) && !streaming;
  let keyStatus = 'Browser key required';
  if (environmentKeyAvailable) keyStatus = 'Environment key available';
  else if (apiKey.trim()) keyStatus = 'Browser key stored';

  return (
    <div className="lab-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>MESSAGE ENGINE</strong>
            <span>Pi / OpenRouter validation lab</span>
          </div>
        </div>
        <div className="session-strip">
          <span className={session ? 'status-online' : 'status-offline'}>
            {session ? 'SESSION ACTIVE' : 'NO SESSION'}
          </span>
          <span>{session ? shortId(session.instanceId) : 'instance —'}</span>
          <span>{selectedModel?.name ?? modelId}</span>
        </div>
      </header>

      <main className="workspace">
        <aside className="control-rail">
          <section className="control-section">
            <span className="eyebrow">RUNTIME</span>
            <label className="field-label" htmlFor="model">
              OpenRouter model
            </label>
            <select
              disabled={streaming}
              id="model"
              onChange={(event) => setModelId(event.target.value)}
              value={modelId}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <div className="model-facts">
              <span>{formatInteger(selectedModel?.contextWindow ?? 0)} context</span>
              <span>{formatRate(selectedModel?.inputPerMillion ?? 0)}</span>
            </div>

            <label className="field-label" htmlFor="api-key">
              OpenRouter key
            </label>
            <input
              autoComplete="off"
              id="api-key"
              onChange={(event) => updateApiKey(event.target.value)}
              placeholder={environmentKeyAvailable ? 'Using server environment' : 'sk-or-v1-…'}
              spellCheck={false}
              type="password"
              value={apiKey}
            />
            <p className="field-help">
              {keyStatus}. Stored in this browser only; clearing the field removes it.
            </p>

            <label className="strict-toggle">
              <span>
                <strong>Strict prefix</strong>
                <small>Block committed history edits</small>
              </span>
              <input
                checked={strict}
                disabled={streaming}
                onChange={(event) => setStrict(event.target.checked)}
                type="checkbox"
              />
              <span className="toggle-track" aria-hidden="true" />
            </label>

            <button
              className="primary-action"
              disabled={streaming || models.length === 0}
              onClick={() =>
                void startSession().catch((actionError: unknown) => {
                  setError(
                    actionError instanceof Error ? actionError.message : String(actionError),
                  );
                })
              }
              type="button"
            >
              {session ? 'Restart session' : 'Start session'}
            </button>
          </section>

          <section className="control-section context-inputs">
            <span className="eyebrow">CONTEXT INPUT</span>
            <div className="context-input-scope">
              <span>Session scoped</span>
              <small>{session ? 'applies on restart' : 'captured on start'}</small>
            </div>
            <label htmlFor="context-workspace">
              Workspace
              <input
                disabled={streaming}
                id="context-workspace"
                onChange={(event) =>
                  setSessionContext((current) => ({
                    ...current,
                    workspace: event.target.value,
                  }))
                }
                value={sessionContext.workspace}
              />
            </label>
            <label htmlFor="context-policy">
              Policy
              <select
                disabled={streaming}
                id="context-policy"
                onChange={(event) =>
                  setSessionContext((current) => ({ ...current, policy: event.target.value }))
                }
                value={sessionContext.policy}
              >
                <option value="research-only">research-only</option>
                <option value="approval-required">approval-required</option>
                <option value="autonomous-sandbox">autonomous-sandbox</option>
              </select>
            </label>

            <div className="context-input-scope context-input-turn">
              <span>Turn scoped</span>
              <small>captured on every run</small>
            </div>
            <label htmlFor="context-route">
              Route
              <input
                disabled={streaming}
                id="context-route"
                onChange={(event) =>
                  setTurnContext((current) => ({ ...current, route: event.target.value }))
                }
                value={turnContext.route}
              />
            </label>
            <label htmlFor="context-selection">
              Selection
              <input
                disabled={streaming}
                id="context-selection"
                onChange={(event) =>
                  setTurnContext((current) => ({ ...current, selection: event.target.value }))
                }
                value={turnContext.selection}
              />
            </label>
          </section>

          <section className="control-section experiment-controls">
            <span className="eyebrow">EXPERIMENTS</span>
            <button
              disabled={!session || messages.length === 0 || streaming}
              onClick={() =>
                void mutatePrefix().catch((actionError: unknown) => {
                  setError(
                    actionError instanceof Error ? actionError.message : String(actionError),
                  );
                })
              }
              type="button"
            >
              Mutate oldest prefix
            </button>
            <button
              disabled={!session?.summary}
              onClick={() => {
                if (session?.summary) downloadTelemetryReport(session.summary);
              }}
              type="button"
            >
              Export devtools HTML
            </button>
            <button
              disabled={!session || streaming}
              onClick={() =>
                void teardownSession().catch((actionError: unknown) => {
                  setError(
                    actionError instanceof Error ? actionError.message : String(actionError),
                  );
                })
              }
              type="button"
            >
              Teardown session
            </button>
          </section>

          <section className="trace-section">
            <div className="section-heading">
              <h3>Runtime trace</h3>
              <span>{traces.length}</span>
            </div>
            <div className="trace-list">
              {traces.map((trace) => (
                <div className={`trace trace-${trace.kind}`} key={trace.id}>
                  <time>{trace.time}</time>
                  <span>{trace.message}</span>
                </div>
              ))}
              {traces.length === 0 ? <p className="empty-note">No runtime events.</p> : null}
            </div>
          </section>
        </aside>

        <section className="chat-workspace">
          <div className="chat-heading">
            <div>
              <span className="eyebrow">MODEL-VISIBLE CONVERSATION</span>
              <h1>Real turns. Measured context.</h1>
            </div>
            <div className="generation-readout">
              <span>cache identity</span>
              <code>{session ? session.cacheIdentity.slice(0, 28) : '—'}</code>
            </div>
          </div>

          <div className="conversation-frame">
            <Conversation messages={messages} pendingText={pendingText} streaming={streaming} />
          </div>

          <div className="starter-row">
            {STARTERS.map((starter, index) => (
              <button
                disabled={streaming}
                key={starter}
                onClick={() => setPrompt(starter)}
                type="button"
              >
                0{index + 1} {starter.split('.')[0]}
              </button>
            ))}
          </div>

          <div className="composer">
            <textarea
              aria-label="Agent prompt"
              disabled={streaming}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (canRun) void runTurn();
                }
              }}
              placeholder="Send a real provider turn…"
              rows={3}
              value={prompt}
            />
            <button
              className="send-action"
              disabled={!canRun || !prompt.trim()}
              onClick={() => void runTurn()}
              type="button"
            >
              {streaming ? 'Running' : 'Run turn'}
            </button>
          </div>
          {error ? <div className="error-banner">{error}</div> : null}
        </section>

        <TelemetryInspector prefixEvent={prefixEvent} snapshot={latestSnapshot} state={session} />
      </main>
    </div>
  );
};
