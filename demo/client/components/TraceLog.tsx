import { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Info, Shuffle, Zap } from 'lucide-react';

import type { TraceEntry, TraceFilter } from '../types.js';

interface TraceLogProps {
  traces: TraceEntry[];
}

export const TraceLog = ({ traces }: TraceLogProps) => {
  const [filter, setFilter] = useState<TraceFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [traces]);

  const filteredTraces = traces.filter((trace) => {
    if (filter === 'all') return true;
    return trace.kind === filter;
  });

  const getBadgeIcon = (kind: TraceEntry['kind']) => {
    if (kind === 'error') return <AlertCircle size={10} />;
    if (kind === 'prefix') return <Shuffle size={10} />;
    if (kind === 'usage') return <Zap size={10} />;
    return <Info size={10} />;
  };

  const emptyFilterLabel = filter === 'all' ? 'runtime' : filter;
  return (
    <div className="trace-panel">
      <div className="trace-header">
        <div className="trace-title-group">
          <Activity size={13} className="trace-icon" />
          <span className="trace-title">Runtime Trace</span>
          <span className="trace-counter">{traces.length}</span>
        </div>

        <div className="trace-filter-pills">
          {(['all', 'usage', 'prefix', 'error'] as const).map((kind) => (
            <button
              className={`trace-filter-pill ${filter === kind ? 'is-active' : ''}`}
              key={kind}
              onClick={() => setFilter(kind)}
              type="button"
            >
              {kind}
            </button>
          ))}
        </div>
      </div>

      <div className="trace-feed" ref={scrollRef}>
        {filteredTraces.map((trace) => (
          <div className={`trace-item trace-kind-${trace.kind}`} key={trace.id}>
            <div className="trace-meta">
              <span className={`trace-kind-badge kind-${trace.kind}`}>
                {getBadgeIcon(trace.kind)}
                <span>{trace.kind}</span>
              </span>
              <time className="trace-time">{trace.time}</time>
            </div>
            <div className="trace-body">{trace.message}</div>
          </div>
        ))}

        {filteredTraces.length === 0 ? (
          <div className="trace-empty">
            <span>No {emptyFilterLabel} events recorded</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};
