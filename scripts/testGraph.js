/**
 * Microsoft 365 tenant connection test — READ-MOSTLY, SAFE.
 *
 * Verifies a (new) tenant's app registration works for the CRM's calendar +
 * mail needs, before any bulk migration is attempted.
 *
 * What it does:
 *   a) client-credentials token -> decode payload locally, print `tid` + `roles`
 *   b) GET  /users/{mailbox}/calendar/events?$top=1        (read only)
 *   c) POST /users/{mailbox}/events  (ONE test event, no attendees)
 *      then DELETE that same event by its returned id, immediately
 *   d) POST /users/{mailbox}/sendMail  (ONE email, to --to only)
 *
 * Safety properties:
 *   - Never connects to the database.
 *   - Never prints the access token or the client secret.
 *   - Only ever deletes the event id returned by its own create call, and
 *     re-verifies that event's subject matches the marker before deleting.
 *   - Creates the event with an explicit empty attendee list, so Outlook
 *     sends no invitations to anyone.
 *
 * Credentials are read from process.env, falling back to a JSON file given
 * with --creds <path> (same key names). The fallback exists so this can run
 * locally without pasting secrets into a shell.
 *
 * Usage:
 *   node scripts/testGraph.js --to someone@example.com [--creds /path/vars.json]
 *   node scripts/testGraph.js --to someone@example.com --skip-write
 */

import axios from 'axios';
import fs from 'fs';
import https from 'https';

// Some machines (this dev box included) get AAAA records for Microsoft
// endpoints but have no routable IPv6, so Node hangs until ETIMEDOUT while
// curl quietly falls back to IPv4. Pinning the agent to IPv4 makes this script
// behave the same everywhere. This is local to this script — it does not change
// src/utils/microsoftGraph.js or any runtime behaviour.
const agent = new https.Agent({ family: 4, keepAlive: false });

const REQUIRED = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_CALENDAR_USER_ID',
];

const TEST_SUBJECT = 'CRM TEST - delete me';

function parseArgs(argv) {
  const args = { to: null, creds: null, skipWrite: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') args.to = argv[++i];
    else if (a === '--creds') args.creds = argv[++i];
    else if (a === '--skip-write') args.skipWrite = true;
  }
  return args;
}

function loadConfig(credsPath) {
  const cfg = {};
  let fileVals = {};
  if (credsPath) {
    if (!fs.existsSync(credsPath)) {
      throw new Error(`--creds file not found: ${credsPath}`);
    }
    fileVals = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
  }
  for (const k of REQUIRED) {
    // real env wins over the file, so Railway/production behaviour is unchanged
    cfg[k] = process.env[k] || fileVals[k] || null;
  }
  const missing = REQUIRED.filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error(`Missing required config: ${missing.join(', ')}`);
  }
  return cfg;
}

/** Pull the payload out of a JWT without printing or returning the token. */
function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length < 2) throw new Error('token is not a JWT');
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf8'));
}

/** Normalise an axios/Graph failure down to code + message, nothing else. */
function graphError(err) {
  const body = err?.response?.data;
  const inner = body?.error || {};
  return {
    httpStatus: err?.response?.status ?? null,
    code: inner.code || err?.code || 'unknown',
    message: inner.message || err?.message || String(err),
  };
}

