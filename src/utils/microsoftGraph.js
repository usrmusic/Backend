import axios from 'axios';
import qs from 'querystring';

// Minimal Microsoft Graph helper using client credentials flow.
// Env vars expected:
// - GRAPH_TENANT_ID
// - GRAPH_CLIENT_ID
// - GRAPH_CLIENT_SECRET
// - GRAPH_CALENDAR_USER_ID  (user principal or id to create events for)

const tenant = process.env.AZURE_TENANT_ID || null;
const clientId = process.env.AZURE_CLIENT_ID || null;
const clientSecret = process.env.AZURE_CLIENT_SECRET || null;
const calendarUser = process.env.AZURE_CALENDAR_USER_ID || null;

let cachedToken = null;
let tokenExpiry = 0;

// --- Timezone (confirmed against the production Railway env) ---
// `events.start_time` / `events.end_time` are MySQL `TIME(0)` columns (no timezone
// info at all). They're written via `parseTimeToUtcDate()` (see src/utils/helpers.js),
// which builds a JS Date from the admin-typed HH:mm using the Node process's *local*
// timezone and then calls `.toISOString()`. The deployed Railway environment has no
// `TZ` variable set, so the container defaults to UTC — meaning that round-trip is an
// identity transform: the stored TIME digits are the literal UK wall-clock digits the
// admin typed, with no DST math ever applied (the same "naive local time stored as if
// UTC" quirk Laravel has). So the `startIso`/`endIso` strings this module receives
// already carry the correct UK wall-clock digits — they're just wrongly labelled
// `Z`/UTC. `toNaiveLocalDateTime()` strips that label and `timeZone: 'Europe/London'`
// (below) lets Graph apply BST/GMT correctly instead of treating the digits as UTC.
function toNaiveLocalDateTime(isoString) {
  if (!isoString) return isoString;
  // "2026-09-06T19:00:00.000Z" -> "2026-09-06T19:00:00" (drop ms + trailing Z)
  return String(isoString).replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

async function getAccessToken() {
  if (!tenant || !clientId || !clientSecret) {
    throw new Error('Microsoft Graph credentials not configured (AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET)');
  }
  const now = Date.now() / 1000;
  if (cachedToken && tokenExpiry - 60 > now) return cachedToken;

  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = qs.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const resp = await axios.post(url, body, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const data = resp.data || {};
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in || 3600);
  return cachedToken;
}

function ensureCalendarUser() {
  if (!calendarUser) throw new Error('AZURE_CALENDAR_USER_ID not set');
  return calendarUser;
}

// `location` may be a plain string (legacy call sites — treated as displayName
// only) or an object `{ displayName, address, locationType }`, matching the
// `displayName`/`locationType`/`address` shape Laravel's MicrosoftGraphService
// sends (see usrmusic_rep MicrosoftGraphService.php ~155-165).
function normalizeLocation(location) {
  if (!location) return { displayName: '' };
  if (typeof location === 'string') return { displayName: location };
  const loc = { displayName: location.displayName || '' };
  if (location.locationType) loc.locationType = location.locationType;
  if (location.address) {
    loc.address = typeof location.address === 'string'
      ? { street: location.address }
      : location.address;
  }
  return loc;
}

/**
 * Format the UK wall-clock time-of-day carried by a `Time(0)` field (e.g.
 * `event.start_time`/`end_time`) as a 12-hour label, e.g. "7:00 PM".
 * These columns have no timezone, so the digits are read via UTC getters —
 * see the timezone note above for why the UTC-read digits are the intended
 * UK local wall-clock time.
 */
function formatUkTimeLabel(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  let hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

/**
 * Build the subject/body/location for a calendar entry, matching Laravel's
 * CreateEventInOutlookCalendar listener:
 * - subject: "{ClientName} @ {Venue} ({start} - {end})"
 * - body: bold DJ name + bullet list of "{quantity} X {equipment name}" (+ notes)
 * - location: venue display name + address
 *
 * `event` should include `venues`, `users_events_user_idTousers` (client) and
 * ideally `users_events_dj_idTousers` (DJ). `eventPackages` is an array of
 * `{ quantity, notes, equipment: { name } }` rows (package_type_id in [1,2]).
 */
function buildEventCalendarContent({ event, eventPackages = [] } = {}) {
  const clientName = event?.users_events_user_idTousers?.name || 'Client';
  const djName = event?.users_events_dj_idTousers?.name || event?.dj_package_name || 'DJ';
  const venueName = event?.venues?.venue || '';
  const startLabel = formatUkTimeLabel(event?.start_time);
  const endLabel = formatUkTimeLabel(event?.end_time);
  const timeRange = startLabel && endLabel ? `${startLabel} - ${endLabel}` : (startLabel || endLabel || '');

  let subject = clientName;
  if (venueName) subject += ` @ ${venueName}`;
  if (timeRange) subject += ` (${timeRange})`;

  let content = `<b>${djName}</b>`;
  content += `<br><ul style="list-style-type: disc; margin-left: 0px; padding-left:16px">`;
  for (const pkg of eventPackages || []) {
    const equipmentName = pkg?.equipment?.name;
    if (!equipmentName) continue;
    const quantity = Number(pkg?.quantity) || 1;
    content += `<li>${quantity > 1 ? `${quantity} X ` : ''}${equipmentName}`;
    if (pkg?.notes) content += `<br><span style="margin-left: 15px;">- ${pkg.notes}</span>`;
    content += `</li>`;
  }
  content += `</ul>`;

  const location = { displayName: venueName, address: event?.venues?.venue_address || undefined };

  return { subject, content, location };
}

async function createEvent({ subject, content, startIso, endIso, location }) {
  try {
    const token = await getAccessToken();
    const user = ensureCalendarUser();
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/events`;
    const payload = {
      subject: subject || 'USRMusic Event',
      body: { contentType: 'HTML', content: content || '' },
      start: { dateTime: toNaiveLocalDateTime(startIso), timeZone: 'Europe/London' },
      end: { dateTime: toNaiveLocalDateTime(endIso), timeZone: 'Europe/London' },
      location: normalizeLocation(location),
    };
    const res = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } });
    return res.data; // includes id
  } catch (err) {
    console.error('[microsoftGraph] createEvent error', err?.response?.data || err.message || err);
    throw err;
  }
}

async function updateEvent(graphEventId, { subject, content, startIso, endIso, location }) {
  try {
    const token = await getAccessToken();
    const user = ensureCalendarUser();
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/events/${encodeURIComponent(graphEventId)}`;
    const payload = {};
    if (subject) payload.subject = subject;
    if (content !== undefined) payload.body = { contentType: 'HTML', content: content || '' };
    if (startIso) payload.start = { dateTime: toNaiveLocalDateTime(startIso), timeZone: 'Europe/London' };
    if (endIso) payload.end = { dateTime: toNaiveLocalDateTime(endIso), timeZone: 'Europe/London' };
    if (location) payload.location = normalizeLocation(location);
    await axios.patch(url, payload, { headers: { Authorization: `Bearer ${token}` } });
    return true;
  } catch (err) {
    console.error('[microsoftGraph] updateEvent error', err?.response?.data || err.message || err);
    throw err;
  }
}

async function deleteEvent(graphEventId) {
  try {
    const token = await getAccessToken();
    const user = ensureCalendarUser();
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/events/${encodeURIComponent(graphEventId)}`;
    await axios.delete(url, { headers: { Authorization: `Bearer ${token}` } });
    return true;
  } catch (err) {
    console.error('[microsoftGraph] deleteEvent error', err?.response?.data || err.message || err);
    throw err;
  }
}

export default { createEvent, updateEvent, deleteEvent, buildEventCalendarContent, formatUkTimeLabel };
