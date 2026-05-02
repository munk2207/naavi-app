/**
 * Epic FHIR integration — Phase 9
 *
 * Robert connects once via SMART on FHIR OAuth (authorization code + PKCE).
 * The refresh token is stored server-side in the epic_tokens table.
 * A scheduled Edge Function (sync-epic-data) pulls new health data every 12 hours.
 * All lookups query the Supabase cache — no token expiry issues for Robert.
 *
 * Epic sandbox Client ID: 0895a031-228f-41e5-a687-b52e6434dd9e
 */

import { supabase } from './supabase';
import { queryWithTimeout, getSessionWithTimeout } from './invokeWithTimeout';
import { justForegrounded } from './appLifecycle';

// ─── Epic OAuth endpoints (sandbox) ──────────────────────────────────────────

const EPIC_CLIENT_ID   = 'f2b6e09c-0569-4ecf-8e81-027432281052';
const EPIC_AUTH_URL    = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize';
const REDIRECT_URI     = 'https://naavi-app.vercel.app/auth/epic/callback';

// SMART v2 scope format (r=read, s=search) — matches app's SMART v2 registration on Epic
const EPIC_SCOPES = [
  'openid',
  'fhirUser',
  'patient/Patient.r',
  'patient/Patient.s',
  'patient/MedicationRequest.r',
  'patient/MedicationRequest.s',
  'patient/Appointment.r',
  'patient/Appointment.s',
  'patient/Observation.r',
  'patient/Observation.s',
  'patient/Condition.r',
  'patient/Condition.s',
].join(' ');

// ─── Connection status ────────────────────────────────────────────────────────

const CONNECTED_FLAG = 'naavi_epic_connected';

// V57.10.1 — module-level cache for the connection check. Without this,
// every chat send pays a Supabase round-trip just to discover the user
// hasn't connected Epic. We cache for 5 minutes so connect/disconnect
// state stays reasonably fresh, while non-connected users (the common
// case) skip the network on every send. Wael 2026-05-01: chat felt
// "frozen" for 1.5 s because getEpicHealthContext fired three parallel
// epic_* table queries even though no Epic token existed.
let epicConnectionCache: { value: boolean; ts: number } | null = null;
const EPIC_CACHE_TTL_MS = 5 * 60 * 1000;

export function markEpicConnected(): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(CONNECTED_FLAG, '1');
  epicConnectionCache = { value: true, ts: Date.now() };
}

export function markEpicDisconnected(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(CONNECTED_FLAG);
  epicConnectionCache = { value: false, ts: Date.now() };
}

export async function isEpicConnected(): Promise<boolean> {
  // Fast path 1 — module-level memo is fresh.
  if (epicConnectionCache && Date.now() - epicConnectionCache.ts < EPIC_CACHE_TTL_MS) {
    return epicConnectionCache.value;
  }
  // Fast path 2 — web-only flag set when token was stored.
  if (typeof localStorage !== 'undefined' && localStorage.getItem(CONNECTED_FLAG)) {
    epicConnectionCache = { value: true, ts: Date.now() };
    return true;
  }
  if (!supabase) {
    epicConnectionCache = { value: false, ts: Date.now() };
    return false;
  }
  const session = await getSessionWithTimeout();
  if (!session?.user) {
    epicConnectionCache = { value: false, ts: Date.now() };
    return false;
  }
  const queryEpicTokens = async () => {
    const { data } = await queryWithTimeout(
      supabase!
        .from('epic_tokens')
        .select('id')
        .eq('user_id', session.user.id)
        .limit(1),
      15_000,
      'select-epic-tokens',
    );
    return Boolean(data && data.length > 0);
  };
  let connected = await queryEpicTokens();
  // V57.10.3 — apply the same JWT-refresh-race retry pattern as
  // isCalendarConnected (V57.10.0). After Android brings the app back
  // from a permission round-trip, the Supabase JWT can be briefly
  // stale and RLS-gated reads return 0 rows even when the row exists.
  // We retry only when we just foregrounded (≤10 s window) so the
  // regular "actually disconnected" path is not slowed down.
  if (!connected && justForegrounded(10_000)) {
    await new Promise((r) => setTimeout(r, 1500));
    connected = await queryEpicTokens();
  }
  if (connected) markEpicConnected();
  else epicConnectionCache = { value: false, ts: Date.now() };
  return connected;
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ─── OAuth connect ────────────────────────────────────────────────────────────

export async function connectEpic(): Promise<void> {
  const verifier   = generateCodeVerifier();
  const challenge  = await generateCodeChallenge(verifier);
  const state      = crypto.randomUUID();

  // Persist PKCE verifier and state across redirect
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('naavi_epic_verifier', verifier);
    sessionStorage.setItem('naavi_epic_state',    state);
    sessionStorage.setItem('naavi_epic_oauth_pending', '1');
  }

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             EPIC_CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    scope:                 EPIC_SCOPES,
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    prompt:                'login',
  });

  window.location.href = `${EPIC_AUTH_URL}?${params.toString()}`;
}

