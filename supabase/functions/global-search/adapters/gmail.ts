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

    // Exclude ambient — Gmail flagged them but we don't know the sender.
    // Global Search is a retrieval tool, not a research tool; CNN articles
    // mentioning a company are not the user's relationship with that
    // company. Only personal (in contacts) and institutional (trusted
    // domain or Claude-promoted) appear. Ambient stays in the inbox and
    // morning brief — just not here.
    const { data, error } = await ctx.supabase
      .from('gmail_messages')
      .select(
        'id, gmail_message_id, subject, sender_name, sender_email, snippet, body_text, received_at, signal_strength',
      )
      .eq('user_id', ctx.userId)
      .eq('is_tier1', true)
      .in('signal_strength', ['personal', 'institutional'])
      .or(orClauses.join(','))
      .order('received_at', { ascending: false })
      .limit(ctx.limit);

    if (error) {
      console.error('[gmail-adapter] fetch error:', error.message);
      return [];
    }

    const rows = (data ?? []) as GmailRow[];

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
      let score = 0.5;
      if (variants.some(v => subject.includes(v))) score = 1.0;
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
