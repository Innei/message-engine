import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Database,
  Layers,
  Maximize2,
  PieChart,
  Zap,
} from 'lucide-react';

import type { PrefixMutationEvent, TurnTokenSnapshot } from '../../../src/index.js';
import { formatCost, formatInteger, formatPercent, summarizeContextValue } from '../formatters.js';
import type { DemoContextStageState, DemoSessionState } from '../../shared/protocol.js';
import { TokenSunburst } from '../TokenSunburst.js';
import type { InspectorTab, TraceEntry } from '../types.js';
import { TokenMapModal } from './TokenMapModal.js';
import { TraceLog } from './TraceLog.js';

interface TelemetryDrawerProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  prefixEvent: PrefixMutationEvent | undefined;
  snapshot: TurnTokenSnapshot | undefined;
  state: DemoSessionState | undefined;
  traces: TraceEntry[];
}

const MetricsTab = ({
  latestTurn,
  snapshot,
  summary,
}: {
  latestTurn: TurnTokenSnapshot | undefined;
  snapshot: TurnTokenSnapshot | undefined;
  summary: DemoSessionState['summary'];
}) => {
  const segments = snapshot?.segments ?? [];

  return (
    <div className="tab-metrics-content">
      <div className="drawer-section-heading">
        <span className="heading-eyebrow">CACHE PERFORMANCE</span>
      </div>

      <div className="performance-summary-box">
        <div className="performance-figure-row">
          <span className="figure-label">Provider Hit Rate</span>
          <strong className="figure-number text-emerald">
            {formatPercent(summary?.averageProviderCacheHitRate)}
          </strong>
        </div>

        <div className="performance-stat-table">
          <div className="stat-table-row">
            <span>Internal Prefix Reuse</span>
            <strong>{formatPercent(latestTurn?.cache.internalPrefixReuseRatio)}</strong>
          </div>
          <div className="stat-table-row">
            <span>Cache-Read Tokens</span>
            <strong>{formatInteger(latestTurn?.cache.cacheReadTokens ?? 0)}</strong>
          </div>
          <div className="stat-table-row">
            <span>Uncached Input Tokens</span>
            <strong>{formatInteger(latestTurn?.cache.uncachedInputTokens ?? 0)}</strong>
          </div>
          <div className="stat-table-row">
            <span>Segment Accuracy</span>
            <strong>{snapshot?.segments[0]?.accuracy ?? '—'}</strong>
          </div>
        </div>
      </div>

      <div className="drawer-section-heading">
        <span className="heading-eyebrow">ATTRIBUTED SEGMENTS ({segments.length})</span>
      </div>

      <div className="drawer-segments-stack">
        {segments.map((seg: TurnTokenSnapshot['segments'][number]) => (
          <div className="drawer-segment-row" key={seg.segmentId}>
            <div className="segment-col-main">
              <span className="segment-source-name">{seg.sourceType}</span>
              <span className="segment-processor-code">{seg.processorId}</span>
            </div>
            <span className="segment-tokens-val">{formatInteger(seg.tokens)}</span>
            <span className={`segment-status-tag status-${seg.cacheStatus}`}>
              {seg.cacheStatus}
            </span>
          </div>
        ))}

        {segments.length === 0 ? (
          <div className="drawer-empty-notice">
            <span>Run a turn to inspect attributed token segments</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const StagesTab = ({ stages }: { stages: DemoContextStageState[] }) => (
  <div className="tab-stages-content">
    <div className="drawer-section-heading">
      <span className="heading-eyebrow">PIPELINE EXECUTION STAGES</span>
    </div>

    <div className="stages-timeline-list">
      {stages.map((stage: DemoContextStageState, idx: number) => {
        const replayTag = stage.replayed ? 'replayed' : `built ×${stage.buildCount}`;

        return (
          <div className="stage-timeline-card" key={stage.id}>
            <div className="stage-card-header">
              <span className="stage-number-chip">0{idx + 1}</span>
              <strong className="stage-name">{stage.phase}</strong>
              <span className={`stage-scope-chip scope-${stage.cacheScope}`}>
                {stage.cacheScope}
              </span>
            </div>

            <div className="stage-meta-row">
              <span className="stage-pos-text">{stage.modelPosition}</span>
              <span className="stage-token-count">{formatInteger(stage.tokens)} tokens</span>
            </div>

            <code className="stage-code-preview" title={stage.value}>
              {summarizeContextValue(stage.value)}
            </code>

            <div className="stage-footer-row">
              <span className="stage-execution-badge">{replayTag}</span>
              {stage.cacheStatus ? (
                <span className={`stage-cache-badge status-${stage.cacheStatus}`}>
                  {stage.cacheStatus}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}

      {stages.length === 0 ? (
        <div className="drawer-empty-notice">
          <span>Initialize an engine session to inspect pipeline stages</span>
        </div>
      ) : null}
    </div>
  </div>
);

export const TelemetryDrawer = ({
  activeTab,
  onTabChange,
  prefixEvent,
  snapshot,
  state,
  traces,
}: TelemetryDrawerProps) => {
  const [modalOpen, setModalOpen] = useState(false);

  const summary = state?.summary;
  const latestTurn = summary?.turns.at(-1);
  const activeSnapshot = latestTurn ?? snapshot;
  const stages = state?.contextStages ?? [];

  const renderActiveTabContent = () => {
    if (activeTab === 'metrics') {
      return <MetricsTab latestTurn={latestTurn} snapshot={snapshot} summary={summary} />;
    }
    if (activeTab === 'stages') {
      return <StagesTab stages={stages} />;
    }
    if (activeTab === 'anatomy') {
      return (
        <div className="tab-anatomy-content">
          <div className="drawer-section-heading">
            <span className="heading-eyebrow">TOKEN HIERARCHY SUNBURST</span>
            <button
              className="expand-dialog-trigger"
              disabled={!activeSnapshot}
              onClick={() => setModalOpen(true)}
              type="button"
            >
              <Maximize2 size={11} />
              <span>Enlarge</span>
            </button>
          </div>

          <div className="drawer-sunburst-box">
            <TokenSunburst snapshot={activeSnapshot} />
          </div>
        </div>
      );
    }
    return (
      <div className="tab-audit-content">
        <TraceLog traces={traces} />
      </div>
    );
  };

  return (
    <aside className="linear-telemetry-drawer">
      <div className="drawer-tab-navigation">
        <button
          className={`drawer-nav-tab ${activeTab === 'metrics' ? 'is-active' : ''}`}
          onClick={() => onTabChange('metrics')}
          type="button"
        >
          <Zap size={12} />
          <span>Metrics</span>
        </button>

        <button
          className={`drawer-nav-tab ${activeTab === 'stages' ? 'is-active' : ''}`}
          onClick={() => onTabChange('stages')}
          type="button"
        >
          <Layers size={12} />
          <span>Stages ({stages.length})</span>
        </button>

        <button
          className={`drawer-nav-tab ${activeTab === 'anatomy' ? 'is-active' : ''}`}
          onClick={() => onTabChange('anatomy')}
          type="button"
        >
          <PieChart size={12} />
          <span>Anatomy</span>
        </button>

        <button
          className={`drawer-nav-tab ${activeTab === 'audit' ? 'is-active' : ''}`}
          onClick={() => onTabChange('audit')}
          type="button"
        >
          <Activity size={12} />
          <span>Trace ({traces.length})</span>
        </button>
      </div>

      <div className="drawer-scroll-body">
        {prefixEvent ? (
          <div className={`drawer-prefix-alert alert-${prefixEvent.action}`}>
            <div className="alert-top-row">
              <AlertTriangle size={13} />
              <span className="alert-action-title">PREFIX {prefixEvent.action.toUpperCase()}</span>
            </div>
            <p className="alert-message">{prefixEvent.reason}</p>
            <div className="alert-sub-row">
              <span>First changed idx: {prefixEvent.firstChangedIndex}</span>
              <span className="gen-shift-label">
                g{prefixEvent.previousGeneration} <ArrowRight size={10} /> g
                {prefixEvent.nextGeneration}
              </span>
            </div>
          </div>
        ) : null}

        {renderActiveTabContent()}
      </div>

      {modalOpen ? (
        <TokenMapModal onClose={() => setModalOpen(false)} snapshot={activeSnapshot} />
      ) : null}
    </aside>
  );
};
