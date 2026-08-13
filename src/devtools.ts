import type { SessionTokenSummary, TokenSourceSummary } from './token-types.js';

export {
  TELEMETRY_SOURCE_COLORS,
  telemetryArcPath,
  toTelemetrySunburst,
  type TelemetrySunburstArc,
  type TelemetrySunburstModel,
  type TelemetrySunburstSource,
} from './devtools-sunburst.js';

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
        <td><span class="swatch" style="background:${source.color}"></span>${escapeHtml(source.sourceType)}</td>
        <td>${formatNumber(source.tokens)}</td>
        <td>${formatPercent(source.percentage)}</td>
        <td>${formatNumber(source.characters)}</td>
        <td>$${source.cost.toFixed(6)}</td>
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
  const gradient =
    chartData.length === 0
      ? '#e8e8e8'
      : `conic-gradient(${chartData
          .reduce<Array<{ color: string; end: number; start: number }>>((items, datum) => {
            const start = items.at(-1)?.end ?? 0;
            items.push({ color: datum.color, end: start + datum.percentage * 100, start });
            return items;
          }, [])
          .map(({ color, end, start }) => `${color} ${start}% ${end}%`)
          .join(',')})`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Message engine telemetry · ${escapeHtml(summary.sessionId)}</title>
  <style>
    :root { color-scheme: light dark; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #f7f7f8; color: #202124; }
    main { max-width: 1120px; margin: 0 auto; padding: 40px 24px; }
    h1 { margin: 0 0 4px; font-size: 24px; } .muted { color: #687076; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap: 12px; margin: 24px 0; }
    .card, section { background: white; border: 1px solid #e4e4e7; border-radius: 12px; box-shadow: 0 1px 2px #0000000a; }
    .card { padding: 16px; } .card strong { display: block; margin-top: 6px; font-size: 22px; }
    section { margin: 16px 0; padding: 20px; overflow: auto; }
    .distribution { display: grid; grid-template-columns: 180px 1fr; gap: 28px; align-items: center; }
    .donut { width: 160px; aspect-ratio: 1; border-radius: 50%; background: ${gradient}; position: relative; }
    .donut::after { content: ''; position: absolute; inset: 30%; border-radius: 50%; background: white; }
    table { width: 100%; border-collapse: collapse; white-space: nowrap; }
    th, td { padding: 9px 12px; border-bottom: 1px solid #ececef; text-align: right; }
    th:first-child, td:first-child { text-align: left; } th { color: #687076; font-weight: 600; }
    .swatch { display: inline-block; width: 9px; height: 9px; margin-right: 8px; border-radius: 2px; }
    @media (max-width: 640px) { .distribution { grid-template-columns: 1fr; } .donut { margin: auto; } }
  </style>
</head>
<body><main>
  <h1>Session telemetry</h1>
  <div class="muted">${escapeHtml(summary.sessionId)} · ${escapeHtml(summary.instanceId)}</div>
  <div class="metrics">
    <div class="card">Processed tokens<strong>${formatNumber(summary.totalTokens)}</strong></div>
    <div class="card">Estimated cost<strong>$${summary.totalCost.toFixed(6)}</strong></div>
    <div class="card">Provider cache hit<strong>${formatPercent(summary.averageProviderCacheHitRate)}</strong></div>
    <div class="card">Prefix violations<strong>${summary.prefixViolations}</strong></div>
  </div>
  <section><h2>Token sources</h2><div class="distribution"><div class="donut" role="img" aria-label="Token source distribution"></div>
    <table><thead><tr><th>Source</th><th>Tokens</th><th>Share</th><th>Characters</th><th>Cost</th></tr></thead><tbody>${sourceRows}</tbody></table>
  </div></section>
  <section><h2>Turns</h2><table><thead><tr><th>Turn</th><th>Generation</th><th>Tokens</th><th>Internal reuse</th><th>Provider hit</th><th>Cost</th></tr></thead><tbody>${turnRows}</tbody></table></section>
</main></body></html>`;
};
