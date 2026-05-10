/**
 * Gmail adapter — searches Naavi's cache of the user's tier-1 Gmail
 * messages (subject, sender, snippet, body). Only tier-1 emails are
 * searchable; marketing / promotional senders (is_tier1 = false) are
 * explicitly skipped so Global Search stays useful.
 *
 * Extracted action rows (email_actions) are surfaced separately by the
 * email_actions adapter once it exists — this one only returns the raw
 * email so the user can jump back to the original.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

// Freshness-verify timeout. If Gmail is slow we fail OPEN (return all
// cached rows) rather than block the user's search. Wael 2026-05-10:
// stale-cache risk is preferable to unresponsive search.
const FRESHNESS_TIMEOUT_MS = 2_000;

async function getGoogleAccessToken(refreshToken: string): Promise<string | null> {
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
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.access_token === 'string' ? data.access_token : null;
  } catch {
    return null;
  }
}

// Returns the set of gmail_message_ids that still exist in Gmail's INBOX
// (i.e. not deleted, not in TRASH or SPAM).
//
// FAIL-OPEN behavior — if no token, no access, network error, timeout, or
// any unexpected response shape, we return the input set unchanged. The
// freshness check is best-effort: a token-expiry blip must NOT silently
// erase every email the user can recall. Wael 2026-05-10.
async function verifyMessagesAlive(
  refreshToken: string | null,
  messageIds: string[],
): Promise<Set<string>> {
  const passthrough = new Set(messageIds);
  if (!refreshToken || messageIds.length === 0) return passthrough;

  const accessToken = await getGoogleAccessToken(refreshToken);
  if (!accessToken) return passthrough;

  const verify = async (id: string): Promise<string | null> => {
    try {
      const url = `${GMAIL_MESSAGES_URL}/${id}?format=minimal`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (r.status === 404) return null; // permanently deleted
      if (!r.ok) return id;               // transient error → keep (fail-open)
      const data = await r.json();
      const labels: string[] = Array.isArray(data?.labelIds) ? data.labelIds : [];
      if (labels.includes('TRASH') || labels.includes('SPAM')) return null;
      return id;
    } catch {
      return id; // any error → keep (fail-open)
    }
  };

  try {
    const verifyAll = Promise.all(messageIds.map(verify));
    const timeout = new Promise<(string | null)[]>((resolve) => {
      setTimeout(() => resolve(messageIds.map((id) => id)), FRESHNESS_TIMEOUT_MS);
    });
    const results = await Promise.race([verifyAll, timeout]);
    return new Set(results.filter((id): id is string => id !== null));
  } catch {
    return passthrough;
  }
}

type GmailRow = {
  id: string;
  gmail_message_id: string;
  subject: string | null;
  sender_name: string | null;
  sender_email: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: string | null;
  signal_strength: 'personal' | 'institutional' | 'ambient' | null;
};

// Generic-query detection. When the user asks "what emails arrived
// recently" / "any new emails" / "show my inbox" — the query has no
// keyword to search, just an email/inbox trigger plus filler words.
// In that case we skip the keyword filter and return the most recent
// tier-1 messages, ordered by received_at desc.
const EMAIL_TRIGGERS = new Set([
  'email', 'emails', 'inbox', 'mail', 'mails', 'message', 'messages',
]);
const GENERIC_FILLERS = new Set([
  'recent', 'recently', 'latest', 'new', 'any', 'arrive', 'arrived', 'received',
  'what', 'whats', 'tell', 'show', 'list', 'have', 'has', 'see',
  'this', 'week', 'today', 'yesterday', 'lately', 'last', 'past',
  'is', 'are', 'do', 'did', 'i', 'me', 'my', 'mine', 'the', 'a', 'an',
  'in', 'on', 'from', 'to', 'of', 'for', 'about',
]);

function isGenericEmailQuery(q: string): boolean {
  const words = q.toLowerCase().split(/[\s.,!?]+/).filter(Boolean);
  if (words.length === 0) return false;
  const hasTrigger = words.some(w => EMAIL_TRIGGERS.has(w));
  if (!hasTrigger) return false;
  return words.every(w => EMAIL_TRIGGERS.has(w) || GENERIC_FILLERS.has(w));
}

export const gmailAdapter: SearchAdapter = {
  name: 'gmail',
  label: 'Email',
  icon: 'envelope',
  privacyTag: 'general',

  isConnected: async () => true, // table always exists; empty until sync-gmail has run

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const q = ctx.query.trim();
    if (!q) return [];

    const variants = ctx.queryVariants;
    const generic = isGenericEmailQuery(q);

    let queryBuilder = ctx.supabase
      .from('gmail_messages')
      .select(
        'id, gmail_message_id, subject, sender_name, sender_email, snippet, body_text, received_at, signal_strength',
      )
      .eq('user_id', ctx.userId)
      .eq('is_tier1', true)
      // Exclude ambient — Gmail flagged them but we don't know the sender.
      // Global Search is a retrieval tool, not a research tool; CNN articles
      // mentioning a company are not the user's relationship with that
      // company. Only personal (in contacts) and institutional (trusted
      // domain or Claude-promoted) appear. Ambient stays in the inbox and
      // morning brief — just not here.
      .in('signal_strength', ['personal', 'institutional']);

    if (!generic) {
      const orClauses: string[] = [];
      for (const v of variants) {
        const pat = `%${v}%`;
        orClauses.push(
          `subject.ilike.${pat}`,
          `sender_name.ilike.${pat}`,
          `sender_email.ilike.${pat}`,
          `snippet.ilike.${pat}`,
          `body_text.ilike.${pat}`,
        );
      }
      queryBuilder = queryBuilder.or(orClauses.join(','));
    }

    const { data, error } = await queryBuilder
      .order('received_at', { ascending: false })
      .limit(ctx.limit);

    if (error) {
      console.error('[gmail-adapter] fetch error:', error.message);
      return [];
    }

    const rowsRaw = (data ?? []) as GmailRow[];

    // Freshness verify against Gmail (Option 2 of B1d stale-cache fix,
    // Wael 2026-05-10). Excludes rows that have been deleted or moved to
    // TRASH/SPAM since sync-gmail last ran. Best-effort with FAIL-OPEN
    // semantics — locked in by tests/catalogue/gmail-freshness.ts.
    let rows: GmailRow[] = rowsRaw;
    if (rowsRaw.length > 0) {
      const { data: tokenRow } = await ctx.supabase
        .from('user_tokens')
        .select('refresh_token')
        .eq('user_id', ctx.userId)
        .eq('provider', 'google')
        .maybeSingle();
      const refreshToken =
        (tokenRow as { refresh_token?: string } | null)?.refresh_token ?? null;
      const aliveIds = await verifyMessagesAlive(
        refreshToken,
        rowsRaw.map((r) => r.gmail_message_id),
      );
      rows = rowsRaw.filter((r) => aliveIds.has(r.gmail_message_id));
      if (rows.length !== rowsRaw.length) {
        console.log(
          `[gmail-adapter] freshness: ${rowsRaw.length} cached → ${rows.length} alive (${rowsRaw.length - rows.length} excluded)`,
        );
      }
    }

    const hits: SearchResult[] = [];
    for (const r of rows) {
      const subject = (r.subject ?? '').toLowerCase();
      const sender = (r.sender_name ?? '').toLowerCase();
      const senderEmail = (r.sender_email ?? '').toLowerCase();
      const snippet = (r.snippet ?? '').toLowerCase();
      const body = (r.body_text ?? '').toLowerCase();

      // Score: subject match = 1.0, sender name/email = 0.85, body = 0.7,
      // snippet-only = 0.6. Trusted senders (signal_strength = 'personal' or
      // 'institutional') get a +0.1 nudge so a known-sender match outranks a
      // subject-match on an ambient sender.
      // In generic-list mode (no keyword to score against) every row gets
      // a flat baseline; ordering is by received_at desc from the DB.
      let score = 0.5;
      if (generic) {
        score = 0.7;
      } else if (variants.some(v => subject.includes(v))) score = 1.0;
      else if (variants.some(v => sender.includes(v) || senderEmail.includes(v))) score = 0.85;
      else if (variants.some(v => body.includes(v))) score = 0.7;
      else if (variants.some(v => snippet.includes(v))) score = 0.6;

      if (r.signal_strength === 'personal' || r.signal_strength === 'institutional') {
        score = Math.min(1.0, score + 0.1);
      }

      const from = r.sender_name ?? r.sender_email ?? 'Unknown';
      const title = r.subject?.trim() ? `${from}: ${r.subject}` : `Email from ${from}`;
      const raw = (r.snippet?.trim() || r.body_text?.trim() || '').slice(0, 200);

      hits.push({
        source: 'gmail',
        title,
        snippet: raw,
        score,
        createdAt: r.received_at ?? undefined,
        metadata: {
          message_id: r.gmail_message_id,
          sender_name: r.sender_name,
          sender_email: r.sender_email,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
