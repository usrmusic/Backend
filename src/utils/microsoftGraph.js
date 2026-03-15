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

async function createEvent({ subject, content, startIso, endIso, location }) {
  try {
    const token = await getAccessToken();
    const user = ensureCalendarUser();
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/events`;
    const payload = {
      subject: subject || 'USRMusic Event',
      body: { contentType: 'HTML', content: content || '' },
      start: { dateTime: startIso, timeZone: 'UTC' },
      end: { dateTime: endIso, timeZone: 'UTC' },
      location: { displayName: location || '' },
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
    if (startIso) payload.start = { dateTime: startIso, timeZone: 'UTC' };
    if (endIso) payload.end = { dateTime: endIso, timeZone: 'UTC' };
    if (location) payload.location = { displayName: location };
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

export default { createEvent, updateEvent, deleteEvent };
