/**
 * Knowledge layer — client-side wiring
 *
 * Connects to ingest-note and search-knowledge Edge Functions.
 * Used by the orchestrator to save and retrieve KnowledgeFragments.
 */

import { supabase } from './supabase';

export interface KnowledgeFragment {
  id: string;
  type: 'life_story' | 'important_date' | 'preference' | 'relationship' | 'place' | 'routine' | 'concern';
  content: string;
  classification: 'PUBLIC' | 'PERSONAL' | 'SENSITIVE' | 'MEDICAL' | 'FINANCIAL';
  source: 'voice_memo' | 'notes' | 'stated' | 'inferred';
  confidence: number;
  similarity?: number;
}

// ─── Ingest text → extract + store fragments ──────────────────────────────────

export async function ingestNote(
  text: string,
  source: KnowledgeFragment['source'] = 'notes'
): Promise<KnowledgeFragment[]> {
  if (!supabase || !text.trim()) return [];

  try {
    const { data, error } = await supabase.functions.invoke('ingest-note', {
      body: { text, source },
    });
    if (error || !data?.fragments) return [];
    console.log(`[Knowledge] Ingested ${data.fragments.length} fragments`);
    return data.fragments;
  } catch (err) {
    console.error('[Knowledge] Ingest failed:', err);
    return [];
  }
}

// ─── Search knowledge by semantic query ──────────────────────────────────────

export async function searchKnowledge(
  query: string,
  topK = 5
): Promise<KnowledgeFragment[]> {
  if (!supabase || !query.trim()) return [];

  try {
    const { data, error } = await supabase.functions.invoke('search-knowledge', {
      body: { q: query, top_k: topK },
    });
    if (error || !data?.results) return [];
    return data.results;
  } catch (err) {
    console.error('[Knowledge] Search failed:', err);
    return [];
  }
}

// ─── Format fragments for Claude context ─────────────────────────────────────

export function formatFragmentsForContext(fragments: KnowledgeFragment[]): string {
  if (fragments.length === 0) return '';
  const lines = fragments.map(f => `- [${f.type}] ${f.content}`);
  return `Relevant knowledge about Robert:\n${lines.join('\n')}`;
}
