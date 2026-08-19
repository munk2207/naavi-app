/**
 * outbound_guard — environment-conditional outbound safety for Voice staging (T2).
 *
 * Two exports, one concern: keeping a non-production deployment from reaching
 * the real world.
 *
 *   guardDestination() — blocks sends to destinations outside an approved
 *                        allowlist.
 *   resolveCallerId()  — supplies the caller ID outbound voice calls present.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * An action created by a Voice call does NOT finish executing inside the voice
 * server. The voice server writes a row and exits; a cron inside Supabase picks
 * it up a minute later and performs the send itself. T2 Phase 1A traced 14 such
 * outbound call sites — 6 calling Twilio directly, 8 via the shared senders.
 * A destination allowlist living in the voice Railway service would observe
 * exactly one of them (docs/T2_PHASE_1A_CREATING_VOICE_STAGING_2026-08-19.md §3).
 * Enforcement therefore has to sit here, in Shared Core, at the point of send.
 *
 * ── The safety property: inert unless explicitly enabled ───────────────────
 * Both functions no-op when their controlling secret is absent. The secrets are
 * set ONLY on the staging Supabase project, so production is protected BY
 * CONSTRUCTION rather than by correct configuration — even if this code were
 * deployed to production, every call would fall through to existing behavior.
 *
 * This matters more than it might look. These functions sit on the send path of
 * every alert channel the product has, and the failure mode is not a visible
 * error — it is silent alert loss, which the Architecture Reference describes as
 * "invisible until the user notices it never happened." Default-open is the only
 * responsible default here, and the guard-is-inert case is the single most
 * important regression test in the T2 suite.
 *
 * ── Configuration (staging Supabase only) ──────────────────────────────────
 *   OUTBOUND_ALLOWLIST      Comma-separated phone numbers and/or email
 *                           addresses. Set = enforce. Unset/empty = allow all.
 *   VOICE_CALL_FROM_NUMBER  E.164 caller ID for outbound voice calls.
 *                           Unset = fall back to the production number.
 *
 * Governance: T2 Phase 2 §1 and §8.2, risk HIGH, Protected Core (Notification
 * routing). Do not add behavior here that is not in that plan.
 */

/** Production outbound voice caller ID — the fallback when no override is set. */
const PRODUCTION_CALLER_ID = '+12495235394';

/**
 * Normalizes a phone number for comparison: strips every character except
 * digits, then compares on the last 10 digits so +1XXXXXXXXXX, 1XXXXXXXXXX,
 * (XXX) XXX-XXXX and XXXXXXXXXX all match each other.
 *
 * Emails are lowercased and trimmed instead. Anything that isn't obviously a
 * phone number is treated as an email/opaque identifier — deliberately, so an
 * unrecognized destination shape can never silently normalize to something that
 * happens to match an allowlist entry.
 */
function normalizeDestination(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.includes('@')) return value.toLowerCase();

  const digits = value.replace(/\D/g, '');
  if (!digits) return value.toLowerCase();
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function parseAllowlist(): string[] | null {
  const raw = Deno.env.get('OUTBOUND_ALLOWLIST');
  if (!raw || !raw.trim()) return null;          // absent → guard inert
  const entries = raw
    .split(',')
    .map((e) => normalizeDestination(e))
    .filter((e) => e.length > 0);
  return entries.length > 0 ? entries : null;    // present but empty → inert
}

export interface GuardResult {
  /** true = the caller should proceed with the send. */
  allowed: boolean;
  /** Present only when allowed === false. Safe to log. */
  reason?: string;
  /** Whether the guard was active at all (i.e. the allowlist secret was set). */
  enforced: boolean;
}

/**
 * Decides whether an outbound send may proceed.
 *
 * @param destination phone number or email address the send targets
 * @param channel     'sms' | 'whatsapp' | 'email' | 'push' | 'voice' — logging only
 * @param context     short caller identifier for the log line, e.g. 'evaluate-rules'
 */
export function guardDestination(
  destination: string,
  channel: string,
  context: string,
): GuardResult {
  const allowlist = parseAllowlist();

  if (allowlist === null) {
    // Inert. Production path. No log line — this runs on every production send
    // and must stay silent and cheap.
    return { allowed: true, enforced: false };
  }

  const target = normalizeDestination(destination);

  // An empty/malformed destination under an active allowlist is blocked rather
  // than allowed: with the guard on, we are in a non-production environment and
  // "we could not tell where this was going" must not resolve to "send it."
  if (!target) {
    console.warn(
      `[outbound_guard] BLOCKED ${channel} from ${context} — destination empty or unparseable (env=${resolveProjectRef()})`,
    );
    return { allowed: false, enforced: true, reason: 'destination empty or unparseable' };
  }

  if (allowlist.includes(target)) {
    console.log(
      `[outbound_guard] allowed ${channel} from ${context} (env=${resolveProjectRef()})`,
    );
    return { allowed: true, enforced: true };
  }

  console.warn(
    `[outbound_guard] BLOCKED ${channel} from ${context} — destination not in OUTBOUND_ALLOWLIST (env=${resolveProjectRef()})`,
  );
  return {
    allowed: false,
    enforced: true,
    reason: 'destination not in OUTBOUND_ALLOWLIST',
  };
}

/**
 * The caller ID an outbound voice call should present.
 *
 * Staging sets VOICE_CALL_FROM_NUMBER to its own Twilio number so a staging
 * call never presents as production Naavi — and so calling that number back
 * reaches the staging service rather than production (T2 Phase 2 §8.2).
 * Unset → the production number, unchanged.
 */
export function resolveCallerId(): string {
  const override = Deno.env.get('VOICE_CALL_FROM_NUMBER');
  return override && override.trim() ? override.trim() : PRODUCTION_CALLER_ID;
}

/**
 * The Supabase project ref this function is actually executing against, parsed
 * from SUPABASE_URL at runtime.
 *
 * Phase 0 Requirement 4: evidence must prove "this transaction executed in
 * staging," not "the environment variable was configured for staging." A log
 * line carrying the resolved ref is observed fact — it cannot be produced by a
 * deployment that in fact reached the other project.
 */
export function resolveProjectRef(): string {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match ? match[1] : 'unknown';
}
