import { useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Download, Sparkles } from 'lucide-react';

import { renderSessionTelemetryHtml } from '../../../src/devtools.js';
import type {
  MessageEngineDevtoolsSnapshot,
  MessageEngineDevtoolsSource,
  MessageEngineTraceRun,
} from '../../../src/devtools-recorder.js';
import { CallTimeline } from './CallTimeline.js';
import { DevtoolsInspector } from './DevtoolsInspector.js';
import { RunsRail } from './RunsRail.js';
import type { DevtoolsTab } from './types.js';

interface DevtoolsStudioProps {
  source: MessageEngineDevtoolsSource;
}

export const DevtoolsStudio = ({ source }: DevtoolsStudioProps) => {
  const snapshot = useSyncExternalStore<MessageEngineDevtoolsSnapshot>(
    source.subscribe,
    source.getSnapshot,
  );
  const runs = snapshot.runs;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(
    runs[0]?.sessionId,
  );
  const [selectedTurnIndex, setSelectedTurnIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<DevtoolsTab>('overview');

  const activeRun =
    runs.find((r: MessageEngineTraceRun) => r.sessionId === selectedSessionId) ?? runs[0];
  const selectedTurn = activeRun?.summary.turns[selectedTurnIndex];

  const handleSelectRun = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setSelectedTurnIndex(0);
  };

  const handleExportHtml = () => {
    if (!activeRun) return;
    const html = renderSessionTelemetryHtml(activeRun.summary);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `message-engine-trace-${activeRun.sessionId}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="linear-devtools-studio">
      <header className="linear-nav-header">
        <div className="nav-left">
          <a className="nav-brand-lockup" href="/">
            <div className="brand-gem" aria-hidden="true">
              <Sparkles size={12} />
            </div>
            <span className="brand-product">message-engine</span>
            <span className="nav-breadcrumb-slash">/</span>
            <span className="brand-page">Devtools</span>
            <span className="nav-version-badge">v0.3.1</span>
          </a>
        </div>

        <div className="nav-right">
          <div className="nav-session-pill is-active">
            <span className="session-pulse-orb" />
            <span className="session-status-text">
              {runs.length} {runs.length === 1 ? 'Run' : 'Runs'} Recorded
            </span>
          </div>

          <button
            className="nav-action-button"
            disabled={!activeRun}
            onClick={handleExportHtml}
            title="Export standalone telemetry HTML report"
            type="button"
          >
            <Download size={12} />
            <span>Export Report</span>
          </button>

          <a className="nav-action-button" href="/">
            <ArrowLeft size={12} />
            <span>Back to Studio</span>
          </a>

          <a
            className="nav-icon-button"
            href="https://github.com/Innei/message-engine"
            rel="noreferrer"
            target="_blank"
            title="GitHub Repository"
          >
            <svg aria-hidden="true" fill="currentColor" height="13" viewBox="0 0 16 16" width="13">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>
      </header>

      <div className="dt-workspace-grid">
        <RunsRail
          onSearchChange={setSearchQuery}
          onSelectRun={handleSelectRun}
          runs={runs}
          searchQuery={searchQuery}
          selectedSessionId={activeRun?.sessionId}
        />

        <main className="dt-center-stage">
          {activeRun ? (
            <CallTimeline
              onSelectTurn={setSelectedTurnIndex}
              run={activeRun}
              selectedTurnIndex={selectedTurnIndex}
            />
          ) : (
            <div className="dt-empty-notice">No trace runs recorded</div>
          )}
        </main>

        {activeRun ? (
          <DevtoolsInspector
            activeTab={activeTab}
            onTabChange={setActiveTab}
            run={activeRun}
            selectedTurn={selectedTurn}
          />
        ) : null}
      </div>
    </div>
  );
};
