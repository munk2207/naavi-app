/**
 * Contacts adapter — searches the local `contacts` table (saved name, email,
 * phone). Matches against all three columns with case-insensitive partial
 * match. Phone match lets queries like "find what I know about 613-555-1234"
 * locate a saved contact.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

type ContactRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string | null;
};

// Normalize phone-like strings so "613-555-1234", "(613) 555 1234", and
// "+16135551234" all match the same stored number.
function normalizePhone(s: string): string {
  return s.replace(/[^\d]/g, '');
}

export const contactsAdapter: SearchAdapter = {
  name: 'contacts',
  label: 'Contacts',
  icon: 'person',
  privacyTag: 'general',

  isConnected: async () => true, // every user has the table

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const q = ctx.query.trim();
    if (!q) return [];

    const pattern = `%${q}%`;
    const digitsOnly = normalizePhone(q);
    const isPhoneLike = digitsOnly.length >= 7;

    // Build OR clauses: always search name+email, plus phone if the query
    // looks like a phone (≥7 digits). Phone match uses digits-only pattern
    // so formatting differences don't prevent a hit.
    const orClauses = [
      `name.ilike.${pattern}`,
      `email.ilike.${pattern}`,
    ];
    if (isPhoneLike) {
      orClauses.push(`phone.ilike.%${digitsOnly}%`);
    }

    const { data, error } = await ctx.supabase
      .from('contacts')
      .select('id, name, email, phone, created_at')
      .eq('user_id', ctx.userId)
      .or(orClauses.join(','))
      .limit(Math.max(ctx.limit * 2, 20));

    if (error) {
      console.error('[contacts-adapter] fetch error:', error.message);
      return [];
    }

    const rows = (data ?? []) as ContactRow[];
    const qLower = q.toLowerCase();

    // Score: name match = 1.0, phone match = 0.85, email-only match = 0.7.
    const hits: SearchResult[] = [];
    for (const c of rows) {
      const name = (c.name ?? '').toLowerCase();
      const email = (c.email ?? '').toLowerCase();
      const phoneDigits = c.phone ? normalizePhone(c.phone) : '';

      let score = 0;
      if (name.includes(qLower)) score = 1.0;
      else if (isPhoneLike && phoneDigits.includes(digitsOnly)) score = 0.85;
      else if (email.includes(qLower)) score = 0.7;
      if (score === 0) continue;

      const snippetParts = [c.email, c.phone].filter(Boolean).join(' · ');
      hits.push({
        source: 'contacts',
        title: c.name ?? c.email ?? c.phone ?? 'Contact',
        snippet: snippetParts,
        score,
        createdAt: c.created_at ?? undefined,
        metadata: {
          contact_id: c.id,
          email: c.email,
          phone: c.phone,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
