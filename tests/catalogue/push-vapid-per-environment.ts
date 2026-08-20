/**
 * T4 — push notifications must have a per-environment identity.
 *
 * The defect this locks down: lib/push.ts hardcoded ONE Web Push public key
 * for every build. Web Push pairs a public key with a private key — the phone
 * subscribes using the public one, and only the matching private one can send
 * to that subscription. With a single hardcoded value, staging could never
 * have its own push identity; it would have had to borrow production's private
 * key. Found 2026-08-20 during T4, and it was the one missing staging secret
 * that could not be fixed by copying a value across, because the private half
 * exists only inside production's secret store and is never readable back.
 *
 * ── What these can and cannot prove ────────────────────────────────────────
 * s1-voice-pin-scoping.ts warns, correctly, that source assertions confirm
 * words are present rather than that behaviour is right, and hits the live
 * server instead. That is the better pattern and it does not apply here.
 *
 * Build configuration has no runtime to call: eas.json's env block IS the
 * mechanism — it is what gets injected into the binary at build time. There is
 * no server to ask. So these read the two artifacts that actually decide the
 * outcome, and go further than string-matching by decoding both keys and
 * checking they are structurally valid P-256 points, which catches a truncated
 * or mistyped value that a substring assertion would happily pass.
 *
 * What they cannot prove: that staging's public key matches the private key
 * sitting in staging's Edge Function secrets. Supabase never shows a stored
 * secret back, only a fingerprint, so nothing local can verify the pair. That
 * gap closes the first time a push actually arrives on a staging build.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { TestCase } from '../lib/types';
import { expectTruthy } from '../lib/assertions';

const REPO = join(__dirname, '..', '..');
const readRepo = (p: string) => readFileSync(join(REPO, p), 'utf8');

/** A VAPID public key is an uncompressed P-256 point: 65 bytes starting 0x04. */
function describeKey(key: string): { valid: boolean; why: string } {
  let buf: Buffer;
  try {
    buf = Buffer.from(key, 'base64url');
  } catch {
    return { valid: false, why: 'not decodable as base64url' };
  }
  if (buf.length !== 65) return { valid: false, why: `decoded to ${buf.length} bytes, expected 65` };
  if (buf[0] !== 0x04) return { valid: false, why: `first byte is 0x${buf[0].toString(16)}, expected 0x04` };
  return { valid: true, why: 'uncompressed P-256 point' };
}

function productionLiteral(): string {
  const src = readRepo('lib/push.ts');
  // The fallback literal, i.e. the key used when no env var is set.
  const m = src.match(/EXPO_PUBLIC_VAPID_PUBLIC_KEY\s*\?\?\s*\n?\s*'([A-Za-z0-9_-]+)'/);
  return m ? m[1] : '';
}

function stagingKey(): string {
  const eas = JSON.parse(readRepo('eas.json'));
  return eas?.build?.staging?.env?.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';
}

export const pushVapidPerEnvironmentTests: TestCase[] = [
  {
    id: 't4.push-vapid-staging-has-its-own-key',
    category: 'push-vapid-per-environment',
    platform: 'mobile',
    description:
      'The staging build profile sets its own Web Push public key, and it is not production\'s. If ' +
      'this regresses, staging silently sends push through production\'s identity — or, worse, ' +
      'someone copies production\'s private key into staging to make it work.',
    timeoutMs: 10_000,
    async run(ctx) {
      const staging = stagingKey();
      const production = productionLiteral();

      expectTruthy(
        production.length > 0,
        'could not find the production fallback key in lib/push.ts — the constant was renamed or restructured',
      );
      expectTruthy(
        staging.length > 0,
        'eas.json staging profile does not set EXPO_PUBLIC_VAPID_PUBLIC_KEY — staging builds would fall back to production\'s key',
      );
      expectTruthy(
        staging !== production,
        'staging and production are configured with the SAME push key, which is the exact condition this work removed',
      );
      ctx.log(`staging key differs from production; both present`);
    },
  },
  {
    id: 't4.push-vapid-both-keys-are-valid-points',
    category: 'push-vapid-per-environment',
    platform: 'mobile',
    description:
      'Both keys decode to a real P-256 public key. A truncated or mistyped value looks fine to any ' +
      'string comparison and then fails only at the moment a real push is attempted on a real phone.',
    timeoutMs: 10_000,
    async run(ctx) {
      for (const [label, key] of [['production', productionLiteral()], ['staging', stagingKey()]] as const) {
        const { valid, why } = describeKey(key);
        expectTruthy(valid, `${label} push key is not a valid VAPID public key: ${why}`);
        ctx.log(`${label}: ${why}`);
      }
    },
  },
  {
    id: 't4.push-vapid-production-profile-stays-unset',
    category: 'push-vapid-per-environment',
    platform: 'mobile',
    description:
      'The production build profile sets no push key, so it falls through to the literal in lib/push.ts. ' +
      'That is what makes this change safe for production by construction rather than by testing — ' +
      'production behaviour cannot move unless someone deliberately adds the variable.',
    timeoutMs: 10_000,
    async run(ctx) {
      const eas = JSON.parse(readRepo('eas.json'));
      const prodEnv = eas?.build?.production?.env ?? {};
      expectTruthy(
        !('EXPO_PUBLIC_VAPID_PUBLIC_KEY' in prodEnv),
        'the production profile now sets EXPO_PUBLIC_VAPID_PUBLIC_KEY — production push identity would change, invalidating every existing subscription',
      );
      ctx.log('production profile leaves it unset, as intended');
    },
  },
];
