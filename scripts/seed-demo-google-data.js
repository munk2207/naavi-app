/**
 * seed-demo-google-data.js — populates the demo user's Google Calendar
 * (via Naavi's create-calendar-event Edge Function) and Gmail message
 * cache (via direct SQL insert into gmail_messages) so the demo line
 * has real-looking data for "what's on my calendar this week" and
 * "what emails arrived recently" prompts.
 *
 * Run: node scripts/seed-demo-google-data.js
 *
 * Prereqs in .env (or tests/.env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * The DEMO_USER_ID is hardcoded — it's the public demo user, not a
 * personal account, so leaking the UUID is fine.
 *
 * Idempotent:
 *   - Calendar events use a known summary prefix "[DEMO]" so re-runs
 *     can be cleaned up manually in Google Calendar if needed.
 *     (Calendar API doesn't have a clean "delete by tag" idempotency.)
 *   - Gmail messages use deterministic gmail_message_ids prefixed
 *     "demo_eml_" — re-running upserts on (user_id, gmail_message_id).
 */

const fs = require('fs');
const path = require('path');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

loadEnv(path.join(process.cwd(), '.env'));
loadEnv(path.join(process.cwd(), 'tests', '.env'));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEMO_USER_ID = '1dd01ef2-98d0-4ad0-aebc-ed4f878d7c53';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — set in .env');
  process.exit(2);
}

// ─── Calendar events: this week ───────────────────────────────────────────

function isoAt(daysFromNow, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const calendarEvents = [
  {
    summary: '[DEMO] Annual physical with Dr. Chen',
    description: 'Yearly checkup at Health Plus Clinic.',
    start: isoAt(0, 10),  end: isoAt(0, 11),
  },
  {
    summary: '[DEMO] Pharmacy pickup',
    description: 'Lipitor refill at Shoppers.',
    start: isoAt(1, 14),  end: isoAt(1, 14, 30),
  },
  {
    summary: '[DEMO] Coffee with Mike Thompson',
    description: 'Catching up at the usual cafe.',
    start: isoAt(2, 10),  end: isoAt(2, 11),
  },
  {
    summary: '[DEMO] Garden club meeting',
    description: 'Spring planting plans.',
    start: isoAt(3, 19),  end: isoAt(3, 21),
  },
  {
    summary: "[DEMO] Maria's birthday dinner at Sunday Bistro",
    description: 'Reservation for two at 6 p.m.',
    start: isoAt(4, 18),  end: isoAt(4, 20),
  },
];

async function seedCalendar() {
  console.log(`Seeding ${calendarEvents.length} calendar events…`);
  let ok = 0, fail = 0;
  for (const ev of calendarEvents) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-calendar-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'apikey': SERVICE_KEY,
        },
        body: JSON.stringify({
          user_id: DEMO_USER_ID,
          summary: ev.summary,
          description: ev.description,
          start: ev.start,
          end: ev.end,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        ok++;
        console.log(`  ✓ ${ev.summary}`);
      } else {
        fail++;
        console.error(`  ✗ ${ev.summary} — ${res.status} ${JSON.stringify(data)}`);
      }
    } catch (err) {
      fail++;
      console.error(`  ✗ ${ev.summary} — ${err.message}`);
    }
  }
  console.log(`Calendar: ${ok} ok, ${fail} failed`);
}

