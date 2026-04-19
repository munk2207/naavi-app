/**
 * Search adapter registry — single source of truth for which adapters run
 * during a global search.
 *
 * To add a new source:
 *   1. Create ./<source>.ts exporting a `SearchAdapter`
 *   2. Import it here and add to the array
 *   3. Deploy the Edge Function
 *
 * Do NOT import adapters elsewhere — the registry is the only contract the
 * main handler uses.
 */

import type { SearchAdapter } from './_interface.ts';
import { knowledgeAdapter } from './knowledge.ts';
import { rulesAdapter } from './rules.ts';
import { sentMessagesAdapter } from './sent_messages.ts';

export const adapters: SearchAdapter[] = [
  knowledgeAdapter,
  rulesAdapter,
  sentMessagesAdapter,
];
