/**
 * manage-voice-pin Edge Function
 *
 * Caller PIN for off-phone voice verification (Wael 2026-05-13).
 *
 * Three operations:
 *   SET    — mobile app sets/changes the user's 4-digit PIN. JWT auth only;
 *            user_id derived from the JWT, never trusted from request body.
 *   REMOVE — clears the stored PIN. JWT auth (mobile Settings) or service-
 *            role (voice server, future). After this, calls from any phone
 *            not in the user's phone_numbers[] cannot be verified and are
 *            hung up after the 3-attempt PIN-prompt lockout.
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

// S1 Track C (2026-08-19) — PINs are 6 digits.
//
// SET requires 6: every new or changed PIN gets the larger keyspace.
// VERIFY accepts 4 or 6 so existing holders are not locked out of the
// borrowed-phone path before they choose a new PIN. That migration window is
// a Phase 0 constraint, not an oversight — a change that silently locked out
// every current user would be worse than the defect it fixes.
//
// Retire PIN_VERIFY_RE (and this comment) once no 4-digit hash remains.
const PIN_SET_RE = /^\d{6}$/;
const PIN_VERIFY_RE = /^\d{4}$|^\d{6}$/;
const BCRYPT_ROUNDS = 10;

// S1 Phase 6 — moved here from the voice server with the rest of the failure
// logic. A judgement, not a calibration: Naavi is pre-launch with two PIN
// holders, so there is no failure-rate data to tune against. Three is low
// enough to catch a real attempt early and high enough that ordinary
// mistyping on a phone keypad does not cry wolf.
const PIN_ALERT_THRESHOLD = 3;

/**
 * Tells the account owner that someone is failing PIN attempts against them,
 * and how to stop it. Returns whether the message actually went out.
 *
 * Moved out of the voice server at Phase 6: deciding to alert and sending the
 * alert are security logic, and an entry point should be translating.
 *
 * Never throws. An alert that fails to send must not fail the call that
 * triggered it — the caller is mid-conversation and the counter write has
 * already succeeded.
 */
