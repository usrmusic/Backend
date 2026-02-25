// Helper utilities for parsing event dates from frontend formats
// Exports `toDbDate` which returns a simple YYYY-MM-DD string when possible.

export function toDbDate(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split('-').map(Number);
  // detect DD-MM-YYYY
  if (parts.length === 3 && parts[2] >= 1000) {
    // could be DD-MM-YYYY or YYYY-MM-DD; decide by year position
    const [a, b, c] = parts;
    if (a > 31) {
      // likely YYYY-MM-DD
      const y = a, m = b, d = c;
      return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    // otherwise treat as DD-MM-YYYY
    const d = a, m = b, y = c;
    return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  // fallback: try Date parse and return YYYY-MM-DD
  const dt = new Date(dateStr);
  if (!isNaN(dt.getTime())) {
    const Y = dt.getUTCFullYear();
    const M = String(dt.getUTCMonth() + 1).padStart(2,'0');
    const D = String(dt.getUTCDate()).padStart(2,'0');
    return `${Y}-${M}-${D}`;
  }
  return null;
}

export default { toDbDate };
