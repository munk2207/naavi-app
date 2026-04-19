/**
 * Lists adapter — searches both list NAMES (from Supabase `lists` row — the
 * user created these through Naavi, so Naavi is the source of truth for
 * names) AND ITEM CONTENTS (from the backing Google Drive doc — the real
 * live source of the items themselves).
 *
 * Flow:
 *   1. Find every list row whose name/category matches ILIKE (fast path —
 *      catches queries like "grocery list", "shopping").
 *   2. Also fetch every list row and pull each one's Drive doc content in
 *      parallel; scan line-by-line for the query string. This is what makes
 *      "is milk on a list?" work — the items don't live in Supabase, they
 *      live in Drive.
 *   3. Merge both result sets, dedupe on list_id, score, return.
 *
 * Drive fetch uses the user's OAuth token (drive.file scope already granted
 * on all active users). Fails silently per list — one broken doc doesn't
 * break the whole search.
 *
 * Performance note: step 2 fires one Drive export call per list. Typical
 * user has < 10 lists, so worst case is ~10 parallel small fetches. If that
 * ever becomes a hot path we'll need to narrow the fetch set.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_EXPORT_API = 'https://www.googleapis.com/drive/v3/files';

// Cap how many lists we pull item content for. Real users have <10; if a
// user somehow has hundreds, don't fetch them all on every search.
const MAX_LISTS_FOR_ITEM_SEARCH = 20;

// Keep item-content snippets short so TTS readout stays manageable.
const MAX_SNIPPET_LEN = 160;

type ListRow = {
  id: string;
  name: string | null;
  category: string | null;
  drive_file_id: string | null;
  web_view_link: string | null;
  updated_at: string | null;
};

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
    console.error('[lists-adapter] token refresh failed:', err);
    return null;
  }
}

async function fetchDocText(accessToken: string, fileId: string): Promise<string> {
  try {
    const url = `${DRIVE_EXPORT_API}/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

function extractMatchingLines(docText: string, qLower: string): string[] {
  const lines = docText.split(/\r?\n/);
  const matches: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.toLowerCase().includes(qLower)) {
      matches.push(line.length > MAX_SNIPPET_LEN ? line.slice(0, MAX_SNIPPET_LEN - 1) + '…' : line);
    }
  }
  return matches;
}

export const listsAdapter: SearchAdapter = {
  name: 'lists',
  label: 'Lists',
  icon: 'list',
  privacyTag: 'general',

  isConnected: async () => true,

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const q = ctx.query.trim();
    if (!q) return [];

    const qLower = q.toLowerCase();
    const pattern = `%${q}%`;

    // ── Name / category match (fast path) ──────────────────────────────────
    const { data: nameMatches, error: nameErr } = await ctx.supabase
      .from('lists')
      .select('id, name, category, drive_file_id, web_view_link, updated_at')
      .eq('user_id', ctx.userId)
      .or(`name.ilike.${pattern},category.ilike.${pattern}`)
      .limit(Math.max(ctx.limit * 2, 20));

    if (nameErr) {
      console.error('[lists-adapter] name-match fetch error:', nameErr.message);
    }

    // ── All lists (for item-content search) ────────────────────────────────
    const { data: allLists, error: allErr } = await ctx.supabase
      .from('lists')
      .select('id, name, category, drive_file_id, web_view_link, updated_at')
      .eq('user_id', ctx.userId)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(MAX_LISTS_FOR_ITEM_SEARCH);

    if (allErr) {
      console.error('[lists-adapter] all-lists fetch error:', allErr.message);
    }

    const nameMatchRows = (nameMatches ?? []) as ListRow[];
    const allListsRows  = (allLists ?? []) as ListRow[];

    // ── Item-content search — only if at least one list has a drive_file_id
    // AND we have an OAuth token available ──────────────────────────────
    const listsWithDrive = allListsRows.filter(l => !!l.drive_file_id);
    const itemMatches: Array<{ list: ListRow; lines: string[] }> = [];
    if (listsWithDrive.length > 0) {
      const { data: tokenRow } = await ctx.supabase
        .from('user_tokens')
        .select('refresh_token')
        .eq('user_id', ctx.userId)
        .eq('provider', 'google')
        .maybeSingle();

      const refreshToken = tokenRow?.refresh_token;
      const accessToken = refreshToken ? await getAccessToken(refreshToken) : null;

      if (accessToken) {
        const results = await Promise.all(
          listsWithDrive.map(async (list) => {
            const docText = await fetchDocText(accessToken, list.drive_file_id!);
            const lines = docText ? extractMatchingLines(docText, qLower) : [];
            return { list, lines };
          }),
        );
        for (const r of results) {
          if (r.lines.length > 0) itemMatches.push(r);
        }
      }
    }

    // ── Merge name matches and item matches ────────────────────────────────
    const byListId = new Map<string, { list: ListRow; matchedLines: string[]; score: number }>();

    // Name match: score 1.0 (name includes q), category-only: 0.6
    for (const l of nameMatchRows) {
      const name = (l.name ?? '').toLowerCase();
      const category = (l.category ?? '').toLowerCase();
      let score = 0;
      if (name.includes(qLower))        score = 1.0;
      else if (category.includes(qLower)) score = 0.6;
      if (score === 0) continue;
      byListId.set(l.id, { list: l, matchedLines: [], score });
    }

    // Item matches: score 0.9 (as good as a direct name match — the user is
    // asking about a thing inside the list, and finding the thing is exactly
    // what matters).
    for (const { list, lines } of itemMatches) {
      const existing = byListId.get(list.id);
      if (existing) {
        existing.matchedLines = lines;
        existing.score = Math.max(existing.score, 0.9);
      } else {
        byListId.set(list.id, { list, matchedLines: lines, score: 0.9 });
      }
    }

    const hits: SearchResult[] = [];
    for (const { list, matchedLines, score } of byListId.values()) {
      let snippet = '';
      if (matchedLines.length > 0) {
        // Read the first matching item verbatim. If there are more, say so.
        snippet = matchedLines[0];
        if (matchedLines.length > 1) {
          snippet += ` (+${matchedLines.length - 1} more)`;
        }
      } else if (list.category) {
        snippet = `Category: ${list.category}`;
      }

      hits.push({
        source: 'lists',
        title: list.name ?? 'List',
        snippet,
        score,
        createdAt: list.updated_at ?? undefined,
        url: list.web_view_link ?? undefined,
        metadata: {
          list_id: list.id,
          category: list.category,
          drive_file_id: list.drive_file_id,
          matched_lines: matchedLines,
          matched_count: matchedLines.length,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
