/**
 * seed-test-user Edge Function
 *
 * Idempotent test-fixture seeder for the dedicated mobile-test user
 * (mynaavi2207@gmail.com → user_id 7739bab9-bfb1-4553-b3f0-3ed223e9dee8).
 * Called by `npm run seed:test-user` to populate stable, known-shape data
 * so Maestro mobile UI tests can assert against deterministic state.
 *
 * Strategy: DELETE-then-INSERT for each category. Every test-seeded row
 * carries a "test-seed" marker (in `source`, `label`, or filename) so the
 * delete only removes seed data, never real user data.
 *
 * Skipped intentionally for now:
 *   - Calendar events: would require writing to mynaavi2207's Google
 *     Calendar via OAuth refresh-token round-trip. Add later if needed.
 *
 * Auth: requires service-role key in Authorization header.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SEED_TAG = 'test-seed';                 // contacts.source / documents.source / knowledge_fragments.source
const SEED_LABEL_PREFIX = '[TEST-SEED] ';     // action_rules.label

interface SeedResult {
  contacts:     { deleted: number; inserted: number };
  email_actions:{ deleted: number; inserted: number };
  invoices:     { deleted: number; inserted: number };
  location:     { deleted: number; inserted: number };
  knowledge:    { deleted: number; inserted: number };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // Only callable with service role — the seed script POSTs with the
  // service role key; nobody else has it.
  if (!authHeader.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: 'service-role required' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  const userId = String(body.user_id ?? '');
  if (!userId.match(/^[0-9a-f-]{36}$/i)) {
    return new Response(JSON.stringify({ error: 'invalid user_id' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
    { auth: { persistSession: false } },
  );

  const result: SeedResult = {
    contacts:      { deleted: 0, inserted: 0 },
    email_actions: { deleted: 0, inserted: 0 },
    invoices:      { deleted: 0, inserted: 0 },
    location:      { deleted: 0, inserted: 0 },
    knowledge:     { deleted: 0, inserted: 0 },
  };

  // ── 1. CONTACTS ────────────────────────────────────────────────────────────
  // contacts table has no `source` column. Use a name prefix as the marker
  // ('TestSeed_'). Real contacts (other names) are untouched.
  const CONTACT_PREFIX = 'TestSeed_';
  {
    const { data: del } = await admin
      .from('contacts')
      .delete()
      .eq('user_id', userId)
      .like('name', `${CONTACT_PREFIX}%`)
      .select('id');
    result.contacts.deleted = (del ?? []).length;

    const rows = [
      { user_id: userId, name: `${CONTACT_PREFIX}One`, email: 'testone@example.com', phone: '+15551110001' },
      { user_id: userId, name: `${CONTACT_PREFIX}Two`, email: 'testtwo@example.com', phone: '+15551110002' },
    ];
    const { data: ins, error: insErr } = await admin.from('contacts').insert(rows).select('id');
    if (insErr) console.error('[seed] contacts insert error:', insErr.message);
    result.contacts.inserted = (ins ?? []).length;
  }

  // ── 2. EMAIL ACTIONS (the brief surface) ────────────────────────────────
  // Marker: gmail_message_id starts with 'TESTSEED-'. The morning brief
  // reads from email_actions where urgency in (today, this_week) OR
  // due_date within next 7 days. We insert 5 emails:
  //   - 3 Anthropic receipts (parent emails for the 3 documents below)
  //   - 1 Bell phone bill due in 3 days (action_type=pay, urgency=this_week)
  //   - 1 doctor appointment confirmation (action_type=confirm, urgency=this_week)
  const ANTHROPIC_GMAIL_PREFIX = 'TESTSEED-Anthropic-';
  const seededEmailIds: { [key: string]: string } = {}; // gmail_message_id → email_actions.id
  {
    const { data: del } = await admin
      .from('email_actions')
      .delete()
      .eq('user_id', userId)
      .like('gmail_message_id', 'TESTSEED-%')
      .select('id');
    result.email_actions.deleted = (del ?? []).length;

    const today = new Date();
    const inDays = (n: number) => new Date(today.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

    const emails = [
      {
        gmail_message_id: `${ANTHROPIC_GMAIL_PREFIX}0001`,
        action_type: 'pay',
        title: 'Anthropic API receipt — $15.00',
        vendor: 'Anthropic, PBC',
        amount_cents: 1500,
        currency: 'CAD',
        due_date: null, // already paid
        urgency: 'info',
        summary: 'Anthropic API usage receipt for April 15.',
      },
      {
        gmail_message_id: `${ANTHROPIC_GMAIL_PREFIX}0002`,
        action_type: 'pay',
        title: 'Anthropic API receipt — $23.00',
        vendor: 'Anthropic, PBC',
        amount_cents: 2300,
        currency: 'CAD',
        due_date: null,
        urgency: 'info',
        summary: 'Anthropic API usage receipt for April 22.',
      },
      {
        gmail_message_id: `${ANTHROPIC_GMAIL_PREFIX}0003`,
        action_type: 'pay',
        title: 'Anthropic API receipt — $18.75',
        vendor: 'Anthropic, PBC',
        amount_cents: 1875,
        currency: 'CAD',
        due_date: null,
        urgency: 'info',
        summary: 'Anthropic API usage receipt for May 1.',
      },
      {
        gmail_message_id: 'TESTSEED-Bell-001',
        action_type: 'pay',
        title: 'Bell phone bill — $89.50',
        vendor: 'Bell Canada',
        amount_cents: 8950,
        currency: 'CAD',
        due_date: inDays(3),
        urgency: 'this_week',
        summary: 'Bell phone bill due Friday — $89.50',
      },
      {
        gmail_message_id: 'TESTSEED-Doctor-001',
        action_type: 'confirm',
        title: 'Dr. Smith appointment — Monday 3 PM',
        vendor: "Dr. Smith's office",
        amount_cents: null,
        currency: null,
        due_date: inDays(4),
        urgency: 'this_week',
        summary: 'Dr. Smith confirmed your appointment Monday at 3 PM.',
      },
    ];
    const rows = emails.map(e => ({
      user_id: userId,
      gmail_message_id: e.gmail_message_id,
      action_type: e.action_type,
      title: e.title,
      vendor: e.vendor,
      amount_cents: e.amount_cents,
      currency: e.currency,
      due_date: e.due_date,
      urgency: e.urgency,
      summary: e.summary,
      dismissed: false,
    }));
    const { data: ins, error: insErr } = await admin.from('email_actions').insert(rows).select('id, gmail_message_id');
    if (insErr) console.error('[seed] email_actions insert error:', insErr.message);
    for (const row of (ins ?? []) as Array<{ id: string; gmail_message_id: string }>) {
      seededEmailIds[row.gmail_message_id] = row.id;
    }
    result.email_actions.inserted = (ins ?? []).length;
  }

  // ── 3. ANTHROPIC INVOICES (documents) ──────────────────────────────────────
  // Marker: source = 'test-seed'. Three receipts in April + May for spend-
  // summary tests. Mirrors the Stripe-pair shape (file_name starts with
  // "Receipt-") so the V57.9.4 V4 spend-summary aggregator counts them.
  {
    const { data: del } = await admin
      .from('documents')
      .delete()
      .eq('user_id', userId)
      .eq('source', SEED_TAG)
      .select('id');
    result.invoices.deleted = (del ?? []).length;

    const docs = [
      {
        user_id: userId,
        file_name: 'Receipt-TEST-SEED-0001.pdf',
        document_type: 'receipt',
        mime_type: 'application/pdf',
        size_bytes: 12345,
        source: SEED_TAG,
        email_action_id: seededEmailIds[`${ANTHROPIC_GMAIL_PREFIX}0001`] ?? null,
        extracted_summary: 'Anthropic API usage receipt — TEST SEED',
        extracted_amount_cents: 1500,        // $15.00 CAD
        extracted_currency: 'CAD',
        extracted_date: '2026-04-15T00:00:00+00:00',
        extracted_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        file_name: 'Receipt-TEST-SEED-0002.pdf',
        document_type: 'receipt',
        mime_type: 'application/pdf',
        size_bytes: 12345,
        source: SEED_TAG,
        email_action_id: seededEmailIds[`${ANTHROPIC_GMAIL_PREFIX}0002`] ?? null,
        extracted_summary: 'Anthropic API usage receipt — TEST SEED',
        extracted_amount_cents: 2300,        // $23.00 CAD
        extracted_currency: 'CAD',
        extracted_date: '2026-04-22T00:00:00+00:00',
        extracted_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        file_name: 'Receipt-TEST-SEED-0003.pdf',
        document_type: 'receipt',
        mime_type: 'application/pdf',
        size_bytes: 12345,
        source: SEED_TAG,
        email_action_id: seededEmailIds[`${ANTHROPIC_GMAIL_PREFIX}0003`] ?? null,
        extracted_summary: 'Anthropic API usage receipt — TEST SEED',
        extracted_amount_cents: 1875,        // $18.75 CAD
        extracted_currency: 'CAD',
        extracted_date: '2026-05-01T00:00:00+00:00',
        extracted_at: new Date().toISOString(),
      },
    ];
    const { data: ins, error: insErr } = await admin.from('documents').insert(docs).select('id');
    if (insErr) console.error('[seed] documents insert error:', insErr.message);
    result.invoices.inserted = (ins ?? []).length;
  }

  // ── 3. LOCATION ALERT (action_rules) ───────────────────────────────────────
  // Marker: label starts with '[TEST-SEED] '. One arrive-home rule with
  // baked-in coordinates (so geofence-sync doesn't need to call resolve-
  // place during testing).
  {
    const { data: existing } = await admin
      .from('action_rules')
      .select('id')
      .eq('user_id', userId)
      .like('label', `${SEED_LABEL_PREFIX}%`);
    const ids = (existing ?? []).map((r: any) => r.id);
    if (ids.length > 0) {
      await admin.from('action_rules').delete().in('id', ids);
      result.location.deleted = ids.length;
    }

    const { data: ins, error: insErr } = await admin.from('action_rules').insert({
      user_id: userId,
      trigger_type: 'location',
      trigger_config: {
        place_name: 'home',
        direction: 'arrive',
        dwell_minutes: 2,
        resolved_lat: 45.4215,                // Ottawa center placeholder
        resolved_lng: -75.6972,
        radius_meters: 100,
      },
      action_type: 'sms',
      action_config: {
        to_phone: '+15551110001',
        body: '[TEST-SEED] You arrived home.',
      },
      label: `${SEED_LABEL_PREFIX}arrive-home`,
      one_shot: false,
      enabled: true,
    }).select('id');
    if (insErr) console.error('[seed] action_rules insert error:', insErr.message);
    result.location.inserted = (ins ?? []).length;
  }

  // ── 4. KNOWLEDGE FRAGMENTS ─────────────────────────────────────────────────
  // Marker: source = 'test-seed'. We insert with NULL embedding — vector
  // searches against these will not match by similarity, but other tests
  // (broad-fetch, list-by-user, "what do you know about me") return them.
  // For semantic-search coverage, run a separate test that calls ingest-
  // note (which generates a real embedding via OpenAI).
  {
    // V57.10.3 — broaden deletion. Wael 2026-05-01 saw deleted=0 on
    // re-runs even though source='test-seed' was passed to ingest-note.
    // Likely cause: ingest-note's Claude-Haiku extraction sometimes
    // splits a single seed fact into multiple fragments, normalises
    // the source string differently, or stores under a categorised
    // source value. The dedicated test user has no real data, so we
    // safely delete EVERY knowledge fragment for this user before
    // re-seeding. Keeps the seed truly idempotent regardless of how
    // ingest-note evolves.
    const { data: del } = await admin
      .from('knowledge_fragments')
      .delete()
      .eq('user_id', userId)
      .select('id');
    result.knowledge.deleted = (del ?? []).length;

    // Delegate to ingest-note Edge Function for each fact. It handles the
    // schema (type/classification/confidence/embedding) authoritatively
    // and generates real OpenAI embeddings — so semantic search also
    // returns these fragments.
    const facts = [
      'Favorite team is the Raptors.',
      "Wife's birthday is August 14.",
      'Allergic to penicillin.',
      'Prefers tea over coffee in the morning.',
      'Drives a 2019 Toyota Camry.',
    ];
    let inserted = 0;
    for (const text of facts) {
      try {
        const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ingest-note`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
            'apikey': serviceKey,
          },
          body: JSON.stringify({ text, source: SEED_TAG, user_id: userId }),
        });
        if (res.ok) inserted += 1;
        else console.error(`[seed] ingest-note returned ${res.status}: ${await res.text()}`);
      } catch (err) {
        console.error('[seed] ingest-note threw:', (err as Error)?.message);
      }
    }
    result.knowledge.inserted = inserted;
  }

  console.log(`[seed-test-user] user=${userId.slice(0,8)} result=${JSON.stringify(result)}`);
  return new Response(JSON.stringify({ ok: true, user_id: userId, result }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
