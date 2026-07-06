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
  // F12 (2026-07-05) — contact_id (Google People API resourceName) added as
  // an alternative to name, for callers that already have a stable ID to
  // re-resolve against (resolve-recipient's fire-mode, per
  // docs/F12_PHASE2_CHANGE_PLAN_2026-07-05.md §1). Purely additive — existing
  // callers only ever send `name` and are unaffected.
  const { name, contact_id: bodyContactId, user_id: bodyUserId } = body;

  if (!name?.trim() && !bodyContactId?.trim()) {
    return new Response(JSON.stringify({ error: 'Missing name or contact_id' }), {
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

    // F12 (2026-07-05) — contact_id direct-fetch path. Skips the name search
    // entirely; used by resolve-recipient's fire-mode re-resolution so a
    // rename doesn't break the lookup (a rename would look identical to
    // "not found" from a name-only search). A 404/empty result here means
    // the contact was deleted (or the resourceName is otherwise invalid) —
    // the caller (resolve-recipient) surfaces that as 'not_found', never a
    // silent fallback.
    if (bodyContactId?.trim()) {
      const getUrl = new URL(`https://people.googleapis.com/v1/${bodyContactId.trim()}`);
      getUrl.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers,addresses,memberships');
      const getRes = await fetch(getUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!getRes.ok) {
        console.log(`[lookup-contact] contact_id fetch failed (status=${getRes.status}) for "${bodyContactId}" — treating as not found`);
        return new Response(JSON.stringify({ contact: null, contacts: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const person = await getRes.json();
      const addrs = Array.isArray(person.addresses) ? person.addresses : [];
      const singleContact = {
        name:              person.names?.[0]?.displayName ?? name ?? null,
        email:             person.emailAddresses?.[0]?.value ?? null,
        phone:             person.phoneNumbers?.[0]?.value ?? null,
        contact_id:        person.resourceName ?? bodyContactId.trim(),
        mynaavi_community: false,
        addresses: addrs.map((a: any) => ({
          type: String(a?.type || a?.formattedType || 'other').toLowerCase(),
          formatted: String(a?.formattedValue || '').trim(),
        })).filter((a: any) => a.formatted.length > 0),
      };
      console.log(`[lookup-contact] contact_id fetch ok: "${singleContact.name}" — ${singleContact.email ?? 'no email'}`);
      return new Response(JSON.stringify({ contact: singleContact, contacts: [singleContact] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch MyNaavi contact group resource name so we can prioritize those contacts.
    let myNaaviGroupResource: string | null = null;
    try {
      const groupsRes = await fetch('https://people.googleapis.com/v1/contactGroups?pageSize=100', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (groupsRes.ok) {
        const groupsData = await groupsRes.json();
        const groups = groupsData.contactGroups ?? [];
        const myNaaviGroup = groups.find((g: any) =>
          String(g.name || '').toLowerCase() === 'mynaavi' ||
          String(g.formattedName || '').toLowerCase() === 'mynaavi'
        );
        if (myNaaviGroup) myNaaviGroupResource = myNaaviGroup.resourceName;
        console.log(`[lookup-contact] MyNaavi group: ${myNaaviGroupResource ?? 'not found'}`);
      }
    } catch (e) {
      console.warn('[lookup-contact] Could not fetch contact groups:', e);
    }

    const url = new URL(PEOPLE_API);
    url.searchParams.set('query', name.trim());
    // memberships added so we can detect MyNaavi-labeled contacts and sort them first.
    url.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers,addresses,memberships');
    url.searchParams.set('pageSize', '10');

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

    // Filter: prefer exact first-name matches over prefix matches.
    // "Sami" should not return Samiha and Samir — those start with the same
    // letters but are different names. Only fall back to partial matches when
    // no exact match exists.
    if (results.length > 1) {
      const queryFirst = name.trim().split(/\s+/)[0].toLowerCase();
      const exactMatches = results.filter((r: any) => {
        const displayName = String(r.person?.names?.[0]?.displayName ?? '').toLowerCase();
        const firstName = displayName.split(/\s+/)[0];
        return firstName === queryFirst;
      });
      if (exactMatches.length > 0) {
        results = exactMatches;
        console.log(`[lookup-contact] Filtered to ${results.length} exact first-name match(es) for "${queryFirst}"`);
      }
    }

    // Sort: MyNaavi-labeled contacts first.
    if (myNaaviGroupResource && results.length > 1) {
      results = results.sort((a: any, b: any) => {
        const aIsMyNaavi = (a.person?.memberships ?? []).some((m: any) =>
          m.contactGroupMembership?.contactGroupResourceName === myNaaviGroupResource
        );
        const bIsMyNaavi = (b.person?.memberships ?? []).some((m: any) =>
          m.contactGroupMembership?.contactGroupResourceName === myNaaviGroupResource
        );
        return (bIsMyNaavi ? 1 : 0) - (aIsMyNaavi ? 1 : 0);
      });
      console.log(`[lookup-contact] Sorted — MyNaavi contacts first`);
    }

    // NOTE: "other contacts" fallback removed 2026-06-03 (Wael).
    // Other contacts are auto-saved email history, not saved contacts.
    // They never have addresses and should never be used for possessive
    // address resolution ("James home"). If not in real contacts → not found.

    // Phonetic fallback: if exact name returns 0 results, retry with a
    // 5-char prefix. Covers Claude normalizing spoken names before calling
    // lookup (e.g. "Fatma" → "Fatima" — prefix "Fatim"/"Fatma" → "Fatm" finds both).
    if (results.length === 0 && name.trim().length >= 4) {
      // Use first word only — avoids mangled multi-word strings like "fatma Fatma"
      const firstName = name.trim().split(/\s+/)[0];
      const prefix = firstName.slice(0, 5);
      console.log(`[lookup-contact] No results for "${name}" — retrying with prefix "${prefix}"`);
      const url2 = new URL(PEOPLE_API);
      url2.searchParams.set('query', prefix);
      url2.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers,addresses,memberships');
      url2.searchParams.set('pageSize', '10');
      const res2 = await fetch(url2.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res2.ok) {
        const data2 = await res2.json();
        results = data2.results ?? [];
        console.log(`[lookup-contact] Prefix fallback "${prefix}" → ${results.length} result(s)`);
      }
    }

    if (results.length === 0) {
      console.log(`[lookup-contact] No results found for "${name}"`);
      return new Response(JSON.stringify({ contact: null, contacts: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // searchContacts returns limited fields — phoneNumbers is unreliable from
    // that endpoint. Fetch full contact data for each result via people/get
    // using the resource name, which reliably returns all personFields.
    const resourceNames = results.map((r: any) => r.person?.resourceName).filter(Boolean);
    let fullPersonMap: Record<string, any> = {};
    if (resourceNames.length > 0) {
      try {
        const getUrl = new URL('https://people.googleapis.com/v1/people:batchGet');
        for (const rn of resourceNames) getUrl.searchParams.append('resourceNames', rn);
        getUrl.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers,addresses,memberships');
        const getRes = await fetch(getUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
        if (getRes.ok) {
          const getData = await getRes.json();
          for (const entry of getData.responses ?? []) {
            const p = entry.person;
            if (p?.resourceName) fullPersonMap[p.resourceName] = p;
          }
          console.log(`[lookup-contact] batchGet returned ${Object.keys(fullPersonMap).length} full contact(s)`);
        }
      } catch (e) {
        console.warn('[lookup-contact] batchGet failed, falling back to searchContacts data:', e);
      }
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
      const resourceName = r.person?.resourceName;
      const person = (resourceName && fullPersonMap[resourceName]) ?? r.person ?? {};
      const addrs = Array.isArray(person.addresses) ? person.addresses : [];
      const memberships = Array.isArray(person.memberships) ? person.memberships : [];
      const isMyNaavi = myNaaviGroupResource
        ? memberships.some((m: any) =>
            m.contactGroupMembership?.contactGroupResourceName === myNaaviGroupResource
          )
        : false;
      return {
        name:             person.names?.[0]?.displayName ?? name,
        email:            person.emailAddresses?.[0]?.value ?? null,
        phone:            person.phoneNumbers?.[0]?.value ?? null,
        // F12 (2026-07-05) — stable Google People API ID, so a live-referenced
        // recipient survives a rename (see resolve-recipient's fire mode).
        // Additive field — existing callers reading name/email/phone only
        // are unaffected.
        contact_id:       resourceName ?? null,
        mynaavi_community: isMyNaavi,
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
    console.log(`[lookup-contact] All matches: ${contacts.map((c: any) => `${c.name}(addrs=${c.addresses?.length ?? 0})`).join(', ')}`);

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
