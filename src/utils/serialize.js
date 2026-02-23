const TIMESTAMP_KEYS = new Set(['created_at', 'updated_at', 'createdAt', 'updatedAt']);

function _transform(value, key) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
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
