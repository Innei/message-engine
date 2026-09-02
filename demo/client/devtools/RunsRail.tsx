import { Search } from 'lucide-react';

import type { MessageEngineTraceRun } from '../../../src/devtools-recorder.js';
import { formatPercent } from '../formatters.js';
import type { RunsRailProps } from './types.js';

export const RunsRail = ({
  onSearchChange,
  onSelectRun,
  runs,
  searchQuery,
  selectedSessionId,
}: RunsRailProps) => {
  const filteredRuns = runs.filter((run) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const titleMatch = run.title?.toLowerCase().includes(query) ?? false;
    const modelMatch = run.model?.toLowerCase().includes(query) ?? false;
    const sessionMatch = run.sessionId.toLowerCase().includes(query);
    return titleMatch || modelMatch || sessionMatch;
  });

  return (
    <aside className="dt-runs-rail">
      <div className="dt-runs-search-wrap">
        <div className="dt-search-input-box">
          <Search size={12} className="dt-search-icon" />
          <input
            className="dt-search-input"
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search runs..."
            value={searchQuery}
          />
          <kbd className="dt-search-kbd">⌘K</kbd>
        </div>
      </div>

      <div className="dt-runs-head-row">
        <span className="dt-runs-head-label">RECORDED RUNS</span>
        <span className="dt-runs-head-count">{runs.length}</span>
      </div>

      <div className="dt-runs-cards-stack">
        {filteredRuns.map((run) => {
          const isSelected = run.sessionId === selectedSessionId;
          const isError = run.status === 'error';
          const callCount = run.summary.turns.length;
          const hitRate = run.summary.averageProviderCacheHitRate;

          let statusClass = 'dot-success';
          if (isError) statusClass = 'dot-error';

          return (
            <button
              className={`dt-run-card ${isSelected ? 'is-selected' : ''}`}
              key={run.sessionId}
              onClick={() => onSelectRun(run.sessionId)}
              type="button"
            >
              <div className="dt-run-card-top">
                <span className={`dt-run-status-dot ${statusClass}`} />
                <span className="dt-run-time-tag">
                  {run.startedAt
                    ? new Date(run.startedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : 'recorded'}
                </span>
                <span className="dt-run-calls-count">
                  {callCount} {callCount === 1 ? 'call' : 'calls'}
                </span>
              </div>

              <div className="dt-run-title-text">{run.title ?? run.sessionId}</div>

              <div className="dt-run-card-footer">
                <span className="dt-run-model-tag">{run.model ?? 'default'}</span>
                <span className="dt-run-cache-rate text-emerald">
                  {formatPercent(hitRate)} cache
                </span>
              </div>
            </button>
          );
        })}

        {filteredRuns.length === 0 ? (
          <div className="dt-runs-empty-state">
            <span>No runs match filter</span>
          </div>
        ) : null}
      </div>
    </aside>
  );
};
