export function toCsv(rows = [], columns = []) {
  if (!Array.isArray(rows)) rows = [];
  if (!columns || !columns.length) {
    columns = rows.length ? Object.keys(rows[0]) : [];
  }
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = columns.join(',');
  const lines = rows.map(r => columns.map(c => escape(r[c])).join(','));
  return [header].concat(lines).join('\n');
}

export default { toCsv };