export function disconnectEpic(): void {
  markEpicDisconnected();
}

// ─── Callback handler (called from /auth/epic/callback page) ─────────────────

export async function handleEpicCallback(code: string, returnedState: string): Promise<boolean> {
  const verifier      = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('naavi_epic_verifier') : null;
  const expectedState = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('naavi_epic_state')    : null;

  if (!verifier || !expectedState || returnedState !== expectedState) {
    console.error('[Epic] PKCE state mismatch', { verifier: !!verifier, expectedState, returnedState });
    return false;
  }

  // Exchange code for tokens via Edge Function (avoids browser CSP restrictions)
  const { data, error } = await supabase!.functions.invoke('exchange-epic-code', {
    body: { code, code_verifier: verifier },
  });

  if (error || !data?.ok) {
    console.error('[Epic] exchange-epic-code failed:', error ?? data?.error);
    return false;
  }

  console.log('[Epic] Connected — patient:', data.patient_id);

  // Clean up PKCE state
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('naavi_epic_verifier');
    sessionStorage.removeItem('naavi_epic_state');
    sessionStorage.removeItem('naavi_epic_oauth_pending');
  }

  markEpicConnected();
  return true;
}

// ─── Health context for Naavi conversations ───────────────────────────────────

export async function getEpicHealthContext(): Promise<string> {
  if (!supabase) return '';
  // V57.10.1 — short-circuit when Epic isn't connected. Without this we paid
  // 3 parallel epic_* table round-trips on every chat send even for users
  // who never linked Epic, adding ~1-1.5 s of perceived "frozen" wait.
  // isEpicConnected() is module-cached for 5 min so this check is free
  // after the first call.
  const connected = await isEpicConnected();
  if (!connected) return '';
  try {
    const [medsRes, apptsRes, condsRes] = await Promise.all([
      queryWithTimeout(
        supabase
          .from('epic_medications')
          .select('name, dosage, status')
          .eq('status', 'active')
          .order('name'),
        15_000,
        'select-epic-medications',
      ),
      queryWithTimeout(
        supabase
          .from('epic_appointments')
          .select('title, start_iso, location')
          .order('start_iso', { ascending: false })
          .limit(5),
        15_000,
        'select-epic-appointments',
      ),
      queryWithTimeout(
        supabase
          .from('epic_conditions')
          .select('name, status')
          .order('name'),
        15_000,
        'select-epic-conditions',
      ),
    ]);

    const lines: string[] = [];

    if (medsRes.data && medsRes.data.length > 0) {
      lines.push('## Robert\'s medications (from MyChart)');
      medsRes.data.forEach(m => {
        lines.push(`- ${m.name}${m.dosage ? ` — ${m.dosage}` : ''}`);
      });
    }

    if (apptsRes.data && apptsRes.data.length > 0) {
      lines.push('## Upcoming medical appointments (from MyChart)');
      apptsRes.data.forEach(a => {
        const date = a.start_iso ? new Date(a.start_iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
        lines.push(`- ${a.title}${date ? ` on ${date}` : ''}${a.location ? ` at ${a.location}` : ''}`);
      });
    }

    if (condsRes.data && condsRes.data.length > 0) {
      lines.push('## Robert\'s medical conditions (from MyChart)');
      condsRes.data.forEach(c => {
        lines.push(`- ${c.name}${c.status && c.status !== 'active' ? ` (${c.status})` : ''}`);
      });
    }

    return lines.length > 0 ? lines.join('\n') : '';
  } catch {
    return '';
  }
}
