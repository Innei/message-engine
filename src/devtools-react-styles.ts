export const MESSAGE_ENGINE_DEVTOOLS_CSS = String.raw`
[data-me-devtools] {
  --me-bg: #090a0c;
  --me-surface: #0c0d10;
  --me-surface-raised: #101116;
  --me-surface-active: #16171f;
  --me-line: rgba(255, 255, 255, 0.055);
  --me-line-strong: rgba(255, 255, 255, 0.12);
  --me-grid: rgba(255, 255, 255, 0.038);
  --me-text: rgba(255, 255, 255, 0.92);
  --me-text-secondary: rgba(255, 255, 255, 0.64);
  --me-text-tertiary: rgba(255, 255, 255, 0.44);
  --me-accent: #8b7cf6;
  --me-accent-soft: rgba(139, 124, 246, 0.12);
  --me-green: #4ed69c;
  --me-yellow: #e6b857;
  --me-red: #ef6b73;
  --me-run-rail-width: 216px;
  --me-font: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --me-mono: "SFMono-Regular", "Cascadia Code", "Roboto Mono", ui-monospace, monospace;
  --me-ease: cubic-bezier(0.2, 0, 0, 1);
  --me-duration: 140ms;
  color-scheme: dark;
}

[data-me-devtools][data-theme="light"] {
  --me-bg: #f4f4f2;
  --me-surface: #fafaf8;
  --me-surface-raised: #ffffff;
  --me-surface-active: #eceaf6;
  --me-line: rgba(20, 20, 24, 0.08);
  --me-line-strong: rgba(20, 20, 24, 0.16);
  --me-grid: rgba(20, 20, 24, 0.045);
  --me-text: rgba(20, 20, 24, 0.92);
  --me-text-secondary: rgba(20, 20, 24, 0.6);
  --me-text-tertiary: rgba(20, 20, 24, 0.4);
  --me-accent-soft: rgba(105, 84, 220, 0.1);
  color-scheme: light;
}

@media (prefers-color-scheme: light) {
  [data-me-devtools][data-theme="system"] {
    --me-bg: #f4f4f2;
    --me-surface: #fafaf8;
    --me-surface-raised: #ffffff;
    --me-surface-active: #eceaf6;
    --me-line: rgba(20, 20, 24, 0.08);
    --me-line-strong: rgba(20, 20, 24, 0.16);
    --me-grid: rgba(20, 20, 24, 0.045);
    --me-text: rgba(20, 20, 24, 0.92);
    --me-text-secondary: rgba(20, 20, 24, 0.6);
    --me-text-tertiary: rgba(20, 20, 24, 0.4);
    --me-accent-soft: rgba(105, 84, 220, 0.1);
    color-scheme: light;
  }
}

[data-me-devtools],
[data-me-devtools] *,
[data-me-devtools] *::before,
[data-me-devtools] *::after { box-sizing: border-box; }

[data-me-devtools] button,
[data-me-devtools] input,
[data-me-devtools] select { color: inherit; font: inherit; }

[data-me-devtools] button:focus-visible,
[data-me-devtools] input:focus-visible,
[data-me-devtools] select:focus-visible {
  outline: 1px solid var(--me-accent);
  outline-offset: -1px;
}

.me-devtools {
  container-name: message-engine-devtools;
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 640px;
  overflow: hidden;
  border: 1px solid var(--me-line-strong);
  border-radius: 2px;
  background: var(--me-bg);
  color: var(--me-text);
  font-family: var(--me-font);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

.me-command-bar {
  display: grid;
  grid-row: 1;
  grid-template-columns: var(--me-run-rail-width) minmax(180px, 1fr) max-content;
  align-items: stretch;
  min-height: 40px;
  border-bottom: 1px solid var(--me-line-strong);
  background: var(--me-surface);
}

.me-product-mark {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 100%;
  padding: 0 12px;
  border-right: 1px solid var(--me-line);
  white-space: nowrap;
}

.me-product-mark > i {
  position: relative;
  flex: 0 0 auto;
  width: 11px;
  height: 11px;
  border: 1px solid var(--me-text-secondary);
}

.me-product-mark > i::before,
.me-product-mark > i::after { position: absolute; background: var(--me-accent); content: ""; }
.me-product-mark > i::before { inset: 4px -3px auto; height: 1px; }
.me-product-mark > i::after { inset: -3px auto -3px 4px; width: 1px; }
.me-product-mark strong { overflow: hidden; font-size: 12px; font-weight: 600; letter-spacing: -0.01em; text-overflow: ellipsis; }
.me-product-mark span { color: var(--me-text-tertiary); }
.me-product-mark small { color: var(--me-text-secondary); font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; }

.me-run-search {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  min-width: 0;
  height: 100%;
  padding: 0 8px 0 2px;
  border-right: 1px solid var(--me-line);
  background: var(--me-bg);
  color: var(--me-text-tertiary);
  transition-property: background-color, border-color;
  transition-duration: var(--me-duration);
  transition-timing-function: var(--me-ease);
}

.me-run-search:focus-within { background: var(--me-surface-raised); border-color: var(--me-line-strong); }
.me-run-search > span { display: grid; place-items: center; height: 100%; font-family: var(--me-mono); font-size: 12px; }
.me-run-search input { min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--me-text); font-size: 12px; }
.me-run-search input::placeholder { color: var(--me-text-tertiary); }
.me-run-search input::-webkit-search-cancel-button { display: none; }
.me-run-search kbd { margin-right: 4px; padding: 2px 5px; border: 1px solid var(--me-line); color: var(--me-text-tertiary); font: 9px/1 var(--me-mono); }

.me-command-actions { display: flex; align-items: stretch; justify-content: flex-end; }
.me-command-actions .me-status-mark { padding: 0 12px; align-self: center; }

.me-command-actions > button {
  position: relative;
  min-width: 72px;
  padding: 0 14px;
  border: 0;
  border-left: 1px solid var(--me-line);
  background: transparent;
  color: var(--me-text-secondary);
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transition-property: background-color, color, transform;
  transition-duration: var(--me-duration);
  transition-timing-function: var(--me-ease);
}

.me-command-actions > button:hover:not(:disabled) { background: var(--me-surface-active); color: var(--me-text); }
.me-command-actions > button:active:not(:disabled) { transform: scale(0.96); }
.me-command-actions > button:disabled { cursor: default; opacity: 0.35; }

.me-status-mark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--me-text-secondary);
  font: 9px/1 var(--me-mono);
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.me-status-mark i,
.me-run-state { width: 6px; height: 6px; border-radius: 50%; background: var(--me-text-tertiary); }
.me-status-mark[data-status="success"] i,
.me-run-state[data-status="success"] { background: var(--me-green); }
.me-status-mark[data-status="running"] i,
.me-run-state[data-status="running"] { background: var(--me-accent); box-shadow: 0 0 0 3px var(--me-accent-soft); }
.me-status-mark[data-status="error"] i,
.me-run-state[data-status="error"] { background: var(--me-red); }

.me-mobile-run-picker { display: none; grid-row: 2; }

.me-workbench,
.me-devtools-empty {
  grid-row: 3;
}

.me-workbench {
  display: grid;
  grid-template-columns: var(--me-run-rail-width) minmax(0, 1fr) 328px;
  min-width: 0;
  min-height: 0;
}

.me-run-rail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-right: 1px solid var(--me-line-strong);
  background: var(--me-surface);
}

.me-rail-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 10px;
  border-bottom: 1px solid var(--me-line);
  background: var(--me-surface);
  color: var(--me-text-tertiary);
  font: 9px/1 var(--me-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.me-rail-head strong { color: var(--me-text-secondary); font-weight: 500; }
.me-run-list { display: grid; align-content: start; }

.me-run-item {
  display: grid;
  grid-template-columns: 34px 6px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  width: 100%;
  min-height: 48px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--me-line);
  background: transparent;
  color: var(--me-text-secondary);
  text-align: left;
  cursor: pointer;
  transition-property: background-color, color, box-shadow;
  transition-duration: var(--me-duration);
  transition-timing-function: var(--me-ease);
}

.me-run-item:hover { background: var(--me-surface-raised); color: var(--me-text); }
.me-run-item[data-selected="true"] { background: var(--me-accent-soft); color: var(--me-text); box-shadow: inset 2px 0 var(--me-accent); }
.me-run-time, .me-run-duration { padding-top: 2px; color: var(--me-text-tertiary); font: 9px/1.2 var(--me-mono); font-variant-numeric: tabular-nums; }
.me-run-state { margin-top: 4px; }
.me-run-copy { min-width: 0; }
.me-run-copy strong, .me-run-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.me-run-copy strong { font-size: 11px; font-weight: 560; letter-spacing: -0.01em; }
.me-run-copy small { margin-top: 3px; color: var(--me-text-tertiary); font: 9px/1.2 var(--me-mono); }

.me-trace-workspace {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--me-bg);
}

.me-run-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 64px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--me-line-strong);
  background: var(--me-surface);
}

.me-run-header > div { min-width: 0; }
.me-run-header > div > span { color: var(--me-text-tertiary); font: 9px/1 var(--me-mono); letter-spacing: 0.1em; }
.me-run-header h2 { overflow: hidden; margin: 5px 0 0; color: var(--me-text); font-size: 16px; font-weight: 580; letter-spacing: -0.022em; line-height: 1.2; text-overflow: ellipsis; text-wrap: balance; white-space: nowrap; }
.me-run-header p { overflow: hidden; margin: 4px 0 0; color: var(--me-text-tertiary); font: 10px/1.3 var(--me-mono); text-overflow: ellipsis; text-wrap: pretty; white-space: nowrap; }

.me-run-metrics {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid var(--me-line-strong);
  background: var(--me-surface);
}

.me-run-metrics > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  min-height: 40px;
  padding: 10px 12px;
  border-right: 1px solid var(--me-line);
}

.me-run-metrics > div:last-child { border-right: 0; }
.me-run-metrics span { color: var(--me-text-tertiary); font: 9px/1 var(--me-mono); letter-spacing: 0.08em; text-transform: uppercase; }
.me-run-metrics strong { overflow: hidden; color: var(--me-text); font: 13px/1 var(--me-mono); font-variant-numeric: tabular-nums; font-weight: 520; letter-spacing: -0.02em; text-overflow: ellipsis; white-space: nowrap; }

.me-prefix-alert {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--me-red) 32%, transparent);
  background: color-mix(in srgb, var(--me-red) 8%, var(--me-bg));
  color: var(--me-red);
  text-align: left;
  cursor: pointer;
  transition-property: background-color;
  transition-duration: var(--me-duration);
  transition-timing-function: var(--me-ease);
}

.me-prefix-alert:hover { background: color-mix(in srgb, var(--me-red) 12%, var(--me-bg)); }
.me-prefix-alert span { font: 9px/1 var(--me-mono); letter-spacing: 0.08em; }
.me-prefix-alert strong { overflow: hidden; color: var(--me-text); font-size: 11px; font-weight: 520; text-overflow: ellipsis; white-space: nowrap; }
.me-prefix-alert i { color: var(--me-text-secondary); font: 10px/1 var(--me-mono); font-style: normal; }

.me-trace-table { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 620px; min-height: 0; background: var(--me-bg); }
.me-trace-head,
.me-trace-turn { display: grid; flex: 0 0 auto; grid-template-columns: 108px minmax(280px, 1fr) 68px 68px; }

.me-trace-head {
  position: sticky;
  top: 0;
  z-index: 2;
  min-height: 32px;
  border-bottom: 1px solid var(--me-line-strong);
  background: var(--me-surface);
  color: var(--me-text-tertiary);
  font: 9px/1 var(--me-mono);
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.me-trace-head > span,
.me-trace-head > .me-trace-ruler { padding: 10px 10px 8px; border-right: 1px solid var(--me-line); }
.me-trace-head > span:nth-last-child(-n + 2) { text-align: right; }

.me-trace-ruler { position: relative; min-width: 0; }
.me-trace-ruler > span { position: relative; z-index: 1; }
.me-trace-ruler > i {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  border-left: 1px solid var(--me-line);
  color: var(--me-text-tertiary);
  font-style: normal;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  text-indent: 4px;
  text-transform: none;
}
.me-trace-ruler > i:last-child { transform: translateX(-100%); text-indent: -4px; }

.me-trace-turn {
  position: relative;
  min-height: 64px;
  border-bottom: 1px solid var(--me-line);
  background: var(--me-bg);
  transition-property: background-color, box-shadow;
  transition-duration: var(--me-duration);
  transition-timing-function: var(--me-ease);
}

.me-trace-turn:hover { background: var(--me-surface); }
.me-trace-turn[data-selected="true"] { background: var(--me-accent-soft); box-shadow: inset 2px 0 var(--me-accent); }
.me-trace-turn > * { min-width: 0; border-right: 1px solid var(--me-line); }
.me-trace-turn > *:last-child { border-right: 0; }

.me-call-cell,
.me-call-metric {
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition-property: background-color, color, transform;
  transition-duration: var(--me-duration);
  transition-timing-function: var(--me-ease);
}

.me-call-cell:hover,
.me-call-metric:hover { background: color-mix(in srgb, var(--me-surface-raised) 70%, transparent); }
.me-call-cell:active,
.me-call-metric:active { transform: scale(0.96); }
.me-call-cell { padding: 12px 10px; }
.me-call-cell strong, .me-call-cell span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.me-call-cell strong { color: var(--me-text); font: 11px/1.2 var(--me-mono); font-weight: 600; letter-spacing: -0.01em; }
.me-call-cell span { margin-top: 4px; color: var(--me-text-tertiary); font: 9px/1.2 var(--me-mono); }
.me-call-metric { padding: 12px 8px; text-align: right; }
.me-call-metric span, .me-call-metric small { display: block; }
.me-call-metric span { color: var(--me-text); font: 11px/1.2 var(--me-mono); font-variant-numeric: tabular-nums; }
.me-call-metric small { margin-top: 4px; color: var(--me-text-tertiary); font: 9px/1.2 var(--me-mono); }

.me-trace-cell { padding: 12px 10px 10px; }
.me-token-grid {
  position: relative;
  height: 28px;
  background-image: linear-gradient(90deg, var(--me-line) 1px, transparent 1px);
  background-size: 25% 100%;
}

.me-token-bar {
  display: flex;
  width: var(--me-bar-width);
  height: 18px;
  border: 1px solid var(--me-line-strong);
  background: var(--me-surface-raised);
}

.me-trace-segment {
  position: relative;
  min-width: 2px;
  height: 100%;
  overflow: visible;
  padding: 0;
  border: 0;
  border-top: 2px solid var(--me-segment-color);
  border-right: 1px solid color-mix(in srgb, var(--me-segment-color) 36%, var(--me-line));
  background: color-mix(in srgb, var(--me-segment-color) 14%, transparent);
  cursor: crosshair;
  transition-property: background-color, opacity;
  transition-duration: 120ms;
  transition-timing-function: var(--me-ease);
}

.me-trace-segment::after { position: absolute; top: 50%; right: 0; left: 0; height: 40px; transform: translateY(-50%); content: ""; }
.me-trace-segment:hover,
.me-trace-segment[data-selected="true"] { z-index: 1; background: color-mix(in srgb, var(--me-segment-color) 34%, transparent); outline: 1px solid var(--me-segment-color); outline-offset: -1px; }
.me-trace-segment[data-boundary="true"] { box-shadow: inset 1px 0 var(--me-text-secondary); }
.me-segment-cache { position: absolute; inset: 2px auto 0 0; z-index: 1; width: var(--me-cache-width); background: repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in srgb, var(--me-segment-color) 42%, transparent) 3px 4px); }
.me-injected-mark { position: absolute; top: -7px; right: -2px; z-index: 2; color: var(--me-yellow); font: 8px/1 var(--me-mono); }
.me-cache-range { position: absolute; bottom: 2px; left: 0; width: var(--me-cache-line-width); height: 2px; background: var(--me-green); }
.me-cache-range::after { position: absolute; top: -2px; right: -1px; width: 1px; height: 6px; background: var(--me-green); content: ""; }

.me-activity-list { position: relative; margin-top: 6px; }
.me-activity-list::before { position: absolute; top: -2px; bottom: 10px; left: 6px; width: 1px; background: var(--me-line-strong); content: ""; }
.me-activity-row { display: grid; grid-template-columns: 13px 6px minmax(72px, auto) minmax(0, 1fr) auto; gap: 6px; align-items: center; min-height: 20px; color: var(--me-text-secondary); font: 9px/1.3 var(--me-mono); }
.me-tree-joint { width: 7px; height: 8px; margin-left: 6px; border-bottom: 1px solid var(--me-line-strong); }
.me-event-mark { width: 5px; height: 5px; border: 1px solid currentColor; background: var(--me-bg); transform: rotate(45deg); }
.me-activity-row strong { overflow: hidden; color: var(--me-text); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.me-activity-row > span:nth-of-type(2) { overflow: hidden; text-overflow: ellipsis; text-wrap: pretty; white-space: nowrap; }
.me-activity-row time { color: var(--me-text-tertiary); font-variant-numeric: tabular-nums; }
.me-activity-row[data-status="warning"] { color: var(--me-yellow); }
.me-activity-row[data-status="error"] { color: var(--me-red); }
.me-activity-row[data-status="success"] .me-event-mark { color: var(--me-green); }
.me-inline-warning { margin-top: 6px; padding-left: 18px; color: var(--me-yellow); font: 9px/1.35 var(--me-mono); text-wrap: pretty; }
.me-trace-floor { flex: 1 1 auto; min-height: 16px; background: var(--me-bg); }

.me-inspector {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-left: 1px solid var(--me-line-strong);
  background: var(--me-surface);
}

.me-inspector-tabs {
  position: sticky;
  top: 0;
  z-index: 3;
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  height: 40px;
  border-bottom: 1px solid var(--me-line-strong);
  background: var(--me-surface);
}

.me-inspector-tabs button {
  position: relative;
  overflow: hidden;
  padding: 0 4px;
  border: 0;
  border-right: 1px solid var(--me-line);
  background: transparent;
  color: var(--me-text-tertiary);
  font: 8px/1 var(--me-mono);
  letter-spacing: 0.03em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
  transition-property: background-color, color, transform;
  transition-duration: var(--me-duration);
  transition-timing-function: var(--me-ease);
}
.me-inspector-tabs button:last-child { border-right: 0; }
.me-inspector-tabs button:hover { color: var(--me-text); }
.me-inspector-tabs button:active { transform: scale(0.96); }
.me-inspector-tabs button[aria-selected="true"] { color: var(--me-text); }
.me-inspector-tabs button[aria-selected="true"]::after { position: absolute; right: 0; bottom: 0; left: 0; height: 1px; background: var(--me-accent); content: ""; }
.me-inspector-pane { flex: 1 1 auto; min-width: 0; }

.me-inspector-section { border-bottom: 1px solid var(--me-line); }
.me-inspector-section h3 { height: 32px; margin: 0; padding: 10px 10px 0; color: var(--me-text-tertiary); font: 9px/1 var(--me-mono); letter-spacing: 0.08em; text-transform: uppercase; }
.me-property-grid { margin: 0; }
.me-property-row { display: grid; grid-template-columns: 104px minmax(0, 1fr); min-height: 32px; border-top: 1px solid var(--me-line); }
.me-property-row dt, .me-property-row dd { min-width: 0; margin: 0; padding: 8px 10px; }
.me-property-row dt { border-right: 1px solid var(--me-line); color: var(--me-text-tertiary); font: 9px/1.3 var(--me-mono); letter-spacing: 0.04em; text-transform: uppercase; }
.me-property-row dd { overflow-wrap: anywhere; color: var(--me-text-secondary); font: 11px/1.4 var(--me-mono); font-variant-numeric: tabular-nums; text-wrap: pretty; }

.me-blueprint { min-width: 300px; }
.me-blueprint-head,
.me-blueprint-source-row,
.me-blueprint-module-row,
.me-blueprint-segment { display: grid; grid-template-columns: minmax(116px, 1fr) 46px 52px 82px; align-items: center; }
.me-blueprint-head { position: sticky; top: 40px; z-index: 2; height: 28px; border-bottom: 1px solid var(--me-line-strong); background: var(--me-surface); color: var(--me-text-tertiary); font: 8px/1 var(--me-mono); letter-spacing: 0.06em; text-transform: uppercase; }
.me-blueprint-head > *, .me-blueprint-source-row > *, .me-blueprint-module-row > *, .me-blueprint-segment > * { min-width: 0; padding: 0 8px; border-right: 1px solid var(--me-line); }
.me-blueprint-head > * { padding-right: 6px; padding-left: 6px; white-space: nowrap; }
.me-blueprint-head > *:last-child, .me-blueprint-source-row > *:last-child, .me-blueprint-module-row > *:last-child, .me-blueprint-segment > *:last-child { border-right: 0; }
.me-blueprint-source { border-bottom: 1px solid var(--me-line-strong); }
.me-blueprint-source-row { min-height: 32px; background: var(--me-surface-raised); color: var(--me-text); font: 9px/1 var(--me-mono); text-transform: uppercase; }
.me-blueprint-source-row strong { font-weight: 600; letter-spacing: 0.05em; }
.me-blueprint-module-row { min-height: 24px; color: var(--me-text-tertiary); font: 9px/1 var(--me-mono); }
.me-blueprint-module-row > span:first-child { padding-left: 16px; }
.me-blueprint-segment {
  width: 100%;
  min-height: 40px;
  padding: 0;
  border: 0;
  border-top: 1px solid var(--me-line);
  background: transparent;
  color: var(--me-text-secondary);
  font: 10px/1.2 var(--me-mono);
  text-align: left;
  cursor: pointer;
  transition-property: background-color, color, box-shadow;
  transition-duration: var(--me-duration);
  transition-timing-function: var(--me-ease);
}
.me-blueprint-segment > span:first-child { overflow: hidden; padding-left: 26px; text-overflow: ellipsis; white-space: nowrap; }
.me-blueprint-segment:hover, .me-blueprint-segment[data-selected="true"] { background: var(--me-accent-soft); color: var(--me-text); }
.me-blueprint-segment[data-selected="true"] { box-shadow: inset 2px 0 var(--me-accent); }
.me-blueprint-meter { position: relative; display: block; height: 100%; min-height: 18px; }
.me-blueprint-meter::before { position: absolute; top: 50%; right: 8px; left: 8px; height: 1px; background: var(--me-line-strong); content: ""; }
.me-blueprint-meter i { position: absolute; top: calc(50% - 1px); left: 8px; width: min(var(--me-meter-width), calc(100% - 16px)); height: 2px; background: var(--me-meter-color); }

.me-segment-detail .me-property-row { grid-template-columns: 86px minmax(0, 1fr); }
.me-cache-diagnostic { padding: 12px; border-bottom: 1px solid color-mix(in srgb, var(--me-yellow) 28%, transparent); background: color-mix(in srgb, var(--me-yellow) 7%, var(--me-surface)); }
.me-cache-diagnostic span { color: var(--me-yellow); font: 9px/1 var(--me-mono); letter-spacing: 0.08em; }
.me-cache-diagnostic p { margin: 6px 0 0; color: var(--me-text-secondary); font-size: 11px; text-wrap: pretty; }
.me-mutation-list > div { display: grid; grid-template-columns: 58px 1fr; gap: 3px 8px; min-height: 40px; padding: 10px; border-bottom: 1px solid var(--me-line); font: 9px/1.35 var(--me-mono); }
.me-mutation-list span { color: var(--me-red); text-transform: uppercase; }
.me-mutation-list strong { color: var(--me-text); font-weight: 500; }
.me-mutation-list small { grid-column: 2; color: var(--me-text-tertiary); }
.me-raw-pane { min-height: 100%; background-image: linear-gradient(var(--me-grid) 1px, transparent 1px); background-size: 100% 22px; }
.me-raw-pane pre { margin: 0; padding: 12px; color: var(--me-text-secondary); font: 10px/1.55 var(--me-mono); overflow-wrap: anywhere; white-space: pre-wrap; }

.me-empty-pane { display: grid; place-items: center; align-content: center; gap: 10px; min-height: 96px; padding: 24px 16px; color: var(--me-text-tertiary); text-align: center; }
.me-empty-pane p { display: grid; gap: 4px; margin: 0; font-size: 11px; text-wrap: pretty; }
.me-empty-pane strong { color: var(--me-text-secondary); font-weight: 550; }
.me-empty-cross { position: relative; width: 22px; height: 22px; border: 1px solid var(--me-line-strong); }
.me-empty-cross::before, .me-empty-cross::after { position: absolute; background: var(--me-line-strong); content: ""; }
.me-empty-cross::before { top: 10px; right: -5px; left: -5px; height: 1px; }
.me-empty-cross::after { top: -5px; bottom: -5px; left: 10px; width: 1px; }
.me-devtools-empty { display: grid; min-height: 360px; }

.me-status-bar {
  display: grid;
  grid-row: 4;
  grid-template-columns: minmax(0, 1fr) repeat(3, max-content) max-content;
  align-items: center;
  min-height: 28px;
  border-top: 1px solid var(--me-line-strong);
  background: var(--me-surface);
  color: var(--me-text-tertiary);
  font: 9px/1 var(--me-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.me-status-bar > span { overflow: hidden; padding: 0 10px; border-right: 1px solid var(--me-line); text-overflow: ellipsis; white-space: nowrap; }
.me-status-bar > span:last-child { border-right: 0; }
.me-connection-state { color: var(--me-green); }
.me-connection-state::before { display: inline-block; width: 5px; height: 5px; margin-right: 6px; border-radius: 50%; background: currentColor; content: ""; }

.me-trace-viewer { grid-template-rows: minmax(0, 1fr); }
.me-viewer-grid { display: grid; grid-template-columns: minmax(0, 1fr) 328px; min-width: 0; min-height: 0; }

@container message-engine-devtools (max-width: 980px) {
  .me-command-bar, .me-workbench { --me-run-rail-width: 184px; }
  .me-workbench { grid-template-columns: var(--me-run-rail-width) minmax(0, 1fr); }
  .me-run-rail { grid-row: 1 / span 2; }
  .me-inspector { grid-column: 2; border-top: 1px solid var(--me-line-strong); border-left: 0; min-height: 320px; }
  .me-viewer-grid { grid-template-columns: 1fr; }
  .me-viewer-grid .me-inspector { grid-column: 1; }
}

@container message-engine-devtools (max-width: 680px) {
  .me-devtools { min-height: 0; overflow: hidden; grid-template-rows: auto auto auto auto; }
  .me-command-bar { grid-template-columns: minmax(0, 1fr) auto; }
  .me-run-search { grid-column: 1 / -1; grid-row: 2; height: 40px; border-top: 1px solid var(--me-line); border-right: 0; }
  .me-command-actions { grid-column: 2; grid-row: 1; }
  .me-command-actions .me-status-mark { display: none; }
  .me-product-mark { border-right: 0; }
  .me-mobile-run-picker { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; min-height: 40px; padding: 0 10px; border-bottom: 1px solid var(--me-line-strong); background: var(--me-surface); }
  .me-mobile-run-picker label { color: var(--me-text-tertiary); font: 9px/1 var(--me-mono); text-transform: uppercase; }
  .me-mobile-run-picker select { min-width: 0; height: 40px; border: 0; border-radius: 0; background: transparent; color: var(--me-text-secondary); font: 11px/1 var(--me-mono); }
  .me-workbench { grid-template-columns: minmax(0, 1fr); }
  .me-run-rail { display: none; }
  .me-trace-workspace, .me-inspector { grid-column: 1; overflow: visible; }
  .me-trace-workspace { min-height: 0; }
  .me-trace-table { flex: 0 1 auto; width: 100%; min-width: 0; overflow-x: auto; scrollbar-color: var(--me-line-strong) transparent; scrollbar-width: thin; }
  .me-trace-head, .me-trace-turn { min-width: 620px; }
  .me-trace-floor { flex: 0 0 0; min-height: 0; border-top: 0; }
  .me-run-header { min-height: 56px; }
  .me-run-metrics { grid-template-columns: repeat(2, 1fr); }
  .me-run-metrics > div:nth-child(2) { border-right: 0; }
  .me-run-metrics > div:nth-child(-n + 2) { border-bottom: 1px solid var(--me-line); }
  .me-inspector { min-height: 0; }
  .me-status-bar { grid-template-columns: minmax(0, 1fr) repeat(2, max-content); }
  .me-status-bar > span:nth-child(3), .me-status-bar > span:nth-child(4) { display: none; }
}

@container message-engine-devtools (max-width: 420px) {
  .me-product-mark small, .me-product-mark > span { display: none; }
  .me-command-actions > button { min-width: 64px; }
  .me-inspector-tabs { overflow-x: auto; grid-template-columns: repeat(5, minmax(68px, 1fr)); }
  .me-blueprint { min-width: 320px; }
  .me-trace-head, .me-trace-turn { min-width: 560px; }
}

@media (prefers-reduced-motion: reduce) {
  .me-devtools *, .me-devtools *::before, .me-devtools *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;
