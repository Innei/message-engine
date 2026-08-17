import type { SessionTokenSummary, TokenSourceSummary } from './token-types.js';

export * from './devtools-recorder.js';
export {
  TELEMETRY_SOURCE_COLORS,
  telemetryArcPath,
  toTelemetrySunburst,
  type TelemetrySunburstArc,
  type TelemetrySunburstModel,
  type TelemetrySunburstSource,
} from './devtools-sunburst.js';
export * from './devtools-timeline.js';

export interface TelemetryChartDatum extends TokenSourceSummary {
  color: string;
}

const palette = [
  '#635bff',
  '#00a86b',
  '#e5484d',
  '#f5a623',
  '#0a84ff',
  '#8e4ec6',
  '#00a2c7',
  '#687076',
];

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character] ?? character,
  );

const formatNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);

const formatPercent = (value: number | undefined): string =>
  value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;

export const toTelemetryChartData = (summary: SessionTokenSummary): TelemetryChartDatum[] =>
  summary.sources.map((source, index) => ({
    ...source,
    color: palette[index % palette.length] ?? '#687076',
  }));

export const renderSessionTelemetryHtml = (summary: SessionTokenSummary): string => {
  const chartData = toTelemetryChartData(summary);
  const sourceRows = chartData
    .map(
      (source) => `<tr>
        <td class="source"><span class="swatch" style="--source:${source.color}"></span>${escapeHtml(source.sourceType)}</td>
        <td>${formatNumber(source.tokens)}</td>
        <td>${formatPercent(source.percentage)}</td>
        <td>${formatNumber(source.characters)}</td>
        <td>$${source.cost.toFixed(6)}</td>
        <td class="composition"><span style="--source:${source.color};--share:${source.percentage * 100}%"></span></td>
      </tr>`,
    )
    .join('');
  const turnRows = summary.turns
    .map(
      (turn) => `<tr>
        <td>${escapeHtml(turn.turnId)}</td>
        <td>${turn.generation}</td>
        <td>${formatNumber(turn.totalTokens)}</td>
        <td>${formatPercent(turn.cache.internalPrefixReuseRatio)}</td>
        <td>${formatPercent(turn.cache.providerCacheHitRate)}</td>
        <td>${turn.cost ? `$${turn.cost.total.toFixed(6)}` : 'n/a'}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Message engine telemetry · ${escapeHtml(summary.sessionId)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #090a0c;
      --surface: #0c0d10;
      --raised: #101116;
      --line: rgba(255,255,255,.055);
      --line-strong: rgba(255,255,255,.12);
      --text: rgba(255,255,255,.92);
      --secondary: rgba(255,255,255,.64);
      --tertiary: rgba(255,255,255,.44);
      --accent: #8b7cf6;
      --green: #4ed69c;
      font: 12px/1.4 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html {
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    body {
      min-width: 320px;
      margin: 0;
      padding: 20px;
      background: var(--bg);
      color: var(--text);
      font-variant-numeric: tabular-nums;
      text-rendering: optimizeLegibility;
    }
    .shell { max-width: 1240px; margin: 0 auto; border: 1px solid var(--line-strong); background: var(--bg); }
    .command { display: flex; align-items: center; min-height: 40px; border-bottom: 1px solid var(--line-strong); background: var(--surface); }
    .mark { display:block; width:13px; height:13px; margin:0 10px 0 12px; color:var(--accent); }
    .crumb { display:block; width:11px; height:11px; margin:0 6px; color:var(--tertiary); }
    .command strong { font-size:12px; font-weight:600; letter-spacing:-.01em; }
    .command span:last-child { color:var(--tertiary); font:10px ui-monospace,monospace; letter-spacing:.08em; text-transform:uppercase; }
    header { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:64px; padding:12px 14px; border-bottom:1px solid var(--line-strong); background:var(--surface); }
    header small { color:var(--tertiary); font:9px ui-monospace,monospace; letter-spacing:.1em; }
    h1 { margin:5px 0 0; font-size:16px; font-weight:580; letter-spacing:-.022em; text-wrap:balance; }
    .identity { margin-top:4px; color:var(--tertiary); font:10px ui-monospace,monospace; overflow-wrap:anywhere; }
    .ready { display:inline-flex; align-items:center; gap:6px; color:var(--green); font:9px ui-monospace,monospace; letter-spacing:.07em; text-transform:uppercase; }
    .ready svg { display:block; width:11px; height:11px; }
    .metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-bottom:1px solid var(--line-strong); background:var(--surface); }
    .metric { display:flex; align-items:baseline; justify-content:space-between; gap:8px; min-height:40px; padding:10px 12px; border-right:1px solid var(--line); }
    .metric:last-child { border-right:0; }
    .metric span,.section-title { color:var(--tertiary); font:9px ui-monospace,monospace; letter-spacing:.08em; text-transform:uppercase; }
    .metric strong { font:13px ui-monospace,monospace; font-variant-numeric:tabular-nums; font-weight:520; letter-spacing:-.02em; }
    section { overflow:auto; border-bottom:1px solid var(--line-strong); }
    .section-title { height:32px; margin:0; padding:10px 12px; background:var(--surface); }
    table { width:100%; min-width:720px; border-collapse:collapse; white-space:nowrap; font:11px ui-monospace,monospace; font-variant-numeric:tabular-nums; }
    th,td { height:32px; padding:0 12px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); text-align:right; font-weight:400; }
    th:last-child,td:last-child { border-right:0; }
    tr:last-child td { border-bottom:0; }
    th { background:var(--raised); color:var(--tertiary); font-size:9px; letter-spacing:.06em; text-transform:uppercase; }
    th:first-child,td:first-child { text-align:left; }
    tbody tr { transition-property:background-color; transition-duration:140ms; transition-timing-function:cubic-bezier(.2,0,0,1); }
    tbody tr:hover { background:rgba(139,124,246,.1); }
    .source { color:var(--secondary); }
    .swatch { display:inline-block; width:14px; height:1px; margin:0 8px 3px 0; background:var(--source); box-shadow:0 -2px var(--source); }
    .composition { width:24%; }
    .composition > span { position:relative; display:block; width:100%; height:10px; border-top:1px solid var(--line-strong); }
    .composition > span::after { position:absolute; top:-2px; left:0; width:var(--share); height:2px; background:var(--source); content:""; }
    footer { display:grid; grid-template-columns:minmax(0,1fr) repeat(2,max-content); min-height:28px; background:var(--surface); color:var(--tertiary); font:9px ui-monospace,monospace; font-variant-numeric:tabular-nums; letter-spacing:.04em; text-transform:uppercase; }
    footer span { overflow:hidden; padding:8px 10px; border-right:1px solid var(--line); text-overflow:ellipsis; white-space:nowrap; }
    footer span:last-child { border-right:0; }
    @media (max-width:640px) {
      body { padding:0; }
      .shell { border-width:0; }
      .metrics { grid-template-columns:repeat(2,1fr); }
      .metric:nth-child(2) { border-right:0; }
      .metric:nth-child(-n+2) { border-bottom:1px solid var(--line); }
      header { align-items:flex-start; gap:12px; }
    }
    @media print {
      body { padding:0; background:#fff; }
      .shell { max-width:none; }
    }
  </style>
</head>
<body><main class="shell">
  <div class="command"><svg class="mark" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg><strong>Message Engine</strong><svg class="crumb" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg><span>telemetry report</span></div>
  <header><div><small>REPORT / SESSION TELEMETRY</small><h1>${escapeHtml(summary.sessionId)}</h1><div class="identity">${escapeHtml(summary.instanceId)}</div></div><span class="ready"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>complete</span></header>
  <div class="metrics">
    <div class="metric"><span>Processed tokens</span><strong>${formatNumber(summary.totalTokens)}</strong></div>
    <div class="metric"><span>Estimated cost</span><strong>$${summary.totalCost.toFixed(6)}</strong></div>
    <div class="metric"><span>Provider cache hit</span><strong>${formatPercent(summary.averageProviderCacheHitRate)}</strong></div>
    <div class="metric"><span>Prefix violations</span><strong>${summary.prefixViolations}</strong></div>
  </div>
  <section><h2 class="section-title">Token sources</h2><table><thead><tr><th>Source</th><th>Tokens</th><th>Share</th><th>Characters</th><th>Cost</th><th>Composition</th></tr></thead><tbody>${sourceRows}</tbody></table></section>
  <section><h2 class="section-title">Turns</h2><table><thead><tr><th>Turn</th><th>Generation</th><th>Tokens</th><th>Internal reuse</th><th>Provider hit</th><th>Cost</th></tr></thead><tbody>${turnRows}</tbody></table></section>
  <footer><span>${escapeHtml(summary.sessionId)}</span><span>${summary.turns.length} turns</span><span>${summary.prefixViolations} violations</span></footer>
</main></body></html>`;
};
