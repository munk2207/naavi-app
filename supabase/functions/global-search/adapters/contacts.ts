/**
 * Contacts adapter — queries Google Contacts (People API) LIVE via the user's
 * OAuth token. No internal Supabase silo.
 *
 * Rationale: Robert already keeps his contacts in Google / his phone. Naavi's
 * job is to read from that real source, not to maintain a divergent copy.
 *
 * Pattern (same as calendar adapter):
 *   1. Read refresh_token from user_tokens.
 *   2. Exchange for a fresh access_token (Google OAuth).
 *   3. Fetch the user's connections via People API (one paged GET). Uses
 *      personFields=names,emailAddresses,phoneNumbers — no metadata beyond
 *      that so Robert's address book details stay out of our logs.
 *   4. Client-side filter on name / email / normalized phone digits.
 *   5. Score and return.
 *
 * Requires OAuth scopes on the user's refresh token:
 *   - https://www.googleapis.com/auth/contacts.readonly
 *   - https://www.googleapis.com/auth/contacts.other.readonly
 *
 * These are in both lib/calendar.ts (web) and lib/supabase.ts (mobile). Users
 * whose token was minted before these scopes were added must sign out and
 * sign back in to refresh the grant; the adapter will silently return [] for
 * such users instead of crashing.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

const GOOGLE_TOKEN_URL       = 'https://oauth2.googleapis.com/token';
const PEOPLE_CONNECTIONS_API = 'https://people.googleapis.com/v1/people/me/connections';
const OTHER_CONTACTS_API     = 'https://people.googleapis.com/v1/otherContacts';

// Cap on contacts fetched per source. Most users have < 500; more than that
// would slow the search and the marginal hit rate is low.
const MAX_CONTACTS_PER_SOURCE = 500;

type PersonName  = { displayName?: string; givenName?: string; familyName?: string };
type PersonEmail = { value?: string; type?: string };
type PersonPhone = { value?: string; type?: string };
type Person = {
  resourceName?: string;
  names?: PersonName[];
  emailAddresses?: PersonEmail[];
  phoneNumbers?: PersonPhone[];
};

function normalizePhone(s: string): string {
  return s.replace(/[^\d]/g, '');
}

async function getAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')     ?? '',
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const data = await res.json();
    return typeof data.access_token === 'string' ? data.access_token : null;
  } catch (err) {
    console.error('[contacts-adapter] token refresh failed:', err);
    return null;
  }
}

async function fetchConnections(accessToken: string): Promise<Person[]> {
  const out: Person[] = [];
  let pageToken: string | undefined = undefined;
  while (out.length < MAX_CONTACTS_PER_SOURCE) {
    const url = new URL(PEOPLE_CONNECTIONS_API);
    url.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        console.warn(`[contacts-adapter] connections.list returned ${res.status}`);
        break;
      }
      const data = await res.json();
      const connections = (data?.connections ?? []) as Person[];
      out.push(...connections);
      pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : undefined;
      if (!pageToken) break;
    } catch (err) {
      console.error('[contacts-adapter] connections.list error:', err);
      break;
    }
  }
  return out.slice(0, MAX_CONTACTS_PER_SOURCE);
}

async function fetchOtherContacts(accessToken: string): Promise<Person[]> {
  const out: Person[] = [];
  let pageToken: string | undefined = undefined;
  while (out.length < MAX_CONTACTS_PER_SOURCE) {
    const url = new URL(OTHER_CONTACTS_API);
    url.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        // otherContacts is optional — some users may not have any. Do not
        // treat a 403 here as fatal; the main connections list is primary.
        if (res.status !== 404) {
          console.warn(`[contacts-adapter] otherContacts.list returned ${res.status}`);
        }
        break;
      }
      const data = await res.json();
      const contacts = (data?.otherContacts ?? []) as Person[];
      out.push(...contacts);
      pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : undefined;
      if (!pageToken) break;
    } catch (err) {
      console.error('[contacts-adapter] otherContacts.list error:', err);
      break;
    }
  }
  return out.slice(0, MAX_CONTACTS_PER_SOURCE);
}

export const contactsAdapter: SearchAdapter = {
  name: 'contacts',
  label: 'Contacts',
  icon: 'person',
  privacyTag: 'general',

  isConnected: async (ctx: SearchContext) => {
    const { data } = await ctx.supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', ctx.userId)
      .eq('provider', 'google')
      .maybeSingle();
    return !!data?.refresh_token;
  },

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const q = ctx.query.trim();
    if (!q) return [];

    const variants = ctx.queryVariants;
    const qDigits = normalizePhone(q);
    const isPhoneLike = qDigits.length >= 7;

    // ── 1. Refresh token → access token ─────────────────────────────────────
    const { data: tokenRow } = await ctx.supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', ctx.userId)
      .eq('provider', 'google')
      .maybeSingle();

    const refreshToken = tokenRow?.refresh_token;
    if (!refreshToken) {
      console.warn('[contacts-adapter] no Google refresh token for user', ctx.userId);
      return [];
    }

    const accessToken = await getAccessToken(refreshToken);
    if (!accessToken) {
      console.warn('[contacts-adapter] could not refresh access token for user', ctx.userId);
      return [];
    }

    // ── 2. Fetch both sources in parallel ──────────────────────────────────
    const [connections, otherContacts] = await Promise.all([
      fetchConnections(accessToken),
      fetchOtherContacts(accessToken),
    ]);

    // Dedupe on resourceName.
    const seen = new Set<string>();
    const all: Person[] = [];
    for (const p of [...connections, ...otherContacts]) {
      const key = p.resourceName ?? JSON.stringify(p.names?.[0] ?? p.emailAddresses?.[0] ?? p.phoneNumbers?.[0]);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(p);
    }

    console.log(`[contacts-adapter] searching ${all.length} contacts for "${q}"`);

    // ── 3. Score every contact, keep anything with a real match ────────────
    // Score: name 1.0, phone 0.85, email 0.7. Same weights as the old
    // Supabase adapter so mobile UI grouping stays consistent.
    const hits: SearchResult[] = [];
    for (const p of all) {
      const displayName = p.names?.[0]?.displayName ?? '';
      const nameLower   = displayName.toLowerCase();

      const emails = (p.emailAddresses ?? [])
        .map(e => e.value ?? '')
        .filter(Boolean);
      const phones = (p.phoneNumbers ?? [])
        .map(p => p.value ?? '')
        .filter(Boolean);

      let score = 0;

      if (variants.some(v => v.length > 0 && nameLower.includes(v))) {
        score = 1.0;
      } else if (isPhoneLike && phones.some(ph => normalizePhone(ph).includes(qDigits))) {
        score = 0.85;
      } else if (emails.some(e => {
        const el = e.toLowerCase();
        return variants.some(v => el.includes(v));
      })) {
        score = 0.7;
      }

      if (score === 0) continue;

      const primaryEmail = emails[0];
      const primaryPhone = phones[0];
      const snippetParts = [primaryEmail, primaryPhone].filter(Boolean);

      hits.push({
        source: 'contacts',
        title: displayName || primaryEmail || primaryPhone || 'Contact',
        snippet: snippetParts.join(' · '),
        score,
        metadata: {
          resource_name: p.resourceName ?? null,
          name: displayName || null,
          emails,
          phones,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
