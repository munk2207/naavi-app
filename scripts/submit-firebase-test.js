/**
 * Firebase Test Lab — automatic APK submission + SMS notification.
 *
 * Does everything in one command:
 *   1. Downloads the APK from EAS build URL
 *   2. Uploads APK + robo script to Firebase Storage (GCS)
 *   3. Submits test matrix to Firebase Test Lab
 *   4. Prints the matrix ID
 *   5. Starts polling and sends SMS when tests finish
 *
 * Usage:
 *   node scripts/submit-firebase-test.js <apkUrl>
 *
 * Example:
 *   node scripts/submit-firebase-test.js https://expo.dev/artifacts/eas/q5ZHC8jUyfejFpxHo5VCjJ.apk
 *
 * Credentials used:
 *   firebase/service-account.json  — Google Cloud service account
 *   scripts/.env                   — Twilio + Firebase project ID
 *
 * Devices tested:
 *   - Pixel 6 (oriole) — Android 13
 *   - Samsung Galaxy S10 (beyond1q) — Android 10
 */

'use strict';
const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const os     = require('os');

// ── Load credentials ──────────────────────────────────────────────────────────

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const TWILIO_SID        = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN      = process.env.TWILIO_AUTH_TOKEN;
const NOTIFY_PHONE      = process.env.NOTIFY_PHONE      || '+16137697957';
const FROM_PHONE        = '+12495235394';
const FIREBASE_PROJECT  = process.env.FIREBASE_PROJECT_ID || 'mynaavi-3b74b';
const GCS_BUCKET        = 'mynaavi-testlab-uploads';
const GCS_FOLDER        = 'firebase-test-lab';

const SA_PATH = path.join(__dirname, '..', 'firebase', 'service-account.json');
if (!fs.existsSync(SA_PATH)) {
  console.error('Missing firebase/service-account.json');
  process.exit(1);
}
const serviceAccount = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));

const ROBO_SCRIPT_PATH = path.join(__dirname, '..', 'firebase', 'robo-script-onboarding.json');

// ── Args ──────────────────────────────────────────────────────────────────────

let APK_URL = process.argv[2];
if (!APK_URL) {
  console.error('Usage: node scripts/submit-firebase-test.js <apkUrl|easBuildId>');
  console.error('Example: node scripts/submit-firebase-test.js https://expo.dev/artifacts/eas/q5ZHC8jUyfejFpxHo5VCjJ.apk');
  console.error('         node scripts/submit-firebase-test.js https://expo.dev/accounts/waggan/projects/naavi/builds/<id>');
  process.exit(1);
}

