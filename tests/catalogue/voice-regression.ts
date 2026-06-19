/**
 * Voice regression suite — T3c
 *
 * Posts text messages directly to the Railway voice server's /test/ask endpoint,
 * simulating what a caller would say, and asserts on the speech response and
 * emitted actions.
 *
 * Requires two additional env vars in tests/.env:
 *   VOICE_SERVER_URL   — https://naavi-voice-server-production.up.railway.app
 *   VOICE_TEST_SECRET  — must match VOICE_TEST_SECRET set in Railway env vars
 *
 * Coverage gaps acknowledged:
 *   - Deepgram STT accuracy (tests use pre-transcribed text, not raw audio)
 *   - Twilio TwiML generation (tests bypass the Twilio layer entirely)
 *   - Real outbound actions (SMS/email/calendar writes are NOT executed by /test/ask
 *     — askClaude returns actions but the test endpoint does not fire them)
 *   - Audio/TTS output (only speech text is asserted, not the Deepgram audio stream)
 */

import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

// Wael's real user_id — voice server resolves calendar, contacts, rules etc. against this account.
const WAEL_USER_ID = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';
const WAEL_NAME    = 'Wael';

interface VoiceTestResponse {
  speech: string;
  actions: Array<{ type: string; [key: string]: unknown }>;
}

// Read at call time (not module load time) so the runner's loadEnv has already run.
function getVoiceEnv() {
  return {
    url:    process.env.VOICE_SERVER_URL    || '',
    secret: process.env.VOICE_TEST_SECRET  || '',
  };
}

async function ask(message: string, history: unknown[] = []): Promise<VoiceTestResponse> {
  const { url, secret } = getVoiceEnv();
  expectTruthy(url,    'VOICE_SERVER_URL not set in tests/.env');
  expectTruthy(secret, 'VOICE_TEST_SECRET not set in tests/.env');

  const res = await fetch(`${url}/test/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret:    secret,
      user_id:   WAEL_USER_ID,
      user_name: WAEL_NAME,
      message,
      history,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/test/ask returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<VoiceTestResponse>;
}

export const voiceRegressionTests: TestCase[] = [
  // ── Connectivity ────────────────────────────────────────────────────────────

  {
    id: 'voice.endpoint-reachable',
    category: 'smoke',
    description: 'Voice server /test/ask endpoint is reachable and returns speech',
    timeoutMs: 15_000,
    run: async () => {
      const result = await ask('What time is it?');
      expectTruthy(typeof result.speech === 'string' && result.speech.length > 0,
        `Expected non-empty speech string, got: ${JSON.stringify(result.speech)}`);
    },
  },

  // ── Calendar ────────────────────────────────────────────────────────────────

  {
    id: 'voice.calendar-today-query',
    category: 'calendar',
    description: 'Voice: "What\'s on my calendar today" returns a calendar response',
    timeoutMs: 20_000,
    run: async () => {
      const result = await ask("What's on my calendar today?");
      const speech = result.speech.toLowerCase();
      // Should either list events or say nothing is scheduled — never an error or "I don't understand"
      const looksLikeCalendarReply =
        speech.includes('calendar') ||
        speech.includes('schedule') ||
        speech.includes('nothing') ||
        speech.includes('no event') ||
        speech.includes('appointment') ||
        speech.includes('meeting') ||
        speech.includes('today');
      expectTruthy(looksLikeCalendarReply,
        `Calendar query did not produce a calendar-shaped reply. Got: "${result.speech.slice(0, 200)}"`);
    },
  },

  // ── Contact lookup ───────────────────────────────────────────────────────────

  {
    id: 'voice.contact-lookup-known-name',
    category: 'contacts',
    description: 'Voice: "Find contact Hussein" returns contact info or honest-out',
    timeoutMs: 20_000,
    run: async () => {
      const result = await ask('Find contact Hussein');
      const speech = result.speech.toLowerCase();
      // Should either return contact info or say not found — never silent failure
      const looksLikeContactReply =
        speech.includes('hussein') ||
        speech.includes('contact') ||
        speech.includes('found') ||
        speech.includes("didn't find") ||
        speech.includes('not find') ||
        speech.includes('no contact');
      expectTruthy(looksLikeContactReply,
        `Contact lookup did not produce a contact-shaped reply. Got: "${result.speech.slice(0, 200)}"`);
    },
  },

  // ── Email alert ─────────────────────────────────────────────────────────────

  {
    id: 'voice.email-alert-intent',
    category: 'rules',
    description: 'Voice: "Alert me when I get an email from Amazon" emits SET_ACTION_RULE or asks to confirm',
    timeoutMs: 20_000,
    run: async () => {
      const result = await ask('Alert me when I get an email from Amazon');
      const speech = result.speech.toLowerCase();
      const hasEmailAlertAction = result.actions.some(a =>
        a.type === 'SET_ACTION_RULE' || a.type === 'SET_EMAIL_ALERT'
      );
      // Either emits the action or asks for confirmation — both are correct
      const asksForConfirm =
        speech.includes('confirm') ||
        speech.includes('say yes') ||
        speech.includes('amazon') ||
        speech.includes('email');
      expectTruthy(hasEmailAlertAction || asksForConfirm,
        `Email alert intent did not produce action or confirmation. Got: "${result.speech.slice(0, 200)}"`);
    },
  },

  // ── Location alert ───────────────────────────────────────────────────────────

  {
    id: 'voice.location-alert-arrive-home',
    category: 'location',
    description: 'Voice: "Alert me when I arrive home" does NOT say "I didn\'t catch the place"',
    timeoutMs: 20_000,
    run: async () => {
      const result = await ask('Alert me when I arrive home');
      const speech = result.speech.toLowerCase();
      expectTruthy(
        !speech.includes("didn't catch the place"),
        `Location alert regression: voice replied "${result.speech.slice(0, 200)}" — the "didn't catch the place" bug is present`,
      );
      // Also assert it actually engaged with the request
      const engaged =
        speech.includes('home') ||
        speech.includes('alert') ||
        speech.includes('arrive') ||
        speech.includes('confirm') ||
        result.actions.length > 0;
      expectTruthy(engaged,
        `Location alert "arrive home" did not engage with the request. Got: "${result.speech.slice(0, 200)}"`);
    },
  },

  // ── Unknown / fallback ───────────────────────────────────────────────────────

  {
    id: 'voice.graceful-unknown-intent',
    category: 'smoke',
    description: 'Voice: gibberish input returns a graceful fallback, not an error or empty string',
    timeoutMs: 15_000,
    run: async () => {
      const result = await ask('zxqwerty bloop flarble');
      expectTruthy(
        typeof result.speech === 'string' && result.speech.length > 5,
        `Unknown intent produced empty or too-short speech: "${result.speech}"`,
      );
      // Must not expose an internal error message
      const speech = result.speech.toLowerCase();
      expectTruthy(
        !speech.includes('error') && !speech.includes('exception') && !speech.includes('undefined'),
        `Unknown intent leaked internal error in speech: "${result.speech.slice(0, 200)}"`,
      );
    },
  },
];
