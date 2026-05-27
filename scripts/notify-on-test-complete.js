/**
 * Firebase Test Lab — SMS notification on test completion.
 *
 * Usage:
 *   node scripts/notify-on-test-complete.js <matrixId>
 *
 * Example (copy matrixId from Firebase Console URL):
 *   node scripts/notify-on-test-complete.js matrix-38et6ig33rjpf
 *
 * Setup (one-time):
 *   1. Google Cloud Console → IAM → Service Accounts → Create
 *      Role: "Firebase Test Lab Viewer" (or "Viewer")
 *      Download JSON key → save as firebase/service-account.json
 *
 *   2. Create scripts/.env with your Twilio credentials:
 *      TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *      TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *      NOTIFY_PHONE=+16137697957
 *
 * No external npm packages required — pure Node.js built-ins only.
 */

'use strict';
const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const crypto  = require('crypto');

// ── Load credentials ──────────────────────────────────────────────────────────

// scripts/.env (gitignored)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const NOTIFY_PHONE = process.env.NOTIFY_PHONE || '+16137697957';
const FROM_PHONE   = '+12495235394'; // Naavi's Twilio number

// firebase/service-account.json (gitignored)
const SA_PATH = path.join(__dirname, '..', 'firebase', 'service-account.json');
if (!fs.existsSync(SA_PATH)) {
  console.error('Missing firebase/service-account.json — see setup instructions at top of this file.');
  process.exit(1);
}
const serviceAccount = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const FIREBASE_PROJECT = serviceAccount.project_id;

// ── Args ──────────────────────────────────────────────────────────────────────
const MATRIX_ID = process.argv[2];
if (!MATRIX_ID) {
  console.error('Usage: node scripts/notify-on-test-complete.js <matrixId>');
  console.error('Example: node scripts/notify-on-test-complete.js matrix-38et6ig33rjpf');
  process.exit(1);
}

// ── Google auth (JWT → access token, no external deps) ───────────────────────

function makeGoogleJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url');
  const toSign    = `${header}.${payload}`;
  const signature = crypto.createSign('RSA-SHA256').update(toSign).sign(serviceAccount.private_key, 'base64url');
  return `${toSign}.${signature}`;
}

async function getAccessToken() {
  const jwt  = makeGoogleJwt();
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res  = await httpPost('oauth2.googleapis.com', '/token', body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  if (!res.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(res)}`);
  return res.access_token;
}

// ── Firebase Test Lab polling ─────────────────────────────────────────────────

async function getMatrixState(token) {
  const res = await httpGet(
    'testing.googleapis.com',
    `/v1/projects/${FIREBASE_PROJECT}/testMatrices/${MATRIX_ID}`,
    { Authorization: `Bearer ${token}` },
  );
  return res;
}

const TERMINAL = new Set(['FINISHED', 'ERROR', 'UNSUPPORTED_ENVIRONMENT',
  'INCOMPATIBLE_ARCHITECTURE', 'CANCELLED', 'INVALID']);

// ── Twilio SMS ────────────────────────────────────────────────────────────────

async function sendSMS(message) {
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    console.warn('[SMS] Twilio credentials missing — skipping SMS. Check scripts/.env');
    return;
  }
  const body = `From=${encodeURIComponent(FROM_PHONE)}&To=${encodeURIComponent(NOTIFY_PHONE)}&Body=${encodeURIComponent(message)}`;
  const res  = await httpPost(
    'api.twilio.com',
    `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    body,
    {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
    },
  );
  if (res.sid) {
    console.log(`[SMS] Sent. SID=${res.sid}`);
  } else {
    console.warn('[SMS] Unexpected response:', JSON.stringify(res));
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpGet(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get({ hostname, path, headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function httpPost(hostname, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, path, method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(body), ...headers },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function estNow() {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
}

// ── Main loop ─────────────────────────────────────────────────────────────────

(async () => {
  console.log(`Watching matrix: ${MATRIX_ID}  (project: ${FIREBASE_PROJECT})`);
  console.log('Will SMS', NOTIFY_PHONE, 'when done. Polling every 30s…\n');

  let token      = await getAccessToken();
  let tokenMints = Date.now();

  while (true) {
    // Refresh token every 55 min (expires at 60 min)
    if (Date.now() - tokenMints > 55 * 60 * 1000) {
      token      = await getAccessToken();
      tokenMints = Date.now();
    }

    try {
      const matrix = await getMatrixState(token);
      const state  = matrix.state || 'UNKNOWN';
      console.log(`[${estNow()} EST]  State: ${state}`);

      if (TERMINAL.has(state)) {
        const executions = matrix.testExecutions || [];
        const allPassed  = executions.every(e => e.state === 'FINISHED');
        const outcome    = allPassed ? '✅ PASSED' : '❌ FAILED';
        const msg = `MyNaavi Firebase Test Lab ${outcome} — ${MATRIX_ID}`;
        console.log('\nTest complete:', msg);
        await sendSMS(msg);
        break;
      }
    } catch (err) {
      console.warn(`[${estNow()} EST]  Poll error: ${err.message}`);
    }

    await sleep(30_000);
  }
})();
