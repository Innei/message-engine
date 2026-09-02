import { Clock, Flame, ShieldAlert, Shuffle } from 'lucide-react';

interface ChaosStudioProps {
  disabled: boolean;
  onMutatePrefix: () => void;
  onSimulateOrderSwap: () => void;
  onSimulateTimestampDrift: () => void;
  strict: boolean;
}

export const ChaosStudio = ({
  disabled,
  onMutatePrefix,
  onSimulateOrderSwap,
  onSimulateTimestampDrift,
  strict,
}: ChaosStudioProps) => {
  return (
    <div className="chaos-studio-panel">
      <div className="chaos-header-row">
        <div className="chaos-title-wrap">
          <ShieldAlert size={12} className="text-amber" />
          <span className="chaos-title">CHAOS EXPERIMENT</span>
        </div>
        <span className={`guard-badge ${strict ? 'badge-strict' : 'badge-relaxed'}`}>
          {strict ? 'Strict' : 'Relaxed'}
        </span>
      </div>

      <div className="chaos-actions-list">
        <div className="chaos-action-row">
          <div className="chaos-action-info">
            <Flame size={12} className="text-amber" />
            <span className="chaos-action-name">Mid-History Mutation</span>
          </div>
          <button
            className="chaos-mini-btn"
            disabled={disabled}
            onClick={onMutatePrefix}
            title="Attempt to edit committed turn content"
            type="button"
          >
            Trigger
          </button>
        </div>

        <div className="chaos-action-row">
          <div className="chaos-action-info">
            <Clock size={12} className="text-sky" />
            <span className="chaos-action-name">Timestamp Drift</span>
          </div>
          <button
            className="chaos-mini-btn"
            disabled={disabled}
            onClick={onSimulateTimestampDrift}
            title="Inject fluctuating timestamp into system context"
            type="button"
          >
            Inject
          </button>
        </div>

        <div className="chaos-action-row">
          <div className="chaos-action-info">
            <Shuffle size={12} className="text-purple" />
            <span className="chaos-action-name">Context Key Swap</span>
          </div>
          <button
            className="chaos-mini-btn"
            disabled={disabled}
            onClick={onSimulateOrderSwap}
            title="Swap key ordering in turn context"
            type="button"
          >
            Swap
          </button>
        </div>
      </div>
    </div>
  );
};
