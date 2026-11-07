/**
 * Stage 1: copy CRM calendar events into the NEW Microsoft 365 tenant.
 *
 * READ-ONLY on the database. Writes only to the new tenant's calendar and to
 * a local CSV — never to microsoft_events or any other table.
 *
 * What it does:
 *   1. Reads every `microsoft_events` row (old-tenant ids — not written to).
 *   2. Loads the matching `events` rows with date >= --from (default: today).
 *   3. Pre-loads the NEW tenant's calendar for that date range and builds a
 *      set of subjects already present, so already-migrated events are
 *      skipped instead of duplicated.
 *   4. For each candidate not already on the CSV and not already on the
 *      calendar: builds the same subject/content/start/end/location payload
 *      confirmEvents.controller.js uses, calls microsoftGraph.createEvent(),
 *      and appends a row to migration-output.csv.
 *
 * Explicitly does NOT:
 *   - write to the database (every query below is a plain SELECT — no
 *     INSERT/UPDATE/DELETE anywhere in this file)
 *   - touch any existing calendar event
 *   - add attendees to anything it creates
 *   - modify src/** in any way (only imports the existing, unmodified
 *     microsoftGraph.js helper for its Graph calls)
 *
 * DB access note: this uses the `mariadb` driver directly rather than
 * Prisma. On this dev machine, `@prisma/adapter-mariadb` (what
 * src/utils/prismaClient.js uses) hangs against the production DB —
 * verified by reproducing the same "pool timeout... active=0 idle=0" with
 * prismaClient.js completely unmodified. The raw `mariadb` driver (already
 * a transitive dependency, same package Prisma's own adapter wraps)
 * connects and queries instantly with the identical DATABASE_URL, so it's
 * used here for the handful of plain SELECTs this script needs. This is a
 * local-environment quirk, not a database or credentials problem — src/**
 * is untouched either way.
 *
 * Usage:
 *   node scripts/migrateMicrosoftEvents.js --dry-run
 *   node scripts/migrateMicrosoftEvents.js --dry-run --from 2026-10-01
 *   node scripts/migrateMicrosoftEvents.js --limit 2
 *   node scripts/migrateMicrosoftEvents.js
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import mariadb from 'mariadb';
import https from 'https';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Same loading convention as src/config/index.js: reads Backend/.env, which
// is production (tramway.proxy.rlwy.net) on this machine — confirmed against
// Railway's TCP proxy list before this script was written. Never overridden
// with a hardcoded connection string.
dotenv.config({ path: path.resolve(ROOT, '.env') });

const CSV_PATH = path.resolve(__dirname, 'migration-output.csv');
const CSV_HEADER = 'event_id,old_microsoft_event_id,new_microsoft_event_id,subject,date,status\n';

// Same IPv6-routing workaround as testGraph.js — this dev box has AAAA
// records for Microsoft endpoints but no routable IPv6.
const ipv4Agent = new https.Agent({ family: 4, keepAlive: false });

function parseArgs(argv) {
  const args = { dryRun: false, limit: null, from: null, creds: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--creds') args.creds = argv[++i];
  }
  return args;
}

// Same fallback as testGraph.js: the AZURE_* values live in Railway, not in
// Backend/.env (which only carries DATABASE_URL + friends on this machine).
// Real env still wins, so production/Railway behaviour is unaffected.
function loadCredsFile(credsPath) {
  if (!credsPath) return;
  if (!fs.existsSync(credsPath)) throw new Error(`--creds file not found: ${credsPath}`);
  const vals = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
  for (const k of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_CALENDAR_USER_ID']) {
    if (!process.env[k] && vals[k]) process.env[k] = vals[k];
  }
}

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

function maskDbUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    return '(unparseable)';
  }
}

// --- CSV (idempotency ledger) -------------------------------------------

function loadCsvHandledEventIds() {
  const handled = new Set(); // event_ids already created or confirmed skipped_exists
  if (!fs.existsSync(CSV_PATH)) return handled;
  const lines = fs.readFileSync(CSV_PATH, 'utf8').split('\n').filter(Boolean);
  for (const line of lines.slice(1)) {
    // event_id,old_microsoft_event_id,new_microsoft_event_id,subject,date,status
    const firstComma = line.indexOf(',');
    if (firstComma === -1) continue;
    const eventId = line.slice(0, firstComma);
    const status = line.slice(line.lastIndexOf(',') + 1).trim();
    if (status === 'created' || status === 'skipped_exists') {
      handled.add(eventId);
    }
  }
  return handled;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function appendCsvRow(row) {
  if (!fs.existsSync(CSV_PATH)) fs.writeFileSync(CSV_PATH, CSV_HEADER);
  const line = [row.event_id, row.old_microsoft_event_id, row.new_microsoft_event_id, row.subject, row.date, row.status]
    .map(csvEscape)
    .join(',');
  fs.appendFileSync(CSV_PATH, line + '\n');
}

// --- DB (raw `mariadb` driver — read-only: every query below is a SELECT) ---

function makePool() {
  requireEnv(['DATABASE_URL']);
  const url = new URL(process.env.DATABASE_URL.replace(/^mysql:/, 'mariadb:'));
  return mariadb.createPool({
    host: url.hostname,
    port: url.port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: 3,
    connectTimeout: 15000,
  });
}

// The `mariadb` driver silently mis-converts plain SQL DATE columns using the
// DB server's local system timezone (verified: a column stored as
// '2024-01-13' came back as a JS Date printing 2024-01-12T19:00:00.000Z —
// one calendar day off). Pulling the date as a formatted string and building
// the UTC Date ourselves sidesteps that entirely; DATETIME app code
// (microsoftGraph.js) already expects a UTC-midnight-anchored Date, same as
// what Prisma itself returns for this column.
function dateStrToUtcDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// TIME(0) columns come back as plain 'HH:MM:SS' strings from this driver
// (no timezone conversion applied to TIME, verified separately) — anchor to
// epoch day 1970-01-01, matching how Prisma represents TIME(0) columns
// (see the timezone note in src/utils/microsoftGraph.js).
function timeStrToEpochDate(timeStr) {
  if (!timeStr) return null;
  const [h, m, s] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m, s || 0));
}

async function fetchMicrosoftEventRows(pool) {
  const rows = await pool.query('SELECT event_id, microsoft_event_id FROM microsoft_events');
  return rows.map((r) => ({ event_id: Number(r.event_id), microsoft_event_id: r.microsoft_event_id }));
}

async function fetchCandidateEvents(pool, eventIds, fromDateStr) {
  if (!eventIds.length) return [];
  const placeholders = eventIds.map(() => '?').join(',');
  const sql = `
    SELECT
      e.id,
      DATE_FORMAT(e.date, '%Y-%m-%d') AS date_str,
      e.start_time AS start_time_str,
      e.end_time AS end_time_str,
      e.dj_package_name,
      cu.name AS client_name,
      dj.name AS dj_name,
      v.venue AS venue_name,
      v.venue_address AS venue_address
    FROM events e
    LEFT JOIN users cu ON cu.id = e.user_id
    LEFT JOIN users dj ON dj.id = e.dj_id
    LEFT JOIN venues v ON v.id = e.venue_id
    WHERE e.id IN (${placeholders}) AND e.date >= ?
    ORDER BY e.date ASC
  `;
  const rows = await pool.query(sql, [...eventIds, fromDateStr]);
  return rows.map((r) => ({
    id: Number(r.id),
    date: dateStrToUtcDate(r.date_str),
    start_time: timeStrToEpochDate(r.start_time_str),
    end_time: timeStrToEpochDate(r.end_time_str),
    dj_package_name: r.dj_package_name,
    users_events_user_idTousers: r.client_name ? { name: r.client_name } : null,
    users_events_dj_idTousers: r.dj_name ? { name: r.dj_name } : null,
    venues: (r.venue_name || r.venue_address) ? { venue: r.venue_name, venue_address: r.venue_address } : null,
  }));
}

async function fetchEventPackages(pool, eventId) {
  const rows = await pool.query(
    `SELECT ep.quantity, ep.notes, eq.name AS equipment_name
     FROM event_package ep
     LEFT JOIN equipment eq ON eq.id = ep.equipment_id
     WHERE ep.event_id = ? AND ep.package_type_id IN (1, 2)`,
    [eventId],
  );
  return rows.map((r) => ({ quantity: r.quantity, notes: r.notes, equipment: r.equipment_name ? { name: r.equipment_name } : null }));
}

// --- Microsoft Graph helpers (imported unmodified from the app) ----------

async function loadMicrosoftGraph() {
  const mod = await import(path.resolve(ROOT, 'src/utils/microsoftGraph.js'));
  return mod.default;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- New-tenant calendar pre-load, for dedupe -----------------------------

async function fetchExistingSubjects({ mailbox, startDate, endDate }) {
  requireEnv(['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']);
  const tokenUrl = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  }).toString();
  const tokenResp = await axios.post(tokenUrl, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    httpsAgent: ipv4Agent,
    timeout: 20000,
  });
  const token = tokenResp.data.access_token;

  const subjects = new Set();
  let url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/calendarView` +
    `?startDateTime=${encodeURIComponent(startDate)}&endDateTime=${encodeURIComponent(endDate)}&$top=999&$select=subject`;

  let pages = 0;
  while (url) {
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="Europe/London"' },
      httpsAgent: ipv4Agent,
      timeout: 20000,
    });
    for (const ev of resp.data?.value || []) {
      if (ev.subject) subjects.add(ev.subject.trim());
    }
    url = resp.data?.['@odata.nextLink'] || null;
    pages += 1;
    if (pages > 50) break; // sanity cap; a well-formed migration range shouldn't hit this
  }
  return subjects;
}

// --- main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  loadCredsFile(args.creds);
  const fromDate = args.from ? new Date(`${args.from}T00:00:00Z`) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(fromDate.getTime())) throw new Error(`Invalid --from date: ${args.from}`);

  requireEnv(['DATABASE_URL', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_CALENDAR_USER_ID']);
  const mailbox = process.env.AZURE_CALENDAR_USER_ID;

  console.log('='.repeat(64));
  console.log('Microsoft calendar migration — Stage 1');
  console.log('='.repeat(64));
  console.log(`Mode            : ${args.dryRun ? 'DRY RUN (no writes at all)' : 'LIVE (will create calendar events)'}`);
  console.log(`Database        : ${maskDbUrl(process.env.DATABASE_URL)}`);
  console.log(`Calendar mailbox: ${mailbox}`);
  console.log(`From date       : ${fromDate.toISOString().slice(0, 10)}`);
  console.log(`Limit           : ${args.limit ?? '(none)'}`);
  console.log(`CSV             : ${CSV_PATH}`);
  console.log('');

  const pool = makePool();
  const microsoftGraph = await loadMicrosoftGraph();

  try {
    // 1. Old-tenant microsoft_events rows — READ ONLY, never written to.
    const msRows = await fetchMicrosoftEventRows(pool);
    if (!msRows.length) {
      console.log('No microsoft_events rows found at all — nothing to migrate.');
      return;
    }
    const oldMsByEventId = new Map(msRows.map((r) => [String(r.event_id), r.microsoft_event_id]));
    const candidateEventIds = [...new Set(msRows.map((r) => r.event_id))];

    // 2. Matching events, date >= fromDate. READ ONLY.
    const fromDateStr = fromDate.toISOString().slice(0, 10);
    let events = await fetchCandidateEvents(pool, candidateEventIds, fromDateStr);

    console.log(`Candidate events (has microsoft_events row, date >= from): ${events.length}`);

    const alreadyHandled = loadCsvHandledEventIds();
    if (alreadyHandled.size) {
      console.log(`Already recorded in CSV as created/skipped: ${alreadyHandled.size} — will be skipped again.`);
    }
    events = events.filter((e) => !alreadyHandled.has(String(e.id)));
    console.log(`Remaining after CSV idempotency filter: ${events.length}`);

    if (args.limit) {
      events = events.slice(0, args.limit);
      console.log(`Limited to first ${events.length} by --limit ${args.limit}`);
    }

    if (!events.length) {
      console.log('Nothing to do.');
      return;
    }

    // 3. Pre-load the NEW tenant's calendar over the candidate date range,
    //    to skip events that already exist there (e.g. from a prior partial run).
    const dates = events.map((e) => e.date).filter(Boolean);
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
    maxDate.setUTCDate(maxDate.getUTCDate() + 1); // inclusive of the last day

    console.log(`\nPre-loading existing calendar events from ${minDate.toISOString().slice(0, 10)} to ${maxDate.toISOString().slice(0, 10)} for dedupe...`);
    const existingSubjects = await fetchExistingSubjects({
      mailbox,
      startDate: minDate.toISOString(),
      endDate: maxDate.toISOString(),
    });
    console.log(`Found ${existingSubjects.size} existing events in that range on the new calendar.\n`);

    // 4. Create, one by one.
    let created = 0;
    let skippedExists = 0;
    let failed = 0;
    const failures = [];

    for (const event of events) {
      const eventPackages = await fetchEventPackages(pool, event.id).catch(() => []);

      const { subject, content, location } = microsoftGraph.buildEventCalendarContent({ event, eventPackages });
      const { startIso, endIso } = microsoftGraph.combineEventDateTimes(event.date, event.start_time, event.end_time);
      const dateStr = event.date.toISOString().slice(0, 10);
      const oldId = oldMsByEventId.get(String(event.id)) || '';

      if (existingSubjects.has(subject.trim())) {
        console.log(`[SKIP] event ${event.id} — "${subject}" already exists on new calendar`);
        appendCsvRow({ event_id: event.id, old_microsoft_event_id: oldId, new_microsoft_event_id: '', subject, date: dateStr, status: 'skipped_exists' });
        skippedExists += 1;
        continue;
      }

      if (args.dryRun) {
        console.log(`[DRY-RUN] would create event ${event.id} — "${subject}" on ${dateStr}`);
        continue;
      }

      try {
        const result = await microsoftGraph.createEvent({ subject, content, startIso, endIso, location });
        console.log(`[CREATED] event ${event.id} — "${subject}" -> new id ${result.id}`);
        appendCsvRow({ event_id: event.id, old_microsoft_event_id: oldId, new_microsoft_event_id: result.id, subject, date: dateStr, status: 'created' });
        existingSubjects.add(subject.trim()); // guard against dupes within this same run
        created += 1;
      } catch (err) {
        const detail = err?.response?.data?.error?.message || err?.message || String(err);
        console.error(`[FAILED] event ${event.id} — "${subject}": ${detail}`);
        appendCsvRow({ event_id: event.id, old_microsoft_event_id: oldId, new_microsoft_event_id: '', subject, date: dateStr, status: 'failed' });
        failures.push({ event_id: event.id, subject, detail });
        failed += 1;
      }

      await sleep(500);
    }

    console.log('\n' + '='.repeat(64));
    console.log('SUMMARY');
    console.log('='.repeat(64));
    if (args.dryRun) {
      console.log(`Would create: ${events.length - skippedExists}`);
      console.log(`Would skip (already on calendar): ${skippedExists}`);
    } else {
      console.log(`Created: ${created}`);
      console.log(`Skipped (already on calendar): ${skippedExists}`);
      console.log(`Failed: ${failed}`);
      if (failures.length) {
        console.log('\nFailures:');
        for (const f of failures) console.log(`  event ${f.event_id} "${f.subject}": ${f.detail}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('UNHANDLED ERROR:', e?.message || e);
  process.exit(1);
});
