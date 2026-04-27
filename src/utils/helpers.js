/**
 * Centralized helper functions for common operations across controllers and services
 */

/**
 * Parse numeric-like values (handles number, string, Decimal, etc.)
 * @param {*} v - Value to parse
 * @returns {number} Parsed numeric value, or 0 if invalid
 */
export function parseNumberLike(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse a date string in various formats (YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY)
 * Returns object with startOfDay and endOfDay for inclusive date range queries
 * @param {string} value - Date string to parse
 * @returns {object|null} { startOfDay, endOfDay } or null if invalid
 */
export function parseSearchDate(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  
  const ymd = /^\d{4}-\d{2}-\d{2}$/;       // YYYY-MM-DD
  const dmyDash = /^\d{2}-\d{2}-\d{4}$/;   // DD-MM-YYYY
  const dmySlash = /^\d{2}\/\d{2}\/\d{4}$/; // DD/MM/YYYY
  
  let date = null;

  if (ymd.test(normalized)) {
    date = new Date(normalized);
  } else if (dmyDash.test(normalized)) {
    const [dd, mm, yyyy] = normalized.split('-').map(Number);
    date = new Date(yyyy, mm - 1, dd);
  } else if (dmySlash.test(normalized)) {
    const [dd, mm, yyyy] = normalized.split('/').map(Number);
    date = new Date(yyyy, mm - 1, dd);
  }

  if (!date || Number.isNaN(date.getTime())) return null;

  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { startOfDay, endOfDay };
}

/**
 * Parse time string (HH:mm) to UTC Date
 * @param {Date|null} dateOnly - Base date (or null for current date)
 * @param {string|null} timeStr - Time string in HH:mm format
 * @returns {Date|null} UTC Date or null if invalid
 */
export function parseTimeToUtcDate(dateOnly, timeStr) {
  if (!timeStr || timeStr === '') return null;
  
  const [hh, mm] = String(timeStr).split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;
  
  const base = dateOnly instanceof Date ? dateOnly : new Date();
  const local = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0);
  return new Date(local.toISOString());
}

/**
 * Parse a date string (YYYY-MM-DD or DD-MM-YYYY) to Date object
 * @param {string} dateStr - Date string
 * @returns {Date|null} Parsed date or null if invalid
 */
export function parseDate(dateStr) {
  if (!dateStr) return null;
  
  const s = String(dateStr).trim();
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const dmy = /^\d{2}-\d{2}-\d{4}$/;
  
  let dateVal = null;
  
  if (ymd.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    dateVal = new Date(y, m - 1, d);
  } else if (dmy.test(s)) {
    const [dd, mm, yyyy] = s.split('-').map(Number);
    dateVal = new Date(yyyy, mm - 1, dd);
  }
  
  return dateVal;
}

/**
 * Parse comma-separated IDs string into array of numbers
 * @param {string|array} idsRaw - CSV string or array of IDs
 * @returns {array} Array of numeric IDs
 */
export function parseIdArray(idsRaw) {
  if (Array.isArray(idsRaw)) {
    return idsRaw.map(i => Number(i)).filter(n => !isNaN(n));
  }
  
  const raw = String(idsRaw || '').trim();
  if (!raw) return [];
  
  // Handle [1,2,3] bracket format
  const cleaned = raw.replace(/^\[|\]$/g, '');
  return cleaned.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
}

/**
 * Safely trim and normalize string input
 * @param {*} value - Value to normalize
 * @param {boolean} lowercase - Convert to lowercase
 * @returns {string|null} Trimmed string or null if empty
 */
export function normalizeString(value, lowercase = false) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  return lowercase ? str.toLowerCase() : str;
}

/**
 * Format email to lowercase and trim
 * @param {string} email - Email address
 * @returns {string|null} Formatted email or null
 */
export function normalizeEmail(email) {
  const normalized = normalizeString(email, true);
  if (!normalized || !normalized.includes('@')) return null;
  return normalized;
}

