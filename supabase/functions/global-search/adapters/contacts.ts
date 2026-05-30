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
import { computeContactHash, COMMUNITY_PERSON_FIELDS } from '../../_shared/community_hash.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL       = 'https://oauth2.googleapis.com/token';
const PEOPLE_CONNECTIONS_API = 'https://people.googleapis.com/v1/people/me/connections';
const OTHER_CONTACTS_API     = 'https://people.googleapis.com/v1/otherContacts';
const CONTACT_GROUPS_API     = 'https://people.googleapis.com/v1/contactGroups';

// The Google Contacts label Robert assigns to his VIP inner circle.
// Case-insensitive match — "MyNaavi", "mynaavi", "MYNAAVI" all work.
const COMMUNITY_LABEL = 'mynaavi';

// Cap on contacts fetched per source. Most users have < 500; more than that
// would slow the search and the marginal hit rate is low.
const MAX_CONTACTS_PER_SOURCE = 500;

// Words that should never be treated as part of a contact name when the
// query is tokenized. Wael 2026-05-22 — when Claude passed query="name Bob"
// the adapter searched 731 contacts for the literal substring "name bob"
// and returned 0, even though Bob was a contact. Tokenizing the variants
// and dropping these stopwords lets "name Bob" / "contact named Bob" /
// "the contact Bob" all match a contact whose displayName contains "Bob".
const CONTACT_STOPWORDS = new Set<string>([
  'i', 'me', 'my', 'mine', 'the', 'a', 'an', 'is', 'are', 'it',
  'and', 'or', 'do', 'does', 'did', 'have', 'has', 'had',
  'any', 'some', 'this', 'that',
  'name', 'named', 'called', 'contact', 'contacts',
  'phone', 'number', 'numbers', 'email', 'emails', 'address', 'addresses',
  'with', 'for', 'about', 'on', 'in', 'from', 'to', 'of',
  // Search-intent verbs and navigational words — never part of a contact name.
  // Without these, "check RBC in my contact list" tokenises to {check,rbc,list}
  // and the ALL-token match fails because "rbc" doesn't contain "check".
  'check', 'find', 'search', 'show', 'tell', 'get', 'look', 'give', 'see',
  'list', 'who', 'what', 'where', 'when', 'how', 'can', 'could', 'please',
]);

// Tokenize variants into search tokens — words ≥ 2 chars, not stopwords.
// Returns a deduped set across all variants so the contacts loop can do a
// simple any-token-in-name check.
function tokensFromVariants(variants: string[]): Set<string> {
  const out = new Set<string>();
  for (const v of variants) {
    for (const w of v.split(/\s+/)) {
      const t = w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').trim();
      if (t.length < 2) continue;
      if (CONTACT_STOPWORDS.has(t)) continue;
      out.add(t);
    }
  }
  return out;
}

