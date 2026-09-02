import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';

import { renderSessionTelemetryHtml } from '../../src/devtools.js';
import type {
  PrefixMutationEvent,
  SessionTokenSummary,
  TurnTokenSnapshot,
} from '../../src/index.js';
import type {
  DemoMessageView,
  DemoModelOption,
  DemoMutationResult,
  DemoSessionContextInput,
  DemoSessionState,
  DemoStreamEvent,
  DemoTurnContextInput,
} from '../shared/protocol.js';
import { readStoredOpenRouterKey, storeOpenRouterKey } from './api-key-storage.js';
import { LinearDocsSidebar } from './components/LinearDocsSidebar.js';
import { LinearNavbar } from './components/LinearNavbar.js';
import { PlaygroundCanvas } from './components/PlaygroundCanvas.js';
import { TelemetryDrawer } from './components/TelemetryDrawer.js';
import { formatCost, shortId } from './formatters.js';
import { EXPERIMENT_SCENARIOS } from './scenarios.js';
import type { ActiveViewMode, InspectorTab, TraceEntry } from './types.js';

const DEFAULT_SESSION_CONTEXT: DemoSessionContextInput = {
  policy: 'research-only',
  workspace: 'Kansoku Trading Desk',
};

const DEFAULT_TURN_CONTEXT: DemoTurnContextInput = {
  route: '/markets/MU.US',
  selection: 'MU.US · daily candle',
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

export const App = () => {
  const [activeView, setActiveView] = useState<ActiveViewMode>('playground');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('metrics');
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
  const [prompt, setPrompt] = useState(EXPERIMENT_SCENARIOS[0]?.prompt ?? '');
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
      ...current.slice(-24),
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

  const handleViewChange = (view: ActiveViewMode) => {
    setActiveView(view);
    if (view === 'pipeline') setInspectorTab('stages');
    if (view === 'telemetry') setInspectorTab('anatomy');
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
    const modeLabel = strict ? 'strict' : 'relaxed';
    addTrace('info', `Session ${shortId(state.sessionId)} created in ${modeLabel} mode.`);
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
      const stageDigest = event.contextStages
        .map((s) => {
          const replayLabel = s.replayed ? 'replay' : `build×${s.buildCount}`;
          return `${s.phase} ${s.tokens}t/${replayLabel}`;
        })
        .join(' · ');
      addTrace('info', `Context stages: ${stageDigest}.`);
      return;
    }
    if (event.type === 'provider-usage') {
      const reasoning = event.reasoningTokens ? `, reasoning ${event.reasoningTokens}` : '';
      const totalCostStr = formatCost(event.totalCost);
      const inCostStr = formatCost(event.inputCost);
      const outCostStr = formatCost(event.outputCost);
      const cacheCostStr = formatCost(event.cacheReadCost + event.cacheWriteCost);
      addTrace(
        'usage',
        `${event.modelId} · in ${event.inputTokens} + cache ${event.cacheReadTokens}, out ${event.outputTokens}${reasoning}; ${totalCostStr} (${inCostStr} in / ${outCostStr} out / ${cacheCostStr} cache).`,
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
      setError('Initialize an engine session before sending a turn.');
      return;
    }
    if (!apiKey.trim() && !environmentKeyAvailable) {
      setError('Enter an OpenRouter key in the sidebar.');
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

  const simulateTimestampDrift = (): void => {
    const timestampStr = new Date().toISOString();
    setSessionContext((prev) => ({
      ...prev,
      workspace: `Kansoku Trading [DRIFT-${timestampStr.slice(11, 19)}]`,
    }));
    addTrace(
      'prefix',
      `Simulated dynamic timestamp injected: [DRIFT-${timestampStr.slice(11, 19)}]. Restarting or modifying committed prefix causes 100% cache invalidation without Prefix Guard.`,
    );
  };

  const simulateOrderSwap = (): void => {
    setTurnContext((prev) => ({
      route: prev.selection,
      selection: prev.route,
    }));
    addTrace(
      'info',
      'Context key order swapped. Message Engine pipeline guarantees deterministic serialization order.',
    );
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

  return (
    <div className="linear-studio-viewport">
      <LinearNavbar
        activeView={activeView}
        model={selectedModel}
        onExportHtml={() => {
          if (session?.summary) downloadTelemetryReport(session.summary);
        }}
        onViewChange={handleViewChange}
        session={session}
        summary={session?.summary}
      />

      <div className="linear-layout-workspace">
        <LinearDocsSidebar
          activeView={activeView}
          apiKey={apiKey}
          environmentKeyAvailable={environmentKeyAvailable}
          modelId={modelId}
          models={models}
          onApiKeyChange={updateApiKey}
          onModelChange={setModelId}
          onMutatePrefix={() => {
            void mutatePrefix().catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e));
            });
          }}
          onRestartSession={() => {
            void startSession().catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e));
            });
          }}
          onSelectScenario={setPrompt}
          onSessionContextChange={setSessionContext}
          onSimulateOrderSwap={simulateOrderSwap}
          onSimulateTimestampDrift={simulateTimestampDrift}
          onStrictChange={setStrict}
          onTeardownSession={() => {
            void teardownSession().catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e));
            });
          }}
          onTurnContextChange={setTurnContext}
          onViewChange={handleViewChange}
          session={session}
          sessionContext={sessionContext}
          streaming={streaming}
          strict={strict}
          turnContext={turnContext}
        />

        <main className="linear-stage-container">
          <PlaygroundCanvas
            canRun={canRun}
            messages={messages}
            model={selectedModel}
            onPromptChange={setPrompt}
            onRunTurn={() => void runTurn()}
            onSelectScenario={setPrompt}
            pendingText={pendingText}
            prefixEvent={prefixEvent}
            prompt={prompt}
            session={session}
            snapshot={latestSnapshot}
            streaming={streaming}
          />
        </main>

        <TelemetryDrawer
          activeTab={inspectorTab}
          onTabChange={setInspectorTab}
          prefixEvent={prefixEvent}
          snapshot={latestSnapshot}
          state={session}
          traces={traces}
        />
      </div>

      {error ? (
        <div className="linear-floating-alert" role="alert">
          <AlertCircle size={14} className="alert-leading-icon" />
          <span className="alert-content-msg">{error}</span>
          <button className="alert-close-action" onClick={() => setError(undefined)} type="button">
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
};
