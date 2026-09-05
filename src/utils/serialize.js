const TIMESTAMP_KEYS = new Set(['created_at', 'updated_at', 'createdAt', 'updatedAt']);

// Prisma's Decimal (`@db.Decimal(...)` columns — deposit_amount, cost_price,
// sell_price, etc.) is a decimal.js instance, not a plain number. Without
// this check it fell into the generic "object" branch below, which walked
// its internal {s, e, d} digit-array properties instead of the value —
// every Decimal field sent to a client rendered as "[object Object]"
// wherever the caller hadn't already done `Number(...)` by hand (most did;
// the public contract-signing endpoint didn't, which is how this surfaced).
// Duck-typed (no import needed) since Prisma re-exports decimal.js under a
// version-specific path.
function isDecimalLike(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.toNumber === 'function' &&
    typeof value.toFixed === 'function' &&
    Array.isArray(value.d)
  );
}

function _transform(value, key) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (isDecimalLike(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map((v) => _transform(v));
  if (value && typeof value === 'object') {
    // If a timestamp field is an empty object ({}), normalize to null
    if (key && TIMESTAMP_KEYS.has(key) && Object.keys(value).length === 0) return null;

    const out = {};
    for (const k of Object.keys(value)) out[k] = _transform(value[k], k);
    return out;
  }
  return value;
}

export function serializeForJson(data) {
  return _transform(data);
}

export default { serializeForJson };
