import { ArrowDownRight, Layers, Lock, ShieldCheck, Zap } from 'lucide-react';

import type { TurnTokenSnapshot } from '../../../src/index.js';
import { formatCost, formatInteger, formatMultiplier, formatPercent } from '../formatters.js';
import type {
  DemoContextStageState,
  DemoModelOption,
  DemoSessionState,
} from '../../shared/protocol.js';

interface PrefixCacheRibbonProps {
  model: DemoModelOption | undefined;
  session: DemoSessionState | undefined;
  snapshot: TurnTokenSnapshot | undefined;
}

export const PrefixCacheRibbon = ({ model, session, snapshot }: PrefixCacheRibbonProps) => {
  const summary = session?.summary;
  const latestTurn = summary?.turns.at(-1);
  const activeSnapshot = latestTurn ?? snapshot;
  const stages = session?.contextStages ?? [];

  const cacheReadTokens = activeSnapshot?.cache.cacheReadTokens ?? 0;
  const uncachedTokens = activeSnapshot?.cache.uncachedInputTokens ?? 0;
  const totalInputTokens = cacheReadTokens + uncachedTokens;
  const hitRate = summary?.averageProviderCacheHitRate ?? 0;
  const actualCost = summary?.totalCost ?? 0;

  const inputRate = model?.inputPerMillion ?? 1;
  let theoreticalUncachedCost = 0;
  let totalSavedDollars = 0;

  if (totalInputTokens > 0) {
    theoreticalUncachedCost = (totalInputTokens * inputRate) / 1_000_000;
    if (theoreticalUncachedCost > actualCost) {
      totalSavedDollars = theoreticalUncachedCost - actualCost;
    }
  }

  let speedupMultiplier = 1.0;
  if (hitRate > 0) {
    speedupMultiplier = 1 / Math.max(0.12, 1 - hitRate * 0.85);
  }

  let cachedPercent = 0;
  let uncachedPercent = 0;
  if (totalInputTokens > 0) {
    cachedPercent = (cacheReadTokens / totalInputTokens) * 100;
    uncachedPercent = 100 - cachedPercent;
  }

  const systemStage = stages.find((s: DemoContextStageState) => s.phase === 'system');
  const sessionStage = stages.find((s: DemoContextStageState) => s.phase === 'stable-context');

  return (
    <div className="prefix-ribbon-container">
      <div className="ribbon-kpi-row">
        <div className="ribbon-stat-item">
          <span className="stat-caption">Provider Hit Rate</span>
          <strong className="stat-value text-emerald">
            {formatPercent(summary?.averageProviderCacheHitRate)}
          </strong>
        </div>

        <div className="ribbon-stat-item">
          <span className="stat-caption">Cumulative Cost Saved</span>
          <strong className="stat-value text-emerald">
            {totalSavedDollars > 0 ? `+${formatCost(totalSavedDollars)}` : '$0.000000'}
          </strong>
        </div>

        <div className="ribbon-stat-item">
          <span className="stat-caption">Prefill Speedup</span>
          <strong className="stat-value text-brand">{formatMultiplier(speedupMultiplier)}</strong>
        </div>

        <div className="ribbon-stat-item">
          <span className="stat-caption">Prefix Boundary Cutoff</span>
          <strong className="stat-value font-mono">
            {totalInputTokens > 0 ? `Token #${formatInteger(cacheReadTokens)}` : 'Standby'}
          </strong>
        </div>
      </div>

      <div className="ribbon-meter-wrapper">
        <div className="ribbon-progress-track">
          {totalInputTokens > 0 ? (
            <>
              <div
                className="ribbon-meter-cached"
                style={{ width: `${Math.max(cachedPercent, 8)}%` }}
                title={`KV-Cached: ${formatInteger(cacheReadTokens)} tokens (${cachedPercent.toFixed(1)}%)`}
              >
                <span>
                  KV-Cached: {formatInteger(cacheReadTokens)}t ({cachedPercent.toFixed(0)}%)
                </span>
              </div>
              <div
                className="ribbon-meter-uncached"
                style={{ width: `${Math.max(uncachedPercent, 8)}%` }}
                title={`Uncached Billed: ${formatInteger(uncachedTokens)} tokens`}
              >
                <span>Uncached: {formatInteger(uncachedTokens)}t</span>
              </div>
            </>
          ) : (
            <div className="ribbon-meter-standby">
              <span>Awaiting first turn to map prefix cache boundary</span>
            </div>
          )}
        </div>
      </div>

      <div className="ribbon-flow-legend">
        <div className="flow-pill flow-cached">
          <Lock size={10} />
          <span>System: {formatInteger(systemStage?.tokens ?? 0)}t</span>
        </div>
        <span className="flow-arrow">→</span>
        <div className="flow-pill flow-cached">
          <ShieldCheck size={10} />
          <span>Session: {formatInteger(sessionStage?.tokens ?? 0)}t</span>
        </div>
        <span className="flow-arrow">→</span>
        <div className="flow-pill flow-cached">
          <Layers size={10} />
          <span>
            History:{' '}
            {formatInteger(
              Math.max(
                0,
                cacheReadTokens - (systemStage?.tokens ?? 0) - (sessionStage?.tokens ?? 0),
              ),
            )}
            t
          </span>
        </div>
        <span className="flow-boundary-notch">╏ Cutoff</span>
        <div className="flow-pill flow-uncached">
          <Zap size={10} />
          <span>Turn Billed: +{formatInteger(uncachedTokens)}t</span>
        </div>
      </div>
    </div>
  );
};
