import { Activity, Bot, Download, ExternalLink, Layers, Sparkles } from 'lucide-react';

import type { SessionTokenSummary } from '../../../src/index.js';
import type { DemoModelOption, DemoSessionState } from '../../shared/protocol.js';
import { shortId } from '../formatters.js';
import type { ActiveViewMode } from '../types.js';

interface LinearNavbarProps {
  activeView: ActiveViewMode;
  model: DemoModelOption | undefined;
  onExportHtml: () => void;
  onViewChange: (view: ActiveViewMode) => void;
  session: DemoSessionState | undefined;
  summary: SessionTokenSummary | undefined;
}

export const LinearNavbar = ({
  activeView,
  model,
  onExportHtml,
  onViewChange,
  session,
  summary,
}: LinearNavbarProps) => {
  const isSessionActive = Boolean(session);
  const statusLabel = isSessionActive ? `Active g${session?.generation ?? 0}` : 'Standby';
  const instanceLabel = session ? shortId(session.instanceId) : undefined;

  return (
    <header className="linear-nav-header">
      <div className="nav-left">
        <a className="nav-brand-lockup" href="/">
          <div className="brand-gem" aria-hidden="true">
            <Sparkles size={12} />
          </div>
          <span className="brand-product">message-engine</span>
          <span className="nav-breadcrumb-slash">/</span>
          <span className="brand-page">Studio</span>
        </a>
      </div>

      <div className="nav-center">
        <nav className="view-mode-tabs" aria-label="Studio views">
          <button
            className={`view-mode-tab ${activeView === 'playground' ? 'is-active' : ''}`}
            onClick={() => onViewChange('playground')}
            type="button"
          >
            <Bot size={12} />
            <span>Playground</span>
          </button>

          <button
            className={`view-mode-tab ${activeView === 'pipeline' ? 'is-active' : ''}`}
            onClick={() => onViewChange('pipeline')}
            type="button"
          >
            <Layers size={12} />
            <span>Stages</span>
          </button>

          <button
            className={`view-mode-tab ${activeView === 'telemetry' ? 'is-active' : ''}`}
            onClick={() => onViewChange('telemetry')}
            type="button"
          >
            <Activity size={12} />
            <span>Telemetry</span>
          </button>
        </nav>
      </div>

      <div className="nav-right">
        <div className={`nav-session-pill ${isSessionActive ? 'is-active' : 'is-idle'}`}>
          <span className="session-pulse-orb" />
          <span className="session-status-text">{statusLabel}</span>
          {instanceLabel ? <span className="session-instance-code">{instanceLabel}</span> : null}
        </div>

        <button
          className="nav-action-button"
          disabled={!summary}
          onClick={onExportHtml}
          title="Download standalone devtools HTML report"
          type="button"
        >
          <Download size={12} />
          <span>Export</span>
        </button>

        <a
          className="nav-action-button"
          href="/devtools.html"
          rel="noreferrer"
          target="_blank"
          title="Open dedicated Devtools inspector"
        >
          <ExternalLink size={12} />
          <span>Devtools</span>
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
  );
};
