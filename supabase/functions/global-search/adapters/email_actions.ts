/**
 * Email Actions adapter — searches `email_actions`, the structured rows
 * Claude Haiku extracts from every tier-1 email (see extract-email-actions
 * Edge Function).
 *
 * Surfacing these in Global Search answers questions like:
 *   - "what bills do I owe"
 *   - "what appointments this week"
 *   - "any renewals coming up"
 *
 * Only non-dismissed rows are returned. Raw emails are surfaced separately
 * by the gmail adapter — this one is the action layer on top.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

type ActionRow = {
  id: string;
  gmail_message_id: string;
  action_type: string | null;
  title: string | null;
  vendor: string | null;
  amount_cents: number | null;
  currency: string | null;
  due_date: string | null;
  urgency: string | null;
  summary: string | null;
  extracted_at: string | null;
  document_type: string | null;
  reference: string | null;
  expiry_date: string | null;
};

function formatAmount(cents: number | null, currency: string | null): string {
  if (cents == null) return '';
  const symbol = currency === 'CAD' ? 'CA$' : currency === 'USD' ? '$' : (currency ?? '');
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export const emailActionsAdapter: SearchAdapter = {
  name: 'email_actions',
  label: 'Email Actions',
  icon: 'clipboard-check',
  privacyTag: 'general',

  isConnected: async () => true,

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const q = ctx.query.trim();
    if (!q) return [];

    const variants = ctx.queryVariants;
    const orClauses: string[] = [];
    for (const v of variants) {
      const pat = `%${v}%`;
      orClauses.push(
        `title.ilike.${pat}`,
        `vendor.ilike.${pat}`,
        `summary.ilike.${pat}`,
        `action_type.ilike.${pat}`,
        `document_type.ilike.${pat}`,
        `reference.ilike.${pat}`,
      );
    }

    const { data, error } = await ctx.supabase
      .from('email_actions')
      .select(
        'id, gmail_message_id, action_type, title, vendor, amount_cents, currency, due_date, urgency, summary, extracted_at, document_type, reference, expiry_date',
      )
      .eq('user_id', ctx.userId)
      .eq('dismissed', false)
      .or(orClauses.join(','))
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(ctx.limit);

    if (error) {
      console.error('[email_actions-adapter] fetch error:', error.message);
      return [];
    }

    const rows = (data ?? []) as ActionRow[];

    const hits: SearchResult[] = [];
    for (const r of rows) {
      const title = (r.title ?? '').toLowerCase();
      const vendor = (r.vendor ?? '').toLowerCase();
      const summary = (r.summary ?? '').toLowerCase();
      const actionType = (r.action_type ?? '').toLowerCase();

      const docType = (r.document_type ?? '').toLowerCase();
      const reference = (r.reference ?? '').toLowerCase();

      let score = 0.5;
      if (variants.some(v => title.includes(v))) score = 1.0;
      else if (variants.some(v => reference.includes(v) && v.length >= 3)) score = 0.9;
      else if (variants.some(v => vendor.includes(v))) score = 0.85;
      else if (variants.some(v => summary.includes(v))) score = 0.7;
      else if (variants.some(v => docType.includes(v))) score = 0.65;
      else if (variants.some(v => actionType.includes(v))) score = 0.6;

      const amount = formatAmount(r.amount_cents, r.currency);
      const displayTitle = r.title?.trim()
        ? r.title
        : r.vendor?.trim()
          ? `${r.vendor}${amount ? ` · ${amount}` : ''}`
          : 'Email action';
      const snippet = (r.summary?.trim() || displayTitle).slice(0, 200);

      hits.push({
        source: 'email_actions',
        title: displayTitle,
        snippet,
        score,
        createdAt: r.extracted_at ?? undefined,
        metadata: {
          action_id: r.id,
          gmail_message_id: r.gmail_message_id,
          action_type: r.action_type,
          vendor: r.vendor,
          amount_cents: r.amount_cents,
          currency: r.currency,
          due_date: r.due_date,
          urgency: r.urgency,
          document_type: r.document_type,
          reference: r.reference,
          expiry_date: r.expiry_date,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
