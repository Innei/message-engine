import { useState } from 'react';
import { Eye, EyeOff, Play, RotateCcw, Trash2 } from 'lucide-react';

import { formatInteger, formatRate } from '../formatters.js';
import type { LinearDocsSidebarProps } from '../types.js';
import { ChaosStudio } from './ChaosStudio.js';

const ContextSection = ({
  contextTab,
  onSessionContextChange,
  onTabChange,
  onTurnContextChange,
  sessionContext,
  streaming,
  turnContext,
}: {
  contextTab: 'session' | 'turn';
  onSessionContextChange: LinearDocsSidebarProps['onSessionContextChange'];
  onTabChange: (tab: 'session' | 'turn') => void;
  onTurnContextChange: LinearDocsSidebarProps['onTurnContextChange'];
  sessionContext: LinearDocsSidebarProps['sessionContext'];
  streaming: boolean;
  turnContext: LinearDocsSidebarProps['turnContext'];
}) => (
  <div className="sidebar-nav-section">
    <div className="section-label-row">
      <span className="section-label">CONTEXT INJECTION</span>
    </div>

    <div className="linear-tab-bar">
      <button
        className={`tab-bar-button ${contextTab === 'session' ? 'is-active' : ''}`}
        onClick={() => onTabChange('session')}
        type="button"
      >
        Session Scope
      </button>
      <button
        className={`tab-bar-button ${contextTab === 'turn' ? 'is-active' : ''}`}
        onClick={() => onTabChange('turn')}
        type="button"
      >
        Turn Scope
      </button>
    </div>

    {contextTab === 'session' ? (
      <div className="tab-field-stack">
        <div className="sidebar-field-block">
          <label className="field-mini-label" htmlFor="workspace-input">
            Workspace
          </label>
          <input
            className="linear-field-control"
            disabled={streaming}
            id="workspace-input"
            onChange={(e) =>
              onSessionContextChange((prev) => ({ ...prev, workspace: e.target.value }))
            }
            value={sessionContext.workspace}
          />
        </div>

        <div className="sidebar-field-block">
          <label className="field-mini-label" htmlFor="policy-select">
            Policy
          </label>
          <select
            className="linear-field-control"
            disabled={streaming}
            id="policy-select"
            onChange={(e) =>
              onSessionContextChange((prev) => ({ ...prev, policy: e.target.value }))
            }
            value={sessionContext.policy}
          >
            <option value="research-only">research-only</option>
            <option value="approval-required">approval-required</option>
            <option value="autonomous-sandbox">autonomous-sandbox</option>
          </select>
        </div>
      </div>
    ) : (
      <div className="tab-field-stack">
        <div className="sidebar-field-block">
          <label className="field-mini-label" htmlFor="route-input">
            Route
          </label>
          <input
            className="linear-field-control"
            disabled={streaming}
            id="route-input"
            onChange={(e) => onTurnContextChange((prev) => ({ ...prev, route: e.target.value }))}
            value={turnContext.route}
          />
        </div>

        <div className="sidebar-field-block">
          <label className="field-mini-label" htmlFor="selection-input">
            Selection
          </label>
          <input
            className="linear-field-control"
            disabled={streaming}
            id="selection-input"
            onChange={(e) =>
              onTurnContextChange((prev) => ({ ...prev, selection: e.target.value }))
            }
            value={turnContext.selection}
          />
        </div>
      </div>
    )}
  </div>
);

export const LinearDocsSidebar = ({
  apiKey,
  environmentKeyAvailable,
  modelId,
  models,
  onApiKeyChange,
  onModelChange,
  onMutatePrefix,
  onRestartSession,
  onSessionContextChange,
  onSimulateOrderSwap,
  onSimulateTimestampDrift,
  onStrictChange,
  onTeardownSession,
  onTurnContextChange,
  session,
  sessionContext,
  streaming,
  strict,
  turnContext,
}: LinearDocsSidebarProps) => {
  const [showKey, setShowKey] = useState(false);
  const [contextTab, setContextTab] = useState<'session' | 'turn'>('session');

  const selectedModel = models.find((m) => m.id === modelId);

  let keyBadge = 'Key required';
  let keyBadgeClass = 'badge-danger';
  if (environmentKeyAvailable) {
    keyBadge = 'Server env';
    keyBadgeClass = 'badge-success';
  } else if (apiKey.trim()) {
    keyBadge = 'Saved local';
    keyBadgeClass = 'badge-info';
  }

  return (
    <aside className="linear-docs-sidebar">
      <div className="sidebar-inner-scroll">
        <div className="sidebar-nav-section">
          <div className="section-label-row">
            <span className="section-label">RUNTIME CONFIG</span>
          </div>

          <div className="sidebar-field-block">
            <div className="field-label-split">
              <label htmlFor="model-select">Model</label>
              {selectedModel ? (
                <span className="field-meta-code">
                  {formatInteger(selectedModel.contextWindow)} ctx
                </span>
              ) : null}
            </div>

            <select
              className="linear-field-control"
              disabled={streaming}
              id="model-select"
              onChange={(e) => onModelChange(e.target.value)}
              value={modelId}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>

            {selectedModel ? (
              <div className="field-hint-code">
                <span>Rate: {formatRate(selectedModel.inputPerMillion)}</span>
              </div>
            ) : null}
          </div>

          <div className="sidebar-field-block">
            <div className="field-label-split">
              <label htmlFor="api-key-input">OpenRouter Key</label>
              <span className={`key-pill ${keyBadgeClass}`}>{keyBadge}</span>
            </div>

            <div className="input-affix-container">
              <input
                autoComplete="off"
                className="linear-field-control"
                id="api-key-input"
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder={
                  environmentKeyAvailable ? 'Using server environment key' : 'sk-or-v1-…'
                }
                spellCheck={false}
                type={showKey ? 'text' : 'password'}
                value={apiKey}
              />
              <button
                className="input-affix-action"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? 'Hide key' : 'Show key'}
                type="button"
              >
                {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
          </div>

          <label className="linear-toggle-row">
            <div className="toggle-text-col">
              <span className="toggle-headline">Strict Prefix Guard</span>
              <span className="toggle-byline">Block history mutations</span>
            </div>
            <input
              checked={strict}
              disabled={streaming}
              onChange={(e) => onStrictChange(e.target.checked)}
              type="checkbox"
            />
            <span className="toggle-visual-pill" />
          </label>

          <button
            className="linear-action-primary"
            disabled={streaming || models.length === 0}
            onClick={onRestartSession}
            type="button"
          >
            {session ? <RotateCcw size={12} /> : <Play size={12} />}
            <span>{session ? 'Restart Session' : 'Initialize Session'}</span>
          </button>
        </div>

        <ContextSection
          contextTab={contextTab}
          onSessionContextChange={onSessionContextChange}
          onTabChange={setContextTab}
          onTurnContextChange={onTurnContextChange}
          sessionContext={sessionContext}
          streaming={streaming}
          turnContext={turnContext}
        />

        <div className="sidebar-nav-section">
          <ChaosStudio
            disabled={!session || streaming}
            onMutatePrefix={onMutatePrefix}
            onSimulateOrderSwap={onSimulateOrderSwap}
            onSimulateTimestampDrift={onSimulateTimestampDrift}
            strict={strict}
          />
        </div>

        <div className="sidebar-nav-section">
          <button
            className="linear-action-ghost danger-tone"
            disabled={!session || streaming}
            onClick={onTeardownSession}
            type="button"
          >
            <Trash2 size={12} />
            <span>Teardown Session</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