async function getAccessToken(cfg) {
  const url = `https://login.microsoftonline.com/${cfg.AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cfg.AZURE_CLIENT_ID,
    client_secret: cfg.AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  }).toString();
  const resp = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
    httpsAgent: agent,
  });
  if (!resp.data?.access_token) throw new Error('no access_token in response');
  return resp.data.access_token;
}

/** Tomorrow 10:00-11:00 as naive local datetimes, paired with Europe/London. */
function tomorrowWindow() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { start: `${day}T10:00:00`, end: `${day}T11:00:00`, day };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.to) {
    console.error('ERROR: --to <email> is required (the single test-email recipient).');
    process.exit(1);
  }

  const cfg = loadConfig(args.creds);
  const mailbox = cfg.AZURE_CALENDAR_USER_ID;

  console.log('='.repeat(64));
  console.log('Microsoft 365 tenant connection test');
  console.log('='.repeat(64));
  console.log(`Config source      : ${args.creds ? `env + ${args.creds}` : 'process.env'}`);
  console.log(`Calendar mailbox   : ${mailbox}`);
  console.log(`Test email recipient: ${args.to}`);
  console.log(`Write tests        : ${args.skipWrite ? 'SKIPPED (--skip-write)' : 'enabled'}`);
  console.log(`Database           : NOT CONNECTED (this script never touches the DB)`);
  console.log('');

  const results = [];
  const record = (step, name, ok, detail) => {
    results.push({ step, name, ok, detail });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let token;

  // ---- (a) token + claims -------------------------------------------------
  try {
    token = await getAccessToken(cfg);
    const claims = decodeJwtPayload(token);
    const roles = Array.isArray(claims.roles) ? claims.roles : [];

    console.log('--- token claims ---');
    console.log(`  tid   : ${claims.tid || '(absent)'}`);
    console.log(`  appid : ${claims.appid || claims.azp || '(absent)'}`);
    console.log(`  roles : ${roles.length ? roles.join(', ') : '(none granted)'}`);
    console.log('');

    const expected = ['Calendars.ReadWrite', 'Mail.Send', 'MailboxSettings.ReadWrite'];
    const missing = expected.filter((r) => !roles.includes(r));
    record('a', 'acquire token + decode claims', true, `tid=${claims.tid}`);
    if (missing.length) {
      record('a2', 'expected app roles present', false, `missing: ${missing.join(', ')}`);
    } else {
      record('a2', 'expected app roles present', true, expected.join(', '));
    }
  } catch (e) {
    const g = graphError(e);
    record('a', 'acquire token', false, `${g.code}: ${g.message}`);
    console.error('\nSTOPPING: cannot continue without a token.');
    console.error(`HTTP ${g.httpStatus} | code=${g.code}\n${g.message}`);
    process.exit(1);
  }

  const auth = { headers: { Authorization: `Bearer ${token}` }, timeout: 20000, httpsAgent: agent };

  // ---- (b) read calendar (read-only) --------------------------------------
  try {
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/calendar/events?$top=1`;
    const resp = await axios.get(url, auth);
    const items = resp.data?.value || [];
    // Deliberately not printing subjects here — that would leak client data.
    record('b', 'read calendar', true, `reachable, ${items.length} event returned by $top=1`);
  } catch (e) {
    const g = graphError(e);
    record('b', 'read calendar', false, `${g.code}: ${g.message}`);
  }

  // ---- (c) create + delete ONE test event ---------------------------------
  if (!args.skipWrite) {
    const { start, end, day } = tomorrowWindow();
    let createdId = null;
    try {
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/events`;
      const payload = {
        subject: TEST_SUBJECT,
        body: { contentType: 'HTML', content: 'Temporary connectivity test created by scripts/testGraph.js. Safe to ignore; deleted automatically.' },
        start: { dateTime: start, timeZone: 'Europe/London' },
        end: { dateTime: end, timeZone: 'Europe/London' },
        // explicit: no attendees => Outlook sends no invitations to anyone
        attendees: [],
        isReminderOn: false,
      };
      const resp = await axios.post(url, payload, auth);
      createdId = resp.data?.id || null;
      if (!createdId) throw new Error('create succeeded but returned no id');
      record('c1', 'create test event', true, `${day} 10:00 Europe/London, attendees=0`);
    } catch (e) {
      const g = graphError(e);
      record('c1', 'create test event', false, `${g.code}: ${g.message}`);
    }

    if (createdId) {
      // Re-read and confirm this really is our marker event before deleting.
      let safeToDelete = false;
      try {
        const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(createdId)}`;
        const resp = await axios.get(url, auth);
        safeToDelete = resp.data?.subject === TEST_SUBJECT;
        if (!safeToDelete) {
          record('c2', 'verify before delete', false, 'subject mismatch — refusing to delete');
        }
      } catch (e) {
        const g = graphError(e);
        record('c2', 'verify before delete', false, `${g.code}: ${g.message} — refusing to delete`);
      }

      if (safeToDelete) {
        try {
          const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(createdId)}`;
          const resp = await axios.delete(url, auth);
          record('c2', 'delete test event', true, `HTTP ${resp.status} (only the id just created)`);
        } catch (e) {
          const g = graphError(e);
          record('c2', 'delete test event', false, `${g.code}: ${g.message}`);
          console.error(`\n!! MANUAL CLEANUP NEEDED: test event left in ${mailbox} — subject "${TEST_SUBJECT}" on ${day}`);
        }
      }
    }
  }

  // ---- (d) send ONE test email --------------------------------------------
  if (!args.skipWrite) {
    try {
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;
      const message = {
        subject: 'CRM tenant test — Microsoft Graph sendMail',
        body: {
          contentType: 'HTML',
          content: `<p>This is a one-off connectivity test from <code>scripts/testGraph.js</code>.</p>
                    <p>Sent as mailbox: <b>${mailbox}</b></p>
                    <p>If you received this, Mail.Send works on the new tenant.</p>`,
        },
        toRecipients: [{ emailAddress: { address: args.to } }],
      };
      await axios.post(url, { message, saveToSentItems: true }, auth);
      record('d', 'send test email', true, `queued to ${args.to}`);
    } catch (e) {
      const g = graphError(e);
      record('d', 'send test email', false, `${g.code}: ${g.message}`);
    }
  }

  // ---- summary ------------------------------------------------------------
  console.log('');
  console.log('='.repeat(64));
  console.log('RESULT');
  console.log('='.repeat(64));
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('STEP', 6)}${pad('CHECK', 34)}RESULT`);
  console.log('-'.repeat(64));
  for (const r of results) {
    console.log(`${pad(r.step, 6)}${pad(r.name, 34)}${r.ok ? 'PASS' : 'FAIL'}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log('-'.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  [${f.step}] ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('UNHANDLED ERROR:', e?.message || e);
  process.exit(1);
});
