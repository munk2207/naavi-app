/**
 * Reminders adapter — searches the `reminders` table (one-off time-based
 * reminders Robert has set, e.g. "take pills at 8 AM"). Answers "what do I
 * have to remember?" / "when is my pill reminder?".
 *
 * Why this adapter exists: every other content repo had a Global Search
 * adapter; `reminders` was the lone gap. Closed 2026-04-20 (Session 19).
 *
 * Returns BOTH fired and unfired reminders — the user may want to recall a
 * past reminder, not just see upcoming ones. The snippet prefixes UPCOMING
 * or PAST so voice/mobile can colour the result accordingly.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

type ReminderRow = {
  id: string;
  title: string | null;
  datetime: string | null;
  phone_number: string | null;
  fired: boolean | null;
  is_priority: boolean | null;
};

export const remindersAdapter: SearchAdapter = {
  name: 'reminders',
  label: 'Reminders',
  icon: 'bell',
  privacyTag: 'general',

  isConnected: async () => true,

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const variants = ctx.queryVariants;
    if (variants.length === 0) return [];

    // Build OR across every variant × title. Phone numbers match as a bonus.
    const orClauses: string[] = [];
    for (const v of variants) {
      const pat = `%${v}%`;
      orClauses.push(`title.ilike.${pat}`, `phone_number.ilike.${pat}`);
    }

    const { data, error } = await ctx.supabase
      .from('reminders')
      .select('id, title, datetime, phone_number, fired, is_priority')
      .eq('user_id', ctx.userId)
      .or(orClauses.join(','))
      .order('datetime', { ascending: true, nullsFirst: false })
      .limit(ctx.limit * 2);

    if (error) {
      console.error('[reminders-adapter] fetch error:', error.message);
      return [];
    }

    const rows = (data ?? []) as ReminderRow[];
    const nowMs = Date.now();

    const hits: SearchResult[] = [];
    for (const r of rows) {
      const title = (r.title ?? '').toLowerCase();
      let score = 0;
      if (variants.some(v => title.includes(v))) {
        score = r.is_priority ? 1.0 : 0.9;
      } else {
        // phone-only hit — lower confidence
        score = 0.5;
      }

      const when = r.datetime ? new Date(r.datetime) : null;
      const whenLabel = when
        ? when.toLocaleString('en-US', {
            timeZone: 'America/Toronto',
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
          })
        : 'no date set';

      const tense = when ? (when.getTime() >= nowMs ? 'UPCOMING' : 'PAST') : 'UPCOMING';
      const snippet = `${tense}: ${whenLabel}${r.is_priority ? ' · priority' : ''}`;

      hits.push({
        source: 'reminders',
        title: r.title ?? 'Reminder',
        snippet,
        score,
        createdAt: r.datetime ?? undefined,
        metadata: {
          reminder_id: r.id,
          datetime: r.datetime,
          fired: r.fired,
          is_priority: r.is_priority,
          phone_number: r.phone_number,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