async function sendPinFailureAlert(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  toPhone: string,
  count: number,
): Promise<boolean> {
  try {
    const body =
      `Naavi security: ${count} failed PIN attempts on your account from an unregistered phone. `
      + `If this wasn't you, reply BLOCK to stop calls from unregistered phones. `
      + `You can turn it back on in the Naavi app.`;

    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { to: toPhone, body, user_id: userId, source: 's1-pin-failure-alert' },
    });
    if (error) {
      console.error('[manage-voice-pin] pin-alert send failed:', error.message);
      return false;
    }
    if ((data as { blocked?: boolean } | null)?.blocked) {
      // Staging: the T2 outbound allowlist refused it. Expected, not an error.
      console.log('[manage-voice-pin] pin-alert not sent — outbound guard blocked');
      return false;
    }
    console.log(`[manage-voice-pin] pin-alert sent to owner of user_id=${userId.slice(0, 8)}…`);
    return true;
  } catch (err) {
    console.error('[manage-voice-pin] pin-alert threw:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

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

  // S1 Phase 6 — the security-state operations below are service-role only.
  // Same literal comparison the VERIFY path already uses; deliberately NOT
  // changed here. Phase 3 §4.1 recorded this pattern as a known risk (it is
  // what broke during the key rotation) and explicitly deferred it — altering
  // an auth comparison inside a work item that is already changing
  // authentication multiplies the risk of the failure S1 exists to prevent.
  const isServiceRole =
    (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '') === serviceKey;

  // ── SET ─────────────────────────────────────────────────────────────────
  // Two auth paths:
  //   1) JWT auth (mobile app) — user_id comes from the JWT, never trusted
  //      from the request body. A JWT-holder cannot overwrite another
  //      user's PIN by spoofing user_id.
  //   2) Service-role auth (voice server in-call PIN-set flow) — request
  //      body must include explicit user_id. Voice server already knows
  //      the caller's user_id via caller-phone lookup and only sets PINs
  //      for that user.
  if (op === 'set') {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return jsonResponse({ success: false, error: 'auth_required' }, 401);

    let userId: string | null = null;
    if (token === serviceKey) {
      // Service-role path — voice server sets PIN for a user it already
      // resolved via caller-phone lookup. user_id required in body.
      const bodyUserId = String(body?.user_id ?? '').trim();
      if (!bodyUserId) return jsonResponse({ success: false, error: 'user_id_required_for_service_role_set' }, 400);
      userId = bodyUserId;
    } else {
      // JWT path — user_id from the JWT, never from request body.
      try {
        const { data: { user } } = await supabase.auth.getUser(token);
        userId = user?.id ?? null;
      } catch (_) { /* fall through to 401 */ }
      if (!userId) return jsonResponse({ success: false, error: 'jwt_invalid' }, 401);
    }

    const pin = String(body?.pin ?? '').trim();
    if (!PIN_SET_RE.test(pin)) {
      return jsonResponse({ success: false, error: 'pin_must_be_6_digits' }, 400);
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

    // S1 Track D follow-up (2026-08-19) — changing the PIN clears the failure
    // count. Found by Wael in live testing: the alert fires only when the count
    // EQUALS the threshold, and nothing reset the count except a successful PIN
    // on a call or seven days passing. So a user who did exactly the right
    // thing after an attack — blocked, unblocked, changed their PIN — was left
    // sitting above the threshold with their next alert silently disarmed.
    // The counter must measure UNADDRESSED failures; changing the PIN is the
    // clearest possible signal that the owner has addressed it. Old failures
    // were against the old PIN and are meaningless once it changes.
    //
    // Deliberately a SEPARATE, best-effort write rather than part of the update
    // above: these columns arrive with the S1 migration, and an environment
    // that has not applied it yet must still be able to set a PIN. Folding them
    // into the main update would make the whole operation fail there — the same
    // way one missing column already breaks the caller-name query (see B11c).
    const { error: resetErr } = await supabase
      .from('user_settings')
      .update({ voice_pin_failed_count: 0, voice_pin_failed_at: null })
      .eq('user_id', userId);
    if (resetErr) {
      // 42703 = column absent, i.e. pre-S1 backend. Expected, not a failure.
      console.log(`[manage-voice-pin] SET — failure-count reset skipped (${resetErr.message})`);
    }

    console.log(`[manage-voice-pin] SET ok — user_id=${userId.slice(0, 8)}…`);
    return jsonResponse({ success: true });
  }

  // ── REMOVE ──────────────────────────────────────────────────────────────
  // Mirrors SET's auth pattern: JWT (mobile Settings) or service-role
  // (voice server, future). Clears voice_pin_hash + voice_pin_set_at to
  // NULL. Idempotent — removing when no PIN was set still returns success.
  if (op === 'remove') {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return jsonResponse({ success: false, error: 'auth_required' }, 401);

    let userId: string | null = null;
    if (token === serviceKey) {
      const bodyUserId = String(body?.user_id ?? '').trim();
      if (!bodyUserId) return jsonResponse({ success: false, error: 'user_id_required_for_service_role_remove' }, 400);
      userId = bodyUserId;
    } else {
      try {
        const { data: { user } } = await supabase.auth.getUser(token);
        userId = user?.id ?? null;
      } catch (_) { /* fall through to 401 */ }
      if (!userId) return jsonResponse({ success: false, error: 'jwt_invalid' }, 401);
    }

    const { error: updErr } = await supabase
      .from('user_settings')
      .update({ voice_pin_hash: null, voice_pin_set_at: null })
      .eq('user_id', userId);

    if (updErr) {
      console.error('[manage-voice-pin] REMOVE update error:', updErr.message);
      return jsonResponse({ success: false, error: 'db_update_failed' }, 500);
    }

    console.log(`[manage-voice-pin] REMOVE ok — user_id=${userId.slice(0, 8)}…`);
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
    if (!PIN_VERIFY_RE.test(pin)) return jsonResponse({ success: false, error: 'pin_must_be_4_or_6_digits' }, 400);

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

  // ── S1 Phase 6 remediation (2026-08-19) ──────────────────────────────────
  //
  // The three operations below moved here from the voice server, which had
  // been calculating the failure window, mutating the counter, deciding when
  // to alert, and sending the SMS. That is business and security logic living
  // in an entry point, and the architecture is explicit that entry points
  // translate rather than implement. Phase 6 mandatory issue 2.
  //
  // Moving them also FIXES the race (mandatory issue 1), because the increment
  // now happens inside one atomic database operation instead of a
  // read-calculate-write sequence across the network. The two findings had one
  // remedy: the operation becomes atomic BY being owned in the right place.
  //
  // All three are service-role only — they mutate security state.

  // RECORD_FAILURE — one failed PIN attempt against a known account.
  if (op === 'record_failure') {
    if (!isServiceRole) return jsonResponse({ success: false, error: 'service_role_required' }, 401);
    const userId = String(body?.user_id ?? '').trim();
    if (!userId) return jsonResponse({ success: false, error: 'user_id_required' }, 400);

    const { data, error } = await supabase.rpc('record_voice_pin_failure', { p_user_id: userId });
    if (error) {
      console.error('[manage-voice-pin] RECORD_FAILURE rpc error:', error.message);
      return jsonResponse({ success: false, error: 'db_update_failed' }, 500);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      // No such user. Same shape as success so the caller cannot enumerate.
      console.warn(`[manage-voice-pin] RECORD_FAILURE no row for user_id=${userId.slice(0,8)}…`);
      return jsonResponse({ success: true, count: 0, alerted: false });
    }

    const count = Number(row.failed_count ?? 0);
    const phone = row.owner_phone as string | null;

    // Alert exactly once, AT the threshold — not on every failure past it,
    // which would train the owner to ignore it. `count` comes from the atomic
    // statement itself; re-reading it here would reintroduce the race by the
    // back door (see the function's COMMENT in the migration).
    let alerted = false;
    if (count === PIN_ALERT_THRESHOLD && phone) {
      alerted = await sendPinFailureAlert(supabase, userId, phone, count);
    }

    console.log(`[manage-voice-pin] RECORD_FAILURE user_id=${userId.slice(0,8)}… count=${count} alerted=${alerted}`);
    return jsonResponse({ success: true, count, alerted });
  }

  // CLEAR_FAILURES — the owner has addressed it (correct PIN, PIN change, or
  // unblocking). No atomicity concern: setting to zero is idempotent.
  if (op === 'clear_failures') {
    if (!isServiceRole) return jsonResponse({ success: false, error: 'service_role_required' }, 401);
    const userId = String(body?.user_id ?? '').trim();
    if (!userId) return jsonResponse({ success: false, error: 'user_id_required' }, 400);

    const { error } = await supabase
      .from('user_settings')
      .update({ voice_pin_failed_count: 0, voice_pin_failed_at: null })
      .eq('user_id', userId);
    if (error) {
      console.error('[manage-voice-pin] CLEAR_FAILURES error:', error.message);
      return jsonResponse({ success: false, error: 'db_update_failed' }, 500);
    }
    console.log(`[manage-voice-pin] CLEAR_FAILURES user_id=${userId.slice(0,8)}…`);
    return jsonResponse({ success: true });
  }

  // SET_BLOCKED — refuse (or re-allow) unregistered-phone access.
  //
  // `receive-sms-reply` routes the BLOCK command here rather than mutating the
  // column itself; Phase 6 accepted that webhook as a command router but not
  // as the owner of the security state.
  //
  // Only `blocked: true` is reachable from the phone channel. Re-enabling is
  // the mobile app's job — the recovery channel must stay stronger than the
  // channel under attack, so someone working the phone line cannot undo it.
  if (op === 'set_blocked') {
    if (!isServiceRole) return jsonResponse({ success: false, error: 'service_role_required' }, 401);
    const userId  = String(body?.user_id ?? '').trim();
    const blocked = body?.blocked === true;
    if (!userId) return jsonResponse({ success: false, error: 'user_id_required' }, 400);

    const { error } = await supabase
      .from('user_settings')
      .update({ voice_unregistered_blocked: blocked })
      .eq('user_id', userId);
    if (error) {
      console.error('[manage-voice-pin] SET_BLOCKED error:', error.message);
      return jsonResponse({ success: false, error: 'db_update_failed' }, 500);
    }
    console.log(`[manage-voice-pin] SET_BLOCKED=${blocked} user_id=${userId.slice(0,8)}…`);
    return jsonResponse({ success: true, blocked });
  }

  return jsonResponse({ success: false, error: `unknown op: ${op}` }, 400);
});
