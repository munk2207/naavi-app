/**
 * manage-voice-pin Edge Function
 *
 * Caller PIN for off-phone voice verification (Wael 2026-05-13).
 *
 * Two operations:
 *   SET    — mobile app sets/changes the user's 4-digit PIN. JWT auth only;
 *            user_id derived from the JWT, never trusted from request body.
 *   VERIFY — voice server compares a spoken/DTMF PIN against the stored
 *            hash to identify a caller on an unregistered phone. Service-
 *            role auth only; user_id taken from request body.
 *
 * PIN is hashed with bcrypt (10 rounds) before any DB write. Plaintext PIN
 * never persisted. Hash never returned to clients.
 *
 * Lockout (3 failed attempts) is enforced in the voice server per-call —
 * NOT here. This function just returns { match: true | false }; same
 * shape for "user not found", "no PIN set", or "wrong PIN" so the caller
 * can't enumerate user_ids by error message differences.
 *
 * Spec: project_naavi_caller_pin_chosen_over_biometric.md.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import bcrypt from 'npm:bcryptjs@2.4.3';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PIN_RE = /^\d{4}$/;
const BCRYPT_ROUNDS = 10;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return jsonResponse({ error: 'POST required' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }

  const op = String(body?.op ?? '').toLowerCase();

  // ── SET ─────────────────────────────────────────────────────────────────
  // Mobile-only. JWT auth required. user_id MUST come from the JWT, never
  // from the request body — otherwise a JWT-holder could overwrite another
  // user's PIN by spoofing user_id.
  if (op === 'set') {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return jsonResponse({ success: false, error: 'jwt_required' }, 401);

    let userId: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    } catch (_) { /* fall through to 401 */ }
    if (!userId) return jsonResponse({ success: false, error: 'jwt_invalid' }, 401);

    const pin = String(body?.pin ?? '').trim();
    if (!PIN_RE.test(pin)) {
      return jsonResponse({ success: false, error: 'pin_must_be_4_digits' }, 400);
    }

    const hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);

    // Upsert into user_settings — user_settings row should already exist
    // (created on first login), but a row-not-found case shouldn't 404 the
    // PIN set. Use update + fall back to insert.
    const { error: updErr, data: updRows } = await supabase
      .from('user_settings')
      .update({ voice_pin_hash: hash, voice_pin_set_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select('user_id');

    if (updErr) {
      console.error('[manage-voice-pin] SET update error:', updErr.message);
      return jsonResponse({ success: false, error: 'db_update_failed' }, 500);
    }

    if (!updRows || updRows.length === 0) {
      // No existing row — insert a fresh settings record with just the PIN
      // fields. Other columns left NULL; subsequent app activity will
      // populate them.
      const { error: insErr } = await supabase
        .from('user_settings')
        .insert({ user_id: userId, voice_pin_hash: hash, voice_pin_set_at: new Date().toISOString() });
      if (insErr) {
        console.error('[manage-voice-pin] SET insert error:', insErr.message);
        return jsonResponse({ success: false, error: 'db_insert_failed' }, 500);
      }
    }

    console.log(`[manage-voice-pin] SET ok — user_id=${userId.slice(0, 8)}…`);
    return jsonResponse({ success: true });
  }

  // ── VERIFY ──────────────────────────────────────────────────────────────
  // Service-role only. Voice server calls this with the user_id it's trying
  // to identify (caller's phone-number lookup may resolve to a candidate,
  // OR the voice server iterates candidates from a phone-area-code match).
  if (op === 'verify') {
    // Require service-role auth. The Authorization header should match the
    // service role key — anonymous / JWT callers must not be able to test
    // PINs against other users.
    const authHeader = req.headers.get('Authorization') ?? '';
    const presentedKey = authHeader.replace(/^Bearer\s+/i, '');
    if (presentedKey !== serviceKey) {
      return jsonResponse({ success: false, error: 'service_role_required' }, 401);
    }

    const userId = String(body?.user_id ?? '').trim();
    const pin    = String(body?.pin     ?? '').trim();
    if (!userId)             return jsonResponse({ success: false, error: 'user_id_required' }, 400);
    if (!PIN_RE.test(pin))   return jsonResponse({ success: false, error: 'pin_must_be_4_digits' }, 400);

    const { data, error } = await supabase
      .from('user_settings')
      .select('voice_pin_hash')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[manage-voice-pin] VERIFY query error:', error.message);
      return jsonResponse({ success: false, error: 'db_query_failed' }, 500);
    }

    const hash = (data as any)?.voice_pin_hash as string | null;
    // Same false-response shape whether: (a) no settings row, (b) no PIN
    // set, (c) wrong PIN. Prevents user-id enumeration via error timing /
    // text. Short-circuit bcrypt.compare when there's no hash to avoid
    // wasting CPU; the timing difference here doesn't help an attacker
    // since user_ids are UUIDs (not enumerable).
    if (!hash) {
      console.log(`[manage-voice-pin] VERIFY no_hash user_id=${userId.slice(0,8)}…`);
      return jsonResponse({ success: true, match: false });
    }

    const match = await bcrypt.compare(pin, hash);
    console.log(`[manage-voice-pin] VERIFY ${match ? 'match' : 'no_match'} user_id=${userId.slice(0,8)}…`);
    return jsonResponse({ success: true, match });
  }

  return jsonResponse({ success: false, error: `unknown op: ${op}` }, 400);
});
