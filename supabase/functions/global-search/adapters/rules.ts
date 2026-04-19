/**
 * Rules adapter — searches `action_rules` (automations Robert has set up).
 *
 * Examples of what's in this table:
 *   - "Text Sarah when I get an email from Sarah"
 *   - "Remind me every Monday at 9 AM"
 *   - "WhatsApp John when I have a calendar event with 'lunch'"
 *
 * Surfacing these in Global Search answers questions like "what alerts do I
 * have?" and helps Robert spot stale/duplicate automations before they fire.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

type RuleRow = {
  id: string;
  label: string | null;
  trigger_type: string | null;
  action_type: string | null;
  trigger_config: unknown;
  action_config: unknown;
  enabled: boolean | null;
  created_at: string | null;
};

function safeJson(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v ?? {});
  } catch {
    return '';
  }
}

export const rulesAdapter: SearchAdapter = {
  name: 'rules',
  label: 'Automations',
  icon: 'bolt',
  privacyTag: 'general',

  isConnected: async () => true, // every user has the table

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    // Pull all enabled rules for this user, then filter in JS. Rule counts
    // are small (typically <20 per user), so no need for complex SQL.
    const { data, error } = await ctx.supabase
      .from('action_rules')
      .select('id, label, trigger_type, action_type, trigger_config, action_config, enabled, created_at')
      .eq('user_id', ctx.userId)
      .limit(100);

    if (error) {
      console.error('[rules-adapter] fetch error:', error.message);
      return [];
    }

    const rows = (data ?? []) as RuleRow[];
    const q = ctx.query.toLowerCase();

    // Score: label match = 1.0, config match = 0.6
    const hits: SearchResult[] = [];
    for (const r of rows) {
      const label = (r.label ?? '').toLowerCase();
      const trigger = safeJson(r.trigger_config).toLowerCase();
      const action = safeJson(r.action_config).toLowerCase();

      let score = 0;
      if (label.includes(q)) score = 1.0;
      else if (trigger.includes(q) || action.includes(q)) score = 0.6;
      if (score === 0) continue;

      const enabledTag = r.enabled === false ? ' (disabled)' : '';
      hits.push({
        source: 'rules',
        title: `${r.label ?? 'Rule'}${enabledTag}`,
        snippet: `${r.trigger_type ?? '?'} → ${r.action_type ?? '?'}`,
        score,
        createdAt: r.created_at ?? undefined,
        metadata: {
          rule_id: r.id,
          trigger_type: r.trigger_type,
          action_type: r.action_type,
          enabled: r.enabled !== false,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