/**
 * Parse base64 data URI and extract base64 content
 * @param {string} dataUri - Data URI string (e.g., data:image/png;base64,...)
 * @returns {string} Base64 content without header
 */
export function extractBase64FromDataUri(dataUri) {
  if (!dataUri) return '';
  return String(dataUri).replace(/^data:.*;base64,/, '');
}

/**
 * Convert newlines to HTML break tags
 * @param {string} text - Text with newlines
 * @returns {string} HTML with <br> tags
 */
export function textToHtml(text) {
  if (!text) return '';
  return String(text).replace(/\n/g, '<br>');
}

/**
 * Replace template placeholders in text
 * @param {string} text - Template text
 * @param {object} replacements - Map of placeholder -> value
 * @returns {string} Text with replacements applied
 */
export function replaceTemplatePlaceholders(text, replacements = {}) {
  if (!text) return '';
  let result = String(text);
  
  for (const [key, value] of Object.entries(replacements)) {
    const placeholder = `{--${key}--}`;
    result = result.replace(placeholder, String(value || ''));
  }
  
  return result;
}

/**
 * Extract path from URL (useful for S3 keys)
 * @param {string} url - Full URL or path
 * @returns {string} Path without leading /
 */
export function extractPathFromUrl(url) {
  if (!url) return '';
  
  try {
    const u = new URL(String(url));
    return u.pathname.replace(/^\//, '');
  } catch {
    // Not a valid URL, treat as path
    return String(url).replace(/^\//, '');
  }
}

/**
 * Build search OR conditions for common event fields
 * @param {string} search - Search term
 * @returns {array} Array of Prisma OR conditions
 */
export function buildEventSearchConditions(search) {
  if (!search) return [];
  
  const conditions = [];
  const searchTerm = String(search).trim();
  
  // ID (numeric)
  if (/^\d+$/.test(searchTerm)) {
    conditions.push({ id: Number(searchTerm) });
  }
  
  // Venue name
  conditions.push({ venues: { is: { venue: { contains: searchTerm, mode: 'insensitive' } } } });
  
  // DJ name
  conditions.push({ users_events_dj_idTousers: { is: { name: { contains: searchTerm, mode: 'insensitive' } } } });
  
  // Client name
  conditions.push({ users_events_user_idTousers: { is: { name: { contains: searchTerm, mode: 'insensitive' } } } });
  
  // Client email
  conditions.push({ users_events_user_idTousers: { is: { email: { contains: searchTerm, mode: 'insensitive' } } } });
  
  // Couple name
  conditions.push({ couple_name: { contains: searchTerm, mode: 'insensitive' } });
  
  return conditions;
}

/**
 * Parse pagination parameters from query
 * @param {object} query - Query object with page, perPage, limit
 * @returns {object} { page, limit } with validated values
 */
export function parsePaginationParams(query = {}) {
  const page = query.page ? Math.max(1, Number(query.page)) : 1;
  
  const limit = query.perPage
    ? Math.min(100, Number(query.perPage))
    : query.limit
      ? Math.min(100, Number(query.limit))
      : 10;
  
  return { page, limit };
}

/**
 * Calculate pagination metadata
 * @param {number} total - Total record count
 * @param {number} page - Current page
 * @param {number} limit - Records per page
 * @returns {object} Pagination metadata { total, page, perPage, totalPages }
 */
export function getPaginationMeta(total, page, limit) {
  return {
    total,
    page,
    perPage: limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Convert array of strings to trimmed, non-empty array
 * @param {array} arr - Array to process
 * @returns {array} Filtered and trimmed array
 */
export function cleanStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(s => String(s).trim()).filter(s => s.length > 0);
}

export default {
  parseNumberLike,
  parseSearchDate,
  parseTimeToUtcDate,
  parseDate,
  parseIdArray,
  normalizeString,
  normalizeEmail,
  extractBase64FromDataUri,
  textToHtml,
  replaceTemplatePlaceholders,
  extractPathFromUrl,
  buildEventSearchConditions,
  parsePaginationParams,
  getPaginationMeta,
  cleanStringArray,
};
