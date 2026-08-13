const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

const serializeCanonical = (value: unknown, seen: WeakSet<object>): string => {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'bigint':
      return `bigint:${value.toString()}`;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'function':
      return `[function:${value.name}]`;
    case 'number':
      return Number.isNaN(value) ? 'number:NaN' : `number:${value}`;
    case 'string':
      return JSON.stringify(value);
    case 'symbol':
      return `[symbol:${String(value.description)}]`;
    case 'undefined':
      return 'undefined';
  }

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = `[${value.map((item) => serializeCanonical(item, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }

  if (value instanceof Date) {
    seen.delete(value);
    return `date:${value.toISOString()}`;
  }

  const record = value as Record<string, unknown>;
  const result = `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeCanonical(record[key], seen)}`)
    .join(',')}}`;
  seen.delete(value);
  return result;
};

export const canonicalStringify = (value: unknown): string =>
  serializeCanonical(value, new WeakSet<object>());

export const hashString = (value: string): string => {
  let hash = FNV_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, '0');
};

export const fingerprint = (value: unknown): string => hashString(canonicalStringify(value));
