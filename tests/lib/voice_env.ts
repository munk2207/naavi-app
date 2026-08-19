/**
 * voice_env — which voice server a run may talk to (T2-F1, 2026-08-19).
 *
 * Until T2 there was one voice server, so `VOICE_SERVER_URL` was a single
 * hardcoded production value and Gate 2 always tested production no matter
 * which Supabase project the run targeted. With a staging voice server live,
 * that is a split-brain hazard: DB fixtures against staging while live voice
 * calls hit production — the same failure class as the 2026-07-20 incident
 * that produced the runner's environment banner.
 *
 * Extracted as a pure function rather than left inline in runner.ts so it can
 * be unit-tested without running the suite. That matters here specifically:
 * the runner's own fixtures perform live DELETEs before any test executes, so
 * "just run it and see" is not a safe way to verify this logic. (Learned the
 * hard way — probing the missing-URL branch through shell env vars instead
 * triggered an unintended live Gate 2 run, because dotenv overrode the empty
 * value being tested.)
 */

/** Hosts we recognise. Anything else is UNKNOWN and refused. */
export const VOICE_ENV_LABELS: Record<string, string> = {
  'naavi-voice-server-production.up.railway.app':  'PRODUCTION',
  'naavi-voice-staging-production.up.railway.app': 'STAGING',
};

export interface VoiceTarget {
  /** The URL Gate 2 should use, '' when none is configured. */
  url: string;
  /** Bare hostname, for display. */
  host: string;
  /** 'PRODUCTION' | 'STAGING' | 'UNKNOWN'. */
  label: string;
  /**
   * Populated when Gate 2 must NOT run. Null means safe to proceed.
   * Gate 1 ignores this — it excludes every platform:'voice' test, so a
   * mismatch there is inert and must not block a mobile run.
   */
  refusal: string | null;
}

export function resolveVoiceTarget(opts: {
  /** Environment label already derived from SUPABASE_URL by the runner. */
  envLabel: string;
  prodUrl: string;
  stagingUrl: string;
}): VoiceTarget {
  const { envLabel, prodUrl, stagingUrl } = opts;

  const url   = envLabel === 'STAGING' ? (stagingUrl ?? '') : (prodUrl ?? '');
  const host  = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const label = VOICE_ENV_LABELS[host] ?? 'UNKNOWN';

  if (!url) {
    return {
      url, host, label,
      refusal:
        `no voice server URL configured for ${envLabel}. ` +
        (envLabel === 'STAGING'
          ? 'Set STAGING_VOICE_SERVER_URL in tests/.env.'
          : 'Set VOICE_SERVER_URL in tests/.env.'),
    };
  }

  if (label !== envLabel) {
    return {
      url, host, label,
      refusal:
        `environment split-brain — Supabase is ${envLabel} but the voice server ` +
        `is ${label} (${host}). Gate 2 makes live calls to the voice server while ` +
        `its fixtures run against Supabase; testing across two environments proves ` +
        `nothing and can write to the wrong one.`,
    };
  }

  return { url, host, label, refusal: null };
}