type PersonName         = { displayName?: string; givenName?: string; familyName?: string };
type PersonEmail        = { value?: string; type?: string };
type PersonPhone        = { value?: string; type?: string };
type PersonAddress      = { formattedValue?: string; postalCode?: string; city?: string; type?: string };
type PersonMembership   = { contactGroupMembership?: { contactGroupId?: string; contactGroupResourceName?: string } };
type PersonOrganization = { name?: string; title?: string };
type Person = {
  resourceName?: string;
  names?: PersonName[];
  emailAddresses?: PersonEmail[];
  phoneNumbers?: PersonPhone[];
  addresses?: PersonAddress[];
  memberships?: PersonMembership[];
  organizations?: PersonOrganization[];
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

// Fetch the contact group ID for the "MyNaavi" label.
// Returns null if the label doesn't exist or the call fails (graceful degradation).
async function fetchMyNaaviGroupId(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${CONTACT_GROUPS_API}?pageSize=200`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const groups = (data?.contactGroups ?? []) as Array<{ resourceName?: string; name?: string }>;
    const match = groups.find(g => (g.name ?? '').toLowerCase() === COMMUNITY_LABEL);
    if (!match?.resourceName) return null;
    // resourceName is "contactGroups/<id>" — extract just the ID for membership comparison.
    return match.resourceName.split('/').pop() ?? null;
  } catch (err) {
    console.warn('[contacts-adapter] fetchMyNaaviGroupId failed:', err);
    return null;
  }
}

async function fetchConnections(accessToken: string): Promise<Person[]> {
  const out: Person[] = [];
  let pageToken: string | undefined = undefined;
  while (out.length < MAX_CONTACTS_PER_SOURCE) {
    const url = new URL(PEOPLE_CONNECTIONS_API);
    url.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers,addresses,memberships,organizations');
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
    url.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers,addresses,memberships');
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

// ── Community backfill helpers ────────────────────────────────────────────────
// Service-role client for community_members writes — the user JWT client
// (ctx.supabase) is read-only for that table (RLS restricts INSERT to service_role).
let _adminSupabase: ReturnType<typeof createClient> | null = null;
function getAdminSupabase(): ReturnType<typeof createClient> {
  if (!_adminSupabase) {
    _adminSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );
  }
  return _adminSupabase;
}

// Send a bug alert to bugs@mynaavi.com via send-user-email (fire-and-forget).
// Uses the triggering user's Gmail OAuth so no separate email provider needed.
async function sendHashAnomalyAlert(
  userId: string,
  checked: number,
  updated: number,
  skipped: number,
): Promise<void> {
  try {
    const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
    const body = [
      `⚠️  Community hash function anomaly detected`,
      ``,
      `Time      : ${now} EST`,
      `User ID   : ${userId}`,
      `Checked   : ${checked}`,
      `Updated   : ${updated}  (hash mismatch → row replaced)`,
      `Skipped   : ${skipped}  (hash matched → no write)`,
      ``,
      `ALL ${checked} contacts were replaced in a single sync cycle.`,
      `This means the hash function is producing different values every run,`,
      `which suggests a field mismatch or non-deterministic input.`,
      ``,
      `Check: COMMUNITY_PERSON_FIELDS in _shared/community_hash.ts`,
      `must match the personFields used at write time and at refresh time.`,
    ].join('\n');

    await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-user-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          user_id: userId,
          to: 'bugs@mynaavi.com',
          subject: `⚠️ Community hash anomaly: ${updated}/${checked} replaced for user ${userId.slice(0, 8)}`,
          body,
        }),
      },
    );
    console.log('[contacts-adapter] hash anomaly alert sent to bugs@mynaavi.com');
  } catch (e: any) {
    console.error('[contacts-adapter] failed to send hash anomaly alert:', e?.message);
  }
}

// Write one community member to the DB. No-op if displayName is missing.
async function backfillCommunityMember(userId: string, p: Person): Promise<void> {
  if (!p.resourceName || !p.names?.[0]?.displayName) return;
  try {
    const contactData = {
      names:          p.names          ?? [],
      emailAddresses: p.emailAddresses ?? [],
      phoneNumbers:   p.phoneNumbers   ?? [],
    };
    const hash  = await computeContactHash(contactData);
    const name  = p.names[0].displayName!;
    const email = p.emailAddresses?.[0]?.value ?? null;
    const phone = p.phoneNumbers?.[0]?.value   ?? null;
    const { error } = await getAdminSupabase().from('community_members').upsert({
      user_id: userId, resource_name: p.resourceName,
      name, email, phone, contact_data: contactData, contact_hash: hash,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,resource_name' });
    if (error) console.warn('[contacts-adapter] backfill error:', error.message);
    else        console.log(`[contacts-adapter] backfilled community member: ${name}`);
  } catch (e: any) {
    console.warn('[contacts-adapter] backfill failed:', e?.message);
  }
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
    const tokens = tokensFromVariants(variants);
    const qDigits = normalizePhone(q);
    const isPhoneLike = qDigits.length >= 7;

    // ── Phase 1: community DB (fast local lookup) ──────────────────────────
    // Query community_members first. Community contacts always searched before
    // the full People API fetch. If Phase 1 returns hits, Phase 2 is skipped.
    const { data: communityRows } = await ctx.supabase
      .from('community_members')
      .select('resource_name, name, email, phone')
      .eq('user_id', ctx.userId)
      .order('name', { ascending: true });

    // "List my community" intent — when the query is about the community itself
    // (no specific name/email/phone), return ALL community members.
    // Matches: "list my community", "who is in my community", "show my MyNaavi community", etc.
    const communityAdminWords = new Set([
      'list', 'community', 'mynaavi', 'naavi', 'members', 'member',
      'all', 'who', 'show', 'people', 'contacts', 'tell', 'what',
    ]);
    const qLower = q.toLowerCase();
    const isCommunityListQuery =
      (qLower.includes('community') || qLower.includes('mynaavi')) &&
      [...tokens].every(t => communityAdminWords.has(t));

    const communityHits: SearchResult[] = [];

    if (isCommunityListQuery) {
      // For list intent: go to Google Contacts (authoritative source) — the
      // community_members DB may be incomplete (contacts labeled before the table
      // existed won't have rows). Fetch connections, filter to MyNaavi label only.
      const { data: tokenRow } = await ctx.supabase
        .from('user_tokens')
        .select('refresh_token')
        .eq('user_id', ctx.userId)
        .eq('provider', 'google')
        .maybeSingle();
      if (tokenRow?.refresh_token) {
        const listAccessToken = await getAccessToken(tokenRow.refresh_token);
        if (listAccessToken) {
          const [listConnections, listGroupId] = await Promise.all([
            fetchConnections(listAccessToken),
            fetchMyNaaviGroupId(listAccessToken),
          ]);
          if (listGroupId) {
            const communityContacts = listConnections.filter(p =>
              (p.memberships ?? []).some(
                m => m.contactGroupMembership?.contactGroupId === listGroupId,
              ),
            );
            console.log(`[contacts-adapter] community list: ${communityContacts.length} MyNaavi-labeled contacts`);
            for (const p of communityContacts) {
              const displayName = p.names?.[0]?.displayName ?? '';
              const emails = (p.emailAddresses ?? []).map(e => e.value ?? '').filter(Boolean);
              const phones = (p.phoneNumbers  ?? []).map(ph => ph.value ?? '').filter(Boolean);
              const url = phones[0]
                ? `tel:${phones[0].replace(/[^\d+]/g, '')}`
                : emails[0] ? `mailto:${emails[0]}` : undefined;
              communityHits.push({
                source: 'contacts',
                title: displayName || emails[0] || phones[0] || 'Contact',
                snippet: [emails[0], phones[0]].filter(Boolean).join(' · '),
                score: 1.5,
                url,
                metadata: {
                  resource_name: p.resourceName ?? null,
                  name: displayName || null,
                  emails,
                  phones,
                  is_community: true,
                  addresses: [],
                },
              });
            }
            if (communityHits.length > 0) {
              // Sync community_members DB: hash comparison + backfill.
              // - New contacts (not in DB): always write.
              // - Existing contacts: compare hash; skip if match, replace if mismatch.
              // Track checked/updated/skipped to detect broken hash function.
              const dbMap = new Map(
                (communityRows ?? []).map(r => [r.resource_name, r.contact_hash as string]),
              );
              let syncChecked = 0; let syncUpdated = 0; let syncSkipped = 0;
              const syncTasks: Promise<void>[] = [];

              for (const p of communityContacts) {
                if (!p.resourceName) continue;
                const existingHash = dbMap.get(p.resourceName);
                if (existingHash !== undefined) {
                  // Existing row — compare hash.
                  syncChecked++;
                  const contactData = {
                    names: p.names ?? [], emailAddresses: p.emailAddresses ?? [], phoneNumbers: p.phoneNumbers ?? [],
                  };
                  const freshHash = await computeContactHash(contactData);
                  if (freshHash === existingHash) {
                    syncSkipped++;
                    continue; // No change — skip write.
                  }
                  syncUpdated++;
                  syncTasks.push(backfillCommunityMember(ctx.userId, p));
                } else {
                  // New contact — write unconditionally.
                  syncTasks.push(backfillCommunityMember(ctx.userId, p));
                }
              }

              if (syncTasks.length > 0) await Promise.all(syncTasks);
              console.log(`[contacts-adapter] community sync: ${syncChecked} checked, ${syncUpdated} updated, ${syncSkipped} skipped`);

              // Anomaly check: if ALL existing contacts were replaced, the hash
              // function may be broken (non-deterministic or wrong field set).
              if (syncChecked >= 2 && syncUpdated === syncChecked && syncSkipped === 0) {
                console.error(`[contacts-adapter] HASH ANOMALY: ${syncUpdated}/${syncChecked} replaced — alerting bugs@mynaavi.com`);
                sendHashAnomalyAlert(ctx.userId, syncChecked, syncUpdated, syncSkipped).catch(() => {});
              }
              communityHits.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
              return communityHits.slice(0, ctx.limit);
            }
          }
        }
      }
      // Fallback: no token or Google call failed — return DB rows if any.
      if ((communityRows ?? []).length > 0) {
        for (const row of communityRows!) {
          const emails = row.email ? [row.email as string] : [];
          const phones = row.phone ? [row.phone as string] : [];
          const url = phones[0]
            ? `tel:${phones[0].replace(/[^\d+]/g, '')}`
            : emails[0] ? `mailto:${emails[0]}` : undefined;
          communityHits.push({
            source: 'contacts',
            title: row.name || emails[0] || phones[0] || 'Contact',
            snippet: [emails[0], phones[0]].filter(Boolean).join(' · '),
            score: 1.5,
            url,
            metadata: {
              resource_name: row.resource_name ?? null,
              name: row.name ?? null,
              emails,
              phones,
              is_community: true,
              addresses: [],
            },
          });
        }
        communityHits.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
        return communityHits.slice(0, ctx.limit);
      }
      return []; // No community members found from either source.
    }

    for (const row of (communityRows ?? [])) {
      const nameLower = (row.name ?? '').toLowerCase();
      const emails    = row.email ? [row.email as string] : [];
      const phones    = row.phone ? [row.phone as string] : [];

      const nameTokenMatch = (() => {
        if (variants.some(v => v.length > 0 && nameLower.includes(v))) return true;
        if (tokens.size === 0) return false;
        if (tokens.size >= 2) return [...tokens].every(t => nameLower.includes(t));
        return [...tokens].some(t => nameLower.includes(t));
      })();

      // Email match — full-variant always works; token-match disabled for multi-token
      // queries ("sarah james") to prevent "sarah@gmail.com" matching on "sarah" alone.
      const emailTokenMatch = emails.some(e => {
        const el = e.toLowerCase();
        if (variants.some(v => v.length > 2 && el.includes(v))) return true;
        if (tokens.size <= 1) return tokens.size > 0 && [...tokens].some(t => el.includes(t));
        return false;
      });

      const phoneMatch = isPhoneLike && phones.some(ph => normalizePhone(ph).includes(qDigits));

      let score = 0;
      if (nameTokenMatch)       score = 1.5;
      else if (phoneMatch)      score = 1.275; // 0.85 × 1.5 community boost
      else if (emailTokenMatch) score = 1.05;  // 0.70 × 1.5 community boost

      if (score === 0) continue;

      const url = phones[0]
        ? `tel:${phones[0].replace(/[^\d+]/g, '')}`
        : emails[0]
        ? `mailto:${emails[0]}`
        : undefined;

      communityHits.push({
        source: 'contacts',
        title: row.name || emails[0] || phones[0] || 'Contact',
        snippet: [emails[0], phones[0]].filter(Boolean).join(' · '),
        score,
        url,
        metadata: {
          resource_name: row.resource_name ?? null,
          name: row.name ?? null,
          emails,
          phones,
          is_community: true,
          addresses: [],
        },
      });
    }

    if (communityHits.length > 0) {
      console.log(`[contacts-adapter] Phase 1: ${communityHits.length} community hit(s) for "${q}"`);
      communityHits.sort((a, b) => b.score - a.score);
      return communityHits.slice(0, ctx.limit);
    }

    // ── Phase 2: Google People API (no community match found) ─────────────
    // ── 2a. Refresh token → access token ──────────────────────────────────
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

    // ── 2. Fetch both sources + MyNaavi group ID in parallel ───────────────
    const [connections, otherContacts, myNaaviGroupId] = await Promise.all([
      fetchConnections(accessToken),
      fetchOtherContacts(accessToken),
      fetchMyNaaviGroupId(accessToken),
    ]);
    if (myNaaviGroupId) {
      console.log(`[contacts-adapter] MyNaavi community group ID: ${myNaaviGroupId}`);
    }

    // Dedupe on resourceName.
    const seen = new Set<string>();
    const all: Person[] = [];
    for (const p of [...connections, ...otherContacts]) {
      const key = p.resourceName ?? JSON.stringify(p.names?.[0] ?? p.emailAddresses?.[0] ?? p.phoneNumbers?.[0]);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(p);
    }

    console.log(`[contacts-adapter] searching ${all.length} contacts for "${q}" (tokens: ${[...tokens].join(',') || '∅'})`);

    // ── 3. Score every contact, keep anything with a real match ────────────
    // Score: name 1.0, phone 0.85, email 0.7. Same weights as the old
    // Supabase adapter so mobile UI grouping stays consistent.
    const hits: SearchResult[] = [];
    for (const p of all) {
      const displayName = p.names?.[0]?.displayName ?? '';
      const nameLower   = displayName.toLowerCase();
      // Organization name (company field) — e.g. "RBC" contact with company "Royal Bank".
      const orgName     = (p.organizations?.[0]?.name ?? '').toLowerCase();

      const emails = (p.emailAddresses ?? [])
        .map(e => e.value ?? '')
        .filter(Boolean);
      const phones = (p.phoneNumbers ?? [])
        .map(p => p.value ?? '')
        .filter(Boolean);
      const addresses = (p.addresses ?? []);

      // MyNaavi community check — true when this contact has the "MyNaavi" label.
      // memberships is only present on connections (not otherContacts).
      const isCommunity = myNaaviGroupId !== null && (p.memberships ?? []).some(
        m => m.contactGroupMembership?.contactGroupId === myNaaviGroupId,
      );

      let score = 0;

      // Name match — three-tier logic applied to both display name AND org name:
      // 1. Whole-variant match: full phrase (e.g. "sarah davidson") must appear
      //    in the name. Most precise — checked first.
      // 2. Multi-token AND: all tokens must appear ("sarah" AND "davidson").
      //    Prevents "sarah davidson" matching "sarah james" on "sarah" alone.
      // 3. Single-token OR: any token matches (legacy single-name queries).
      const nameTokenMatch = (() => {
        const inDisplay = (() => {
          if (variants.some(v => v.length > 0 && nameLower.includes(v))) return true;
          if (tokens.size === 0) return false;
          if (tokens.size >= 2) return [...tokens].every(t => nameLower.includes(t));
          return [...tokens].some(t => nameLower.includes(t));
        })();
        if (inDisplay) return true;
        // Org name fallback — same logic. Lets "Royal Bank" find the "RBC" contact
        // whose company field contains "Royal Bank".
        if (!orgName) return false;
        if (variants.some(v => v.length > 0 && orgName.includes(v))) return true;
        if (tokens.size === 0) return false;
        if (tokens.size >= 2) return [...tokens].every(t => orgName.includes(t));
        return [...tokens].some(t => orgName.includes(t));
      })();
      // Email match — full-variant always works; token-match disabled for multi-token
      // queries ("sarah james") to prevent "sarah@gmail.com" matching on "sarah" alone.
      const emailTokenMatch = emails.some(e => {
        const el = e.toLowerCase();
        if (variants.some(v => v.length > 2 && el.includes(v))) return true;
        if (tokens.size <= 1) return tokens.size > 0 && [...tokens].some(t => el.includes(t));
        return false;
      });
      // F2h — address/postal-code matching (Wael 2026-05-27).
      // Matches formattedValue, postalCode, and city against query tokens.
      // Postal codes are stripped of spaces before comparison ("K1A 0B1" → "k1a0b1").
      const addressTokenMatch = addresses.some(a => {
        const addrLower    = (a.formattedValue ?? '').toLowerCase();
        const postalNorm   = (a.postalCode     ?? '').replace(/\s+/g, '').toLowerCase();
        const cityLower    = (a.city           ?? '').toLowerCase();
        const qNorm        = q.replace(/\s+/g, '').toLowerCase();
        // Direct postal-code match (strip spaces from both sides).
        if (postalNorm && qNorm.includes(postalNorm)) return true;
        if (postalNorm && postalNorm.includes(qNorm)) return true;
        return (
          (tokens.size > 0 && [...tokens].some(t =>
            addrLower.includes(t) || postalNorm.includes(t) || cityLower.includes(t),
          )) ||
          variants.some(v =>
            addrLower.includes(v) || postalNorm.includes(v) || cityLower.includes(v),
          )
        );
      });

      if (nameTokenMatch) {
        score = 1.0;
      } else if (isPhoneLike && phones.some(ph => normalizePhone(ph).includes(qDigits))) {
        score = 0.85;
      } else if (addressTokenMatch) {
        score = 0.75;
      } else if (emailTokenMatch) {
        score = 0.7;
      }

      if (score === 0) continue;

      // Community boost — multiply by 1.5 so MyNaavi members always rank
      // above non-community contacts with the same match type. Cap at 1.5
      // so the sort order is stable (community name=1.5 > non-community name=1.0).
      if (isCommunity) {
        score = Math.min(score * 1.5, 1.5);
        // Fire-and-forget backfill: if this community member isn't in the DB yet,
        // write them now so future searches hit Phase 1 instead of People API.
        if (p.resourceName) {
          const dbSet = new Set((communityRows ?? []).map(r => r.resource_name));
          if (!dbSet.has(p.resourceName)) {
            backfillCommunityMember(ctx.userId, p).catch(() => {});
          }
        }
      }

      const primaryEmail = emails[0];
      const primaryPhone = phones[0];
      const primaryAddress = addresses[0]?.formattedValue ?? null;
      // Include org name in snippet when it differs from the display name
      // so Claude can read "RBC — Royal Bank · +1 800-769-2511".
      const orgDisplay = orgName && !nameLower.includes(orgName) ? p.organizations?.[0]?.name : null;
      const snippetParts = [orgDisplay, primaryEmail, primaryPhone, primaryAddress].filter(Boolean);

      // Give each contact a tap target: tel: to dial, fall back to mailto:.
      // The mobile UI uses Linking.openURL(hit.url), which honors both schemes.
      // Without this, the contact card renders disabled and Robert can't
      // one-tap a contact he just searched for.
      const url = primaryPhone
        ? `tel:${primaryPhone.replace(/[^\d+]/g, '')}`
        : primaryEmail
        ? `mailto:${primaryEmail}`
        : undefined;

      hits.push({
        source: 'contacts',
        title: displayName || primaryEmail || primaryPhone || 'Contact',
        snippet: snippetParts.join(' · '),
        score,
        url,
        metadata: {
          resource_name: p.resourceName ?? null,
          name: displayName || null,
          emails,
          phones,
          is_community: isCommunity,
          addresses: addresses.map(a => ({
            formatted: a.formattedValue ?? null,
            postal_code: a.postalCode ?? null,
            city: a.city ?? null,
            type: a.type ?? null,
          })).filter(a => a.formatted || a.postal_code),
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
