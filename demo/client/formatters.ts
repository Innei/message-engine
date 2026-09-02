export const formatInteger = (value: number): string =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

export const formatCost = (value: number): string => `$${value.toFixed(6)}`;

export const formatRate = (value: number): string =>
  `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value)}/M in`;

export const formatPercent = (value: number | undefined): string => {
  if (value === undefined) return '—';
  return `${(value * 100).toFixed(1)}%`;
};

export const formatMultiplier = (value: number): string => `${value.toFixed(1)}x`;

export const shortId = (value: string): string => value.slice(0, 8);

export const summarizeContextValue = (value: string | undefined): string => {
  if (!value) return 'not built yet';
  return value
    .split('\n')
    .filter((line) => !line.startsWith('<'))
    .join(' · ');
};