// ─── Gmail messages: tier-1 institutional + personal ──────────────────────

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const gmailMessages = [
  {
    gmail_message_id: 'demo_eml_bell_2026_04',
    thread_id: 'demo_thr_bell_2026_04',
    subject: 'Your April Bell invoice — $87.50',
    sender_name: 'Bell Canada Billing',
    sender_email: 'billing@bell.ca',
    snippet: 'Your monthly home phone and internet invoice is ready. Amount due: $87.50. Due date: May 15.',
    body_text: 'Dear customer, your April Bell invoice for home phone and unlimited internet is now available. Amount due: $87.50 CAD. Please pay by May 15, 2026 to avoid a late fee. View full bill in your Bell account. Thank you for being a Bell customer.',
    received_at: daysAgoIso(2),
    is_unread: true,
    is_important: true,
    is_tier1: true,
    signal_strength: 'institutional',
    labels: ['INBOX', 'IMPORTANT'],
  },
  {
    gmail_message_id: 'demo_eml_hydro_2026_04',
    thread_id: 'demo_thr_hydro_2026_04',
    subject: 'Hydro One April electricity bill — $142.30',
    sender_name: 'Hydro One',
    sender_email: 'noreply@hydroone.com',
    snippet: 'Your April electricity statement is ready. Total: $142.30 due May 20.',
    body_text: 'Hello, your Hydro One April statement is ready. Total amount due: $142.30 CAD. Due date: May 20, 2026. Sign in to MyAccount to view your usage details and pay online.',
    received_at: daysAgoIso(3),
    is_unread: true,
    is_important: true,
    is_tier1: true,
    signal_strength: 'institutional',
    labels: ['INBOX', 'IMPORTANT'],
  },
  {
    gmail_message_id: 'demo_eml_costco_2026_04',
    thread_id: 'demo_thr_costco_2026_04',
    subject: 'Your Costco membership is expiring',
    sender_name: 'Costco Member Services',
    sender_email: 'membership@costco.ca',
    snippet: 'Your Gold Star membership expires May 31. Renew by June 1 for $120.',
    body_text: 'Dear member, your annual Costco Gold Star membership expires on May 31, 2026. Renew before June 1 to keep enjoying member benefits. Annual fee: $120 CAD. Visit Costco.ca to renew online.',
    received_at: daysAgoIso(5),
    is_unread: false,
    is_important: false,
    is_tier1: true,
    signal_strength: 'institutional',
    labels: ['INBOX'],
  },
  {
    gmail_message_id: 'demo_eml_doctor_2026_04',
    thread_id: 'demo_thr_doctor_2026_04',
    subject: 'Reminder: your annual physical tomorrow',
    sender_name: "Dr. Sarah Chen's office",
    sender_email: 'office@healthplusclinic.ca',
    snippet: 'Friendly reminder of your annual physical with Dr. Chen tomorrow at 10 a.m.',
    body_text: 'Hello, this is a reminder that you have an annual physical with Dr. Sarah Chen tomorrow at 10:00 a.m. Please arrive 10 minutes early to update your forms. If you need to reschedule, call our office at 416-555-0123. — Health Plus Clinic',
    received_at: daysAgoIso(1),
    is_unread: true,
    is_important: true,
    is_tier1: true,
    signal_strength: 'institutional',
    labels: ['INBOX', 'IMPORTANT'],
  },
  {
    gmail_message_id: 'demo_eml_maria_2026_05',
    thread_id: 'demo_thr_maria_2026_05',
    subject: "Birthday dinner Friday — Sunday Bistro",
    sender_name: 'Maria',
    sender_email: 'maria.demo@example.com',
    snippet: "Don't forget — dinner Friday at 6 at Sunday Bistro. I made the reservation.",
    body_text: "Hi love, just a reminder — birthday dinner is Friday at 6 p.m. at Sunday Bistro. I made the reservation under our last name. See you at home before 5:30. xo Maria",
    received_at: daysAgoIso(4),
    is_unread: false,
    is_important: true,
    is_tier1: true,
    signal_strength: 'personal',
    labels: ['INBOX', 'IMPORTANT'],
  },
];

async function seedGmail() {
  console.log(`Seeding ${gmailMessages.length} Gmail messages…`);
  // Upsert via REST API (Supabase PostgREST).
  const url = `${SUPABASE_URL}/rest/v1/gmail_messages?on_conflict=user_id,gmail_message_id`;
  const rows = gmailMessages.map(m => ({
    user_id: DEMO_USER_ID,
    ...m,
    updated_at: new Date().toISOString(),
  }));
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    console.log(`  ✓ Upserted ${Array.isArray(data) ? data.length : '?'} gmail_messages rows`);
  } else {
    console.error(`  ✗ gmail_messages upsert failed ${res.status}: ${JSON.stringify(data)}`);
  }
}

(async () => {
  console.log(`\nSeeding demo user ${DEMO_USER_ID.slice(0, 8)}…\n`);
  await seedCalendar();
  console.log();
  await seedGmail();
  console.log('\nDone.\n');
})();
