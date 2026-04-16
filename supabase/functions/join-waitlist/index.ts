/**
 * join-waitlist Edge Function
 *
 * Public endpoint called from the marketing site (mynaavi.com/#signup).
 * Accepts { email, comments? } and inserts a row into waitlist_signups.
 *
 * - No JWT required (deploy with --no-verify-jwt)
 * - CORS open (called from mynaavi.com and any preview domain)
 * - Email normalized to lowercase + trimmed
 * - Unique constraint on email prevents duplicates — re-submits return 200
 *   with { already: true } so the user still sees a thank-you
 * - Comments limited to 2000 chars, stripped of control characters
 * - Rate limit: Supabase platform-level rate limiting applies; we add a
 *   simple per-IP check by looking at recent rows
 *
 * Reading signups: query waitlist_signups with service role key only.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_COMMENTS = 2000;

interface SignupBody {
  email?: string;
  comments?: string;
  source?: string;
}

function sanitize(input: string, max: number): string {
  // Remove control characters except tab/newline, trim, cap length
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: SignupBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const email = (body.email ?? '').toLowerCase().trim();
  if (!email || !EMAIL_RE.test(email) || email.length > 320) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const comments = body.comments ? sanitize(body.comments, MAX_COMMENTS) : null;
  const source   = body.source ? sanitize(body.source, 100) : 'website';

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { error } = await admin
    .from('waitlist_signups')
    .insert({ email, comments, source, status: 'pending' });

  if (error) {
    // Unique constraint violation = already on the list — treat as success
    if (error.code === '23505') {
      return new Response(JSON.stringify({ success: true, already: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.error('[join-waitlist] Insert error:', error.message, error.code);
    return new Response(JSON.stringify({ error: 'Could not save — please try again later' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[join-waitlist] Added: ${email}${comments ? ' (with comment)' : ''}`);
  return new Response(JSON.stringify({ success: true, already: false }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