// If it's an EAS build page URL (not a direct .apk), extract the artifact URL via EAS CLI.
const BUILD_PAGE_RE = /expo\.dev\/accounts\/[^/]+\/projects\/[^/]+\/builds\/([a-f0-9-]{36})/;
const buildPageMatch = APK_URL.match(BUILD_PAGE_RE);
if (buildPageMatch) {
  const buildId = buildPageMatch[1];
  console.log(`Detected EAS build page URL — fetching artifact URL for build ${buildId}…`);
  const { execSync } = require('child_process');
  try {
    const json = execSync(`npx eas build:view ${buildId} --json`, { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
    const parsed = JSON.parse(json.replace(/^[^{]*/s, '').trim());
    APK_URL = parsed?.artifacts?.applicationArchiveUrl || parsed?.artifacts?.buildUrl;
    if (!APK_URL) throw new Error('No artifact URL in EAS response');
    console.log(`     ✓ Artifact URL: ${APK_URL}\n`);
  } catch (err) {
    console.error('Failed to resolve artifact URL from EAS:', err.message);
    process.exit(1);
  }
}

// ── Google auth ───────────────────────────────────────────────────────────────

function makeGoogleJwt(scopes) {
  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   serviceAccount.client_email,
    scope: scopes,
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url');
  const toSign    = `${header}.${payload}`;
  const sig       = crypto.createSign('RSA-SHA256').update(toSign).sign(serviceAccount.private_key, 'base64url');
  return `${toSign}.${sig}`;
}

async function getAccessToken() {
  const jwt  = makeGoogleJwt('https://www.googleapis.com/auth/cloud-platform');
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res  = await httpPost('oauth2.googleapis.com', '/token', body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  if (!res.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(res)}`);
  return res.access_token;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpGet(hostname, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get({ hostname, path: urlPath, headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    }).on('error', reject);
  });
}

function httpPost(hostname, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, path: urlPath, method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(body), ...headers },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Follow redirects and download binary file to disk.
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
      }
      const out  = fs.createWriteStream(destPath);
      let   size = 0;
      res.on('data', chunk => { size += chunk.length; process.stdout.write(`\r  Downloading… ${(size / 1024 / 1024).toFixed(1)} MB`); });
      res.pipe(out);
      out.on('finish', () => { console.log(''); resolve(); });
      out.on('error', reject);
    }).on('error', reject);
  });
}

// Upload a file to GCS using the JSON API.
async function uploadToGCS(token, localPath, gcsObjectName, contentType) {
  const fileBuffer = fs.readFileSync(localPath);
  const fileSize   = fileBuffer.length;
  const objectName = encodeURIComponent(gcsObjectName);
  const uploadPath = `/upload/storage/v1/b/${GCS_BUCKET}/o?uploadType=media&name=${objectName}`;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'storage.googleapis.com',
      path:     uploadPath,
      method:   'POST',
      headers:  {
        Authorization:   `Bearer ${token}`,
        'Content-Type':  contentType,
        'Content-Length': fileSize,
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

// ── Firebase Test Lab ─────────────────────────────────────────────────────────

async function submitTestMatrix(token, apkGcsPath, roboGcsPath) {
  const body = JSON.stringify({
    projectId: FIREBASE_PROJECT,
    testSpecification: {
      androidRoboTest: {
        appApk: { gcsPath: apkGcsPath },
        roboScript: { gcsPath: roboGcsPath },
      },
    },
    environmentMatrix: {
      androidDeviceList: {
        androidDevices: [
          // Pixel 6 — Android 13 — broad baseline
          { androidModelId: 'oriole', androidVersionId: '33', locale: 'en', orientation: 'portrait' },
          // Samsung Galaxy S22 — Android 14 — Samsung One UI rendering
          { androidModelId: 'r0q', androidVersionId: '34', locale: 'en', orientation: 'portrait' },
        ],
      },
    },
    resultStorage: {
      googleCloudStorage: {
        gcsPath: `gs://${GCS_BUCKET}/${GCS_FOLDER}/results/`,
      },
    },
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'testing.googleapis.com',
      path:     `/v1/projects/${FIREBASE_PROJECT}/testMatrices`,
      method:   'POST',
      headers:  {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── SMS + polling (same as notify-on-test-complete.js) ───────────────────────

async function sendSMS(message) {
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    console.warn('[SMS] Twilio credentials missing — skipping SMS.');
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
  if (res.sid) console.log(`[SMS] Sent. SID=${res.sid}`);
  else         console.warn('[SMS] Unexpected response:', JSON.stringify(res));
}

const TERMINAL = new Set(['FINISHED', 'ERROR', 'UNSUPPORTED_ENVIRONMENT',
  'INCOMPATIBLE_ARCHITECTURE', 'CANCELLED', 'INVALID']);

function estNow() {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollUntilDone(matrixId, token, tokenMintedAt) {
  console.log(`\nPolling matrix ${matrixId} every 30s… (SMS will arrive at ${NOTIFY_PHONE})`);
  let currentToken     = token;
  let currentMintedAt = tokenMintedAt;

  while (true) {
    if (Date.now() - currentMintedAt > 55 * 60 * 1000) {
      currentToken     = await getAccessToken();
      currentMintedAt = Date.now();
    }
    try {
      const matrix = await httpGet(
        'testing.googleapis.com',
        `/v1/projects/${FIREBASE_PROJECT}/testMatrices/${matrixId}`,
        { Authorization: `Bearer ${currentToken}` },
      );
      const state = matrix.state || 'UNKNOWN';
      console.log(`[${estNow()} EST]  State: ${state}`);

      if (TERMINAL.has(state)) {
        const executions = matrix.testExecutions || [];
        // INVALID / ERROR / CANCELLED = no executions ran → always a failure
        const terminalOk = state === 'FINISHED';
        const allPassed  = terminalOk && executions.length > 0 && executions.every(e => e.state === 'FINISHED');
        const outcome    = allPassed ? '✅ PASSED' : '❌ FAILED';
        const detail     = state !== 'FINISHED' ? ` (matrix state: ${state})` : '';
        const msg        = `MyNaavi Firebase Test Lab ${outcome}${detail} — ${matrixId}`;
        console.log('\nTest complete:', msg);
        if (matrix.extendedInvalidMatrixDetails) {
          matrix.extendedInvalidMatrixDetails.forEach(d => console.error(`  ❌ ${d.reason}: ${d.message}`));
        }
        await sendSMS(msg);
        console.log(`\nView results: https://console.firebase.google.com/project/${FIREBASE_PROJECT}/testlab`);
        break;
      }
    } catch (err) {
      console.warn(`[${estNow()} EST]  Poll error: ${err.message}`);
    }
    await sleep(30_000);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('MyNaavi Firebase Test Lab — automatic submission\n');

  // 1. Auth
  console.log('1/5  Getting Google access token…');
  const token     = await getAccessToken();
  const mintedAt  = Date.now();
  console.log('     ✓ Token obtained');

  // 2. Download APK
  const tmpApk = path.join(os.tmpdir(), 'naavi-test.apk');
  console.log(`\n2/5  Downloading APK from EAS…`);
  console.log(`     ${APK_URL}`);
  await downloadFile(APK_URL, tmpApk);
  const apkSizeMB = (fs.statSync(tmpApk).size / 1024 / 1024).toFixed(1);
  console.log(`     ✓ APK downloaded (${apkSizeMB} MB) → ${tmpApk}`);

  // 3. Upload APK to GCS
  const apkGcsName = `${GCS_FOLDER}/naavi-v207.apk`;
  console.log(`\n3/5  Uploading APK to gs://${GCS_BUCKET}/${apkGcsName}…`);
  const apkUpload = await uploadToGCS(token, tmpApk, apkGcsName, 'application/vnd.android.package-archive');
  if (apkUpload.error) throw new Error(`APK upload failed: ${JSON.stringify(apkUpload.error)}`);
  console.log(`     ✓ APK uploaded`);

  // 4. Upload robo script to GCS
  const roboGcsName = `${GCS_FOLDER}/robo-script-onboarding.json`;
  const roboTmp     = path.join(os.tmpdir(), 'robo-script.json');
  fs.copyFileSync(ROBO_SCRIPT_PATH, roboTmp);
  console.log(`\n4/5  Uploading robo script to gs://${GCS_BUCKET}/${roboGcsName}…`);
  const roboUpload = await uploadToGCS(token, roboTmp, roboGcsName, 'application/json');
  if (roboUpload.error) throw new Error(`Robo script upload failed: ${JSON.stringify(roboUpload.error)}`);
  console.log(`     ✓ Robo script uploaded`);

  // 5. Submit test matrix
  console.log(`\n5/5  Submitting test matrix to Firebase Test Lab…`);
  const apkGcsPath  = `gs://${GCS_BUCKET}/${apkGcsName}`;
  const roboGcsPath = `gs://${GCS_BUCKET}/${roboGcsName}`;
  const matrix      = await submitTestMatrix(token, apkGcsPath, roboGcsPath);

  if (matrix.error) {
    console.error('\n❌ Test matrix submission failed:');
    console.error(JSON.stringify(matrix.error, null, 2));
    process.exit(1);
  }

  const matrixId = matrix.testMatrixId;
  if (!matrixId) {
    console.error('\n❌ No matrixId in response:');
    console.error(JSON.stringify(matrix, null, 2));
    process.exit(1);
  }

  console.log(`\n✅ Test matrix submitted!`);
  console.log(`   Matrix ID : ${matrixId}`);
  console.log(`   Devices   : Pixel 6 (Android 13) + Samsung Galaxy S22 (Android 14)`);
  console.log(`   View in   : https://console.firebase.google.com/project/${FIREBASE_PROJECT}/testlab`);
  console.log('');

  // Poll + SMS
  await pollUntilDone(matrixId, token, mintedAt);
})();
