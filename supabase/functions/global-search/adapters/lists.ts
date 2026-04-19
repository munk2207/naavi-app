/**
 * Lists adapter — searches the `lists` table (shopping, to-do, etc.).
 *
 * Only matches list NAMES and CATEGORIES — the actual items live in Google
 * Drive docs (drive_file_id), which are out of scope here. Searching items
 * will come with the future Drive adapter so we can fetch content through
 * the user's OAuth token.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

type ListRow = {
  id: string;
  name: string | null;
  category: string | null;
  drive_file_id: string | null;
  web_view_link: string | null;
  updated_at: string | null;
};

export const listsAdapter: SearchAdapter = {
  name: 'lists',
  label: 'Lists',
  icon: 'list',
  privacyTag: 'general',

  isConnected: async () => true, // every user has the table

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const q = ctx.query.trim();
    if (!q) return [];

    const pattern = `%${q}%`;
    const { data, error } = await ctx.supabase
      .from('lists')
      .select('id, name, category, drive_file_id, web_view_link, updated_at')
      .eq('user_id', ctx.userId)
      .or(`name.ilike.${pattern},category.ilike.${pattern}`)
      .limit(Math.max(ctx.limit * 2, 20));

    if (error) {
      console.error('[lists-adapter] fetch error:', error.message);
      return [];
    }

    const rows = (data ?? []) as ListRow[];
    const qLower = q.toLowerCase();

    // Score: name match = 1.0, category-only match = 0.6
    const hits: SearchResult[] = [];
    for (const l of rows) {
      const name = (l.name ?? '').toLowerCase();
      const category = (l.category ?? '').toLowerCase();

      let score = 0;
      if (name.includes(qLower)) score = 1.0;
      else if (category.includes(qLower)) score = 0.6;
      if (score === 0) continue;

      hits.push({
        source: 'lists',
        title: l.name ?? 'List',
        snippet: l.category ? `Category: ${l.category}` : '',
        score,
        createdAt: l.updated_at ?? undefined,
        url: l.web_view_link ?? undefined,
        metadata: {
          list_id: l.id,
          category: l.category,
          drive_file_id: l.drive_file_id,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
