import { Activity, Database, FileText, Layers, Wrench, Zap } from 'lucide-react';

import type {
  MessageEngineTraceActivity,
  MessageEngineTraceRun,
} from '../../../src/devtools-recorder.js';
import type { SegmentTokenRecord, TurnTokenSnapshot } from '../../../src/token-types.js';
import { formatCost, formatInteger, formatPercent } from '../formatters.js';
import type { DevtoolsInspectorProps, DevtoolsTab } from './types.js';

const OverviewPane = ({
  run,
  selectedTurn,
}: {
  run: MessageEngineTraceRun;
  selectedTurn: TurnTokenSnapshot | undefined;
}) => {
  const summary = run.summary;

  return (
    <div className="dt-pane-overview">
      <div className="dt-pane-section">
        <span className="dt-pane-heading">RUN PROPERTIES</span>
        <dl className="dt-prop-table">
          <div className="dt-prop-row">
            <dt>Status</dt>
            <dd className="font-mono">
              <span className={`dt-tag ${run.status === 'error' ? 'tag-error' : 'tag-success'}`}>
                {run.status}
              </span>
            </dd>
          </div>
          <div className="dt-prop-row">
            <dt>Model</dt>
            <dd className="font-mono">{run.model ?? 'default'}</dd>
          </div>
          <div className="dt-prop-row">
            <dt>Provider</dt>
            <dd className="font-mono">{run.provider ?? 'openrouter'}</dd>
          </div>
          <div className="dt-prop-row">
            <dt>Total Input</dt>
            <dd className="font-mono">{formatInteger(summary.totalInputTokens)}t</dd>
          </div>
          <div className="dt-prop-row">
            <dt>Cache Read</dt>
            <dd className="font-mono text-emerald">
              {formatInteger(summary.totalCacheReadTokens)}t
            </dd>
          </div>
          <div className="dt-prop-row">
            <dt>Total Output</dt>
            <dd className="font-mono">{formatInteger(summary.totalOutputTokens)}t</dd>
          </div>
          <div className="dt-prop-row">
            <dt>Estimated Cost</dt>
            <dd className="font-mono">{formatCost(summary.totalCost)}</dd>
          </div>
        </dl>
      </div>

      {selectedTurn ? (
        <div className="dt-pane-section">
          <span className="dt-pane-heading">SELECTED CALL</span>
          <dl className="dt-prop-table">
            <div className="dt-prop-row">
              <dt>Turn ID</dt>
              <dd className="font-mono">{selectedTurn.turnId}</dd>
            </div>
            <div className="dt-prop-row">
              <dt>Prefix Reuse</dt>
              <dd className="font-mono text-emerald">
                {formatPercent(selectedTurn.cache.internalPrefixReuseRatio)}
              </dd>
            </div>
            <div className="dt-prop-row">
              <dt>Cache Read</dt>
              <dd className="font-mono">
                {formatInteger(selectedTurn.cache.cacheReadTokens ?? 0)}t
              </dd>
            </div>
            <div className="dt-prop-row">
              <dt>Uncached Input</dt>
              <dd className="font-mono">
                {formatInteger(selectedTurn.cache.uncachedInputTokens ?? 0)}t
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
};

const AnatomyPane = ({ selectedTurn }: { selectedTurn: TurnTokenSnapshot | undefined }) => {
  const segments = selectedTurn?.segments ?? [];

  return (
    <div className="dt-pane-anatomy">
      <div className="dt-pane-section">
        <span className="dt-pane-heading">ATTRIBUTED SEGMENTS ({segments.length})</span>
        <div className="dt-anatomy-table">
          {segments.map((seg: SegmentTokenRecord) => (
            <div className="dt-anatomy-row" key={seg.segmentId}>
              <div className="dt-anatomy-info">
                <span className="dt-seg-source">{seg.sourceType}</span>
                <span className="dt-seg-proc">{seg.processorId}</span>
              </div>
              <span className="dt-seg-tokens">{formatInteger(seg.tokens)}t</span>
              <span className={`dt-cache-status status-${seg.cacheStatus}`}>{seg.cacheStatus}</span>
            </div>
          ))}

          {segments.length === 0 ? (
            <div className="dt-pane-empty">Select a call to inspect segments</div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const ActivitiesPane = ({ activities }: { activities: MessageEngineTraceActivity[] }) => (
  <div className="dt-pane-activities">
    <span className="dt-pane-heading">AUDIT ACTIVITIES</span>
    <div className="dt-activities-stack">
      {activities.map((act) => (
        <div className="dt-activity-card" key={act.id}>
          <div className="dt-activity-top">
            <Wrench size={11} className="text-amber" />
            <span className="dt-activity-kind">{act.kind}</span>
            {act.status ? (
              <span className={`dt-status-tag tag-${act.status}`}>{act.status}</span>
            ) : null}
            {act.durationMs ? <span className="dt-activity-dur">{act.durationMs}ms</span> : null}
          </div>
          <strong className="dt-activity-label">{act.label}</strong>
          {act.detail ? <p className="dt-activity-detail">{act.detail}</p> : null}
        </div>
      ))}

      {activities.length === 0 ? (
        <div className="dt-pane-empty">No activities recorded in run</div>
      ) : null}
    </div>
  </div>
);

export const DevtoolsInspector = ({
  activeTab,
  onTabChange,
  run,
  selectedTurn,
}: DevtoolsInspectorProps) => {
  const renderActivePane = () => {
    if (activeTab === 'overview') {
      return <OverviewPane run={run} selectedTurn={selectedTurn} />;
    }
    if (activeTab === 'anatomy') {
      return <AnatomyPane selectedTurn={selectedTurn} />;
    }
    if (activeTab === 'activities') {
      return <ActivitiesPane activities={run.activities} />;
    }
    return (
      <div className="dt-pane-raw">
        <pre className="dt-raw-code">{JSON.stringify(selectedTurn ?? run.summary, null, 2)}</pre>
      </div>
    );
  };

  return (
    <aside className="dt-inspector-rail">
      <div className="dt-inspector-tab-strip">
        <button
          className={`dt-tab-btn ${activeTab === 'overview' ? 'is-active' : ''}`}
          onClick={() => onTabChange('overview')}
          type="button"
        >
          <Zap size={11} />
          <span>Overview</span>
        </button>

        <button
          className={`dt-tab-btn ${activeTab === 'anatomy' ? 'is-active' : ''}`}
          onClick={() => onTabChange('anatomy')}
          type="button"
        >
          <Layers size={11} />
          <span>Tokens</span>
        </button>

        <button
          className={`dt-tab-btn ${activeTab === 'activities' ? 'is-active' : ''}`}
          onClick={() => onTabChange('activities')}
          type="button"
        >
          <Activity size={11} />
          <span>Events</span>
        </button>

        <button
          className={`dt-tab-btn ${activeTab === 'raw' ? 'is-active' : ''}`}
          onClick={() => onTabChange('raw')}
          type="button"
        >
          <FileText size={11} />
          <span>JSON</span>
        </button>
      </div>

      <div className="dt-inspector-scroll-area">{renderActivePane()}</div>
    </aside>
  );
};
