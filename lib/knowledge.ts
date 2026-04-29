/**
 * Knowledge layer — client-side wiring
 *
 * Connects to ingest-note and search-knowledge Edge Functions.
 * Used by the orchestrator to save and retrieve KnowledgeFragments.
 */

import { supabase } from './supabase';
import { invokeWithTimeout } from './invokeWithTimeout';

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
    const { data, error } = await invokeWithTimeout('ingest-note', {
      body: { text, source },
    }, 30_000);
    if (error) {
      console.error('[Knowledge] Ingest error:', error.message ?? error);
      return [];
    }
    if (!data?.fragments) {
      console.error('[Knowledge] Ingest returned no fragments. Response:', JSON.stringify(data));
      return [];
    }
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
    const { data, error } = await invokeWithTimeout('search-knowledge', {
      body: { q: query, top_k: topK },
    }, 15_000);
    if (error || !data?.results) return [];
    return data.results;
  } catch (err) {
    console.error('[Knowledge] Search failed:', err);
    return [];
  }
}

// ─── Fetch ALL knowledge fragments (no semantic filter) ──────────────────────

export async function fetchAllKnowledge(limit = 100): Promise<KnowledgeFragment[]> {
  if (!supabase) return [];
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return [];
    const { data, error } = await supabase
      .from('knowledge_fragments')
      .select('id, type, content, classification, source, confidence')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as KnowledgeFragment[];
  } catch (err) {
    console.error('[Knowledge] fetchAll failed:', err);
    return [];
  }
}

// ─── Delete fragments matching a keyword ─────────────────────────────────────

export async function deleteKnowledge(keyword: string): Promise<number> {
  if (!supabase || !keyword.trim()) return 0;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return 0;
    const { data, error } = await supabase
      .from('knowledge_fragments')
      .delete()
      .eq('user_id', session.user.id)
      .ilike('content', `%${keyword.trim()}%`)
      .select('id');
    if (error) { console.error('[Knowledge] Delete failed:', error.message); return 0; }
    console.log(`[Knowledge] Deleted ${data?.length ?? 0} fragments matching "${keyword}"`);
    return data?.length ?? 0;
  } catch (err) {
    console.error('[Knowledge] Delete failed:', err);
    return 0;
  }
}

// ─── Format fragments for Claude context ─────────────────────────────────────

export function formatFragmentsForContext(fragments: KnowledgeFragment[], isFullDump = false): string {
  if (fragments.length === 0) {
    if (isFullDump) return 'Relevant knowledge about Robert:\n- Nothing stored yet.';
    return '';
  }
  const lines = fragments.map(f => `- ${f.content}`);
  if (isFullDump) {
    return `Everything Naavi knows about Robert (${fragments.length} items — report ALL of them):\n${lines.join('\n')}`;
  }
  return `Relevant knowledge about Robert:\n${lines.join('\n')}`;
}
