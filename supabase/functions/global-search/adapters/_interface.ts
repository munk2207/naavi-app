/**
 * Search adapter interface — one file per data source (gmail, drive,
 * knowledge_fragments, calendar, contacts, lists, epic_health, future
 * bank/wearables/CRM, etc.).
 *
 * Each adapter decides on its own:
 *   - Whether the user has connected this source (isConnected)
 *   - How to execute the query (search)
 *   - What privacy tag applies ("medical", "financial", "general", ...)
 *
 * The global-search handler iterates the registry, runs all connected
 * adapters in parallel, merges + ranks the results, and groups by source.
 *
 * Adding a new source later = write one file + register it. No changes to
 * the main handler, no client change.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export type PrivacyTag = 'general' | 'medical' | 'financial' | 'legal';

export interface SearchContext {
  userId: string;
  query: string;
  /** Expanded, lowercased query variants — original + stem + synonyms. Built
   *  by `query_expansion.expandQuery` in the handler. ILIKE-based adapters
   *  should match any variant; adapters with their own upstream search
   *  (calendar via Google q=) can use just `query`. */
  queryVariants: string[];
  limit: number;
  supabase: SupabaseClient;
  // Individual adapters that need Google APIs, Epic, etc. fetch their own
  // access tokens via user_tokens / user connections inside the adapter.
}

export interface SearchResult {
  /** Stable source identifier, matches SearchAdapter.name (e.g. "gmail"). */
  source: string;
  /** Short display title (email subject, file name, event title, etc.). */
  title: string;
  /** Excerpt / preview text. Keep under ~200 chars for voice playback. */
  snippet: string;
  /** Relevance score, 0 (lowest) to 1 (highest). Adapters produce their own;
   *  the handler merges by score across sources. */
  score: number;
  /** ISO timestamp if the item is time-stamped. Used for recency tie-breaks. */
  createdAt?: string;
  /** Tap-to-open URL (e.g. Drive file link, Gmail thread link, event URL). */
  url?: string;
  /** Free-form extras the UI may use (e.g. sender, phone, list name). */
  metadata?: Record<string, unknown>;
}

export interface SearchAdapter {
  /** Stable identifier used in results and logs. Lowercase, kebab-style. */
  name: string;
  /** Human label shown in the app ("Email", "Drive", "Health Records"). */
  label: string;
  /** Short icon name / ID for the mobile UI. Optional. */
  icon?: string;
  /** Privacy classification — controls read-aloud behaviour on voice calls. */
  privacyTag: PrivacyTag;
  /** Whether this user has the source connected. Cheap check — do NOT run
   *  the full search here. Return false to skip the adapter entirely. */
  isConnected: (ctx: SearchContext) => Promise<boolean>;
  /** Execute the search. Must respect ctx.limit. Should not throw — return
   *  an empty array on transient failure so one bad source can't break
   *  global search. */
  search: (ctx: SearchContext) => Promise<SearchResult[]>;
}
