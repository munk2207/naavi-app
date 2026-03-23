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

// ─── Epic OAuth endpoints (sandbox) ──────────────────────────────────────────

const EPIC_CLIENT_ID   = '0895a031-228f-41e5-a687-b52e6434dd9e';
const EPIC_AUTH_URL    = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize';
const EPIC_TOKEN_URL   = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const EPIC_FHIR_BASE   = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';
const REDIRECT_URI     = 'https://naavi-app.vercel.app/auth/epic/callback';

const EPIC_SCOPES = [
  'launch/patient',
  'openid',
  'fhirUser',
  'patient/Patient.read',
  'patient/MedicationRequest.read',
  'patient/Appointment.read',
  'patient/Observation.read',
  'patient/Condition.read',
].join(' ');

// ─── Connection status ────────────────────────────────────────────────────────

const CONNECTED_FLAG = 'naavi_epic_connected';

export function markEpicConnected(): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(CONNECTED_FLAG, '1');
}

export function markEpicDisconnected(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(CONNECTED_FLAG);
}

export async function isEpicConnected(): Promise<boolean> {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(CONNECTED_FLAG)) return true;
  if (!supabase) return false;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  const { data } = await supabase
    .from('epic_tokens')
    .select('id')
    .eq('user_id', session.user.id)
    .limit(1);
  const connected = Boolean(data && data.length > 0);
  if (connected) markEpicConnected();
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
    aud:                   EPIC_FHIR_BASE,
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
    console.error('[Epic] PKCE state mismatch');
    return false;
  }

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  REDIRECT_URI,
    client_id:     EPIC_CLIENT_ID,
    code_verifier: verifier,
  });

  const tokenRes = await fetch(EPIC_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!tokenRes.ok) {
    console.error('[Epic] Token exchange failed:', await tokenRes.text());
    return false;
  }

  const tokens = await tokenRes.json();

  // Store tokens server-side via Edge Function
  const { data: { session } } = await supabase!.auth.getSession();
  if (!session) return false;

  const { error } = await supabase!.functions.invoke('store-epic-token', {
    body: {
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_in:    tokens.expires_in    ?? 3600,
      patient_id:    tokens.patient       ?? null,
      scope:         tokens.scope         ?? '',
    },
  });

  if (error) {
    console.error('[Epic] store-epic-token failed:', error);
    return false;
  }

  // Clean up PKCE state
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('naavi_epic_verifier');
    sessionStorage.removeItem('naavi_epic_state');
    sessionStorage.removeItem('naavi_epic_oauth_pending');
  }

  markEpicConnected();
  return true;
}
