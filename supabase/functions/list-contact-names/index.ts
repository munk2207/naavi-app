/**
 * list-contact-names — returns first names of all MyNaavi group contacts
 * for Deepgram keyterm priming. Called at voice call start.
 * Returns: { names: string[] }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

async function refreshToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed');
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const userId = body.user_id;
  if (!userId) return new Response(JSON.stringify({ names: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: tokenRow } = await admin.from('user_tokens').select('refresh_token').eq('user_id', userId).eq('provider', 'google').single();
  if (!tokenRow?.refresh_token) return new Response(JSON.stringify({ names: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const accessToken = await refreshToken(tokenRow.refresh_token);

    // Get MyNaavi group resource name
    const groupsRes = await fetch('https://people.googleapis.com/v1/contactGroups?pageSize=100', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const groupsData = await groupsRes.json();
    const myNaaviGroup = (groupsData.contactGroups ?? []).find((g: any) =>
      String(g.name || '').toLowerCase() === 'mynaavi' || String(g.formattedName || '').toLowerCase() === 'mynaavi'
    );

    const names: string[] = [];

    // Fetch ALL Google Contacts (not just MyNaavi group) — covers any name
    // the user may say regardless of group membership. Uses connections.list
    // with pagination to get up to 500 contacts.
    let pageToken: string | undefined;
    do {
      const url = new URL('https://people.googleapis.com/v1/people/me/connections');
      url.searchParams.set('personFields', 'names');
      url.searchParams.set('pageSize', '500');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) break;
      const data = await res.json();
      for (const person of data.connections ?? []) {
        const displayName = person.names?.[0]?.displayName;
        if (displayName) {
          const first = displayName.trim().split(/\s+/)[0];
          if (first.length > 1) names.push(first);
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken && names.length < 500);

    // Also include names from local contacts table (knowledge fragments)
    const { data: contacts } = await admin.from('contacts').select('name').eq('user_id', userId).limit(100);
    for (const c of contacts ?? []) {
      const full = String(c.name || '').trim();
      if (full) {
        const first = full.split(/\s+/)[0];
        if (first.length > 1 && !names.includes(first)) names.push(first);
      }
    }

    console.log(`[list-contact-names] ${names.length} names for user ${userId}: ${names.slice(0, 10).join(', ')}`);
    return new Response(JSON.stringify({ names: [...new Set(names)].slice(0, 80) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[list-contact-names] error:', err);
    return new Response(JSON.stringify({ names: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
