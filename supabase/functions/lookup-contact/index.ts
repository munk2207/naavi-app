/**
 * lookup-contact Edge Function
 *
 * Searches Robert's Google Contacts by name using the People API.
 * Returns the best match with name, email, and phone number.
 *
 * Auth: RLS-based. verify_jwt = false in config.toml.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PEOPLE_API       = 'https://people.googleapis.com/v1/people:searchContacts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getNewAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  const body = await req.json();
  const { name, user_id: bodyUserId } = body;

  if (!name?.trim()) {
    return new Response(JSON.stringify({ error: 'Missing name' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Standard 3-step user_id resolution (CLAUDE.md rule 4):
  // (a) JWT auth (mobile app), (b) body.user_id (voice server), (c) user_tokens fallback
  let userId: string | null = null;
  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (user) userId = user.id;
  } catch (_) { /* ignore */ }

  if (!userId && bodyUserId) userId = bodyUserId;

  // V57.7 — REMOVED user_tokens "first-google-user" fallback. Multi-user
  // safety hole; CLAUDE.md Rule 4 says it's for single-user only.
  // Auto-tester multi-user matrix caught this 2026-04-29.

  if (!userId) {
    return new Response(JSON.stringify({ error: 'No user found' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const user = { id: userId };

  const { data: tokenRow, error: tokenError } = await adminClient
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .single();

  if (tokenError || !tokenRow?.refresh_token) {
    console.error('[lookup-contact] Token lookup failed for user:', user.id, tokenError?.message);
    return new Response(JSON.stringify({ error: 'No Google token found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const accessToken = await getNewAccessToken(tokenRow.refresh_token);

    const url = new URL(PEOPLE_API);
    url.searchParams.set('query', name.trim());
    // 2026-05-22 (Wael) — added 'addresses' to readMask so the voice server
    // can resolve "Alert me when I arrive at Bob's home" without an extra
    // Places lookup. People API returns addresses[] with type (home/work/
    // other) and formattedValue. Backwards compatible: callers that only
    // read name/email/phone keep working.
    url.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers,addresses');
    url.searchParams.set('pageSize', '5');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `People API failed: ${err}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    console.log(`[lookup-contact] API response:`, JSON.stringify(data).slice(0, 300));
    let results = data.results ?? [];

    // Fallback: search other contacts (people you've emailed)
    if (results.length === 0) {
      const url2 = new URL('https://people.googleapis.com/v1/otherContacts:search');
      url2.searchParams.set('query', name.trim());
      // otherContacts readMask does NOT support 'addresses' (returns 400 if
      // included) — those entries are auto-saved from email and never have
      // addresses anyway. Only myContacts (above) supports addresses.
      url2.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers');
      url2.searchParams.set('pageSize', '5');
      const res2 = await fetch(url2.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res2.ok) {
        const data2 = await res2.json();
        console.log(`[lookup-contact] otherContacts response:`, JSON.stringify(data2).slice(0, 300));
        results = data2.results ?? [];
      }
    }

    if (results.length === 0) {
      console.log(`[lookup-contact] No results found for "${name}"`);
      return new Response(JSON.stringify({ contact: null, contacts: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Map all matches into Contact shape. Caller picks best (single match) or
    // shows a picker (multi). Used by the recipient-resolution chain in
    // Session 26 — DraftCard needs every match for the picker UI.
    //
    // 2026-05-22 (Wael) — addresses[] now included. Each entry has
    // { type: 'home'|'work'|'other'|string, formatted: string }. Voice
    // server uses this to resolve "Alert me at Bob's home" without a
    // separate Places lookup. Empty array if the contact has no addresses
    // (most do not).
    const contacts = results.map((r: any) => {
      const person = r.person ?? {};
      const addrs = Array.isArray(person.addresses) ? person.addresses : [];
      return {
        name:  person.names?.[0]?.displayName ?? name,
        email: person.emailAddresses?.[0]?.value ?? null,
        phone: person.phoneNumbers?.[0]?.value ?? null,
        addresses: addrs.map((a: any) => ({
          type: String(a?.type || a?.formattedType || 'other').toLowerCase(),
          formatted: String(a?.formattedValue || '').trim(),
        })).filter((a: any) => a.formatted.length > 0),
      };
    });

    // Backwards compatible: also return a single `contact` field so older
    // callers that don't read `contacts[]` keep working.
    const contact = contacts[0];

    console.log(`[lookup-contact] Found ${contacts.length} match(es); best: "${contact.name}" — ${contact.email ?? 'no email'}`);

    return new Response(JSON.stringify({ contact, contacts }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[lookup-contact] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
