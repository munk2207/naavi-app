/**
 * Sent messages adapter — searches every SMS, WhatsApp, and email Naavi
 * has sent on the user's behalf (logged in `sent_messages` by send-sms
 * and send-email). Answers "did I text Sarah yesterday?", "what did I
 * tell the doctor last week?".
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

type SentRow = {
  id: string;
  channel: string;
  to_name: string | null;
  to_phone: string | null;
  to_email: string | null;
  subject: string | null;
  body: string;
  sent_at: string;
  delivery_status: string;
};

export const sentMessagesAdapter: SearchAdapter = {
  name: 'sent_messages',
  label: 'Sent Messages',
  icon: 'paperplane',
  privacyTag: 'general',

  isConnected: async () => true, // table always exists; empty if nothing sent

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const q = ctx.query.trim();
    if (!q) return [];
    const variants = ctx.queryVariants;

    // Build OR clause across every variant × every searched field so
    // "payments" and "pay" hit the same rows.
    const orClauses: string[] = [];
    for (const v of variants) {
      const like = `%${v}%`;
      orClauses.push(
        `body.ilike.${like}`,
        `subject.ilike.${like}`,
        `to_name.ilike.${like}`,
        `to_phone.ilike.${like}`,
        `to_email.ilike.${like}`,
      );
    }

    const { data, error } = await ctx.supabase
      .from('sent_messages')
      .select('id, channel, to_name, to_phone, to_email, subject, body, sent_at, delivery_status')
      .eq('user_id', ctx.userId)
      .or(orClauses.join(','))
      .order('sent_at', { ascending: false })
      .limit(ctx.limit);

    if (error) {
      console.error('[sent-messages-adapter] fetch error:', error.message);
      return [];
    }

    const rows = (data ?? []) as SentRow[];

    return rows.map((r): SearchResult => {
      // Score: strongest = body match, then subject, then recipient identity.
      const body = r.body?.toLowerCase() ?? '';
      const subj = r.subject?.toLowerCase() ?? '';
      const name = r.to_name?.toLowerCase() ?? '';
      let score = 0.5; // baseline for any ILIKE hit
      if (variants.some(v => body.includes(v))) score = 0.9;
      else if (variants.some(v => subj.includes(v))) score = 0.75;
      else if (variants.some(v => name.includes(v))) score = 0.65;

      const recipient = r.to_name ?? r.to_phone ?? r.to_email ?? 'unknown';
      const prefix = r.channel === 'email' ? 'Email' : r.channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
      const title = r.subject?.trim()
        ? `${prefix} to ${recipient}: ${r.subject}`
        : `${prefix} to ${recipient}`;
      const snippet = r.body.length > 200 ? r.body.slice(0, 197) + '...' : r.body;

      return {
        source: 'sent_messages',
        title,
        snippet,
        score,
        createdAt: r.sent_at,
        metadata: {
          message_id: r.id,
          channel: r.channel,
          to_name: r.to_name,
          to_phone: r.to_phone,
          to_email: r.to_email,
          delivery_status: r.delivery_status,
        },
      };
    });
  },
};
