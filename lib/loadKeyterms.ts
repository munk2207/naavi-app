/**
 * Load contact names as Deepgram keyterms.
 *
 * Queries the people table for known names and returns them as
 * an array of strings for Deepgram's keyterm prompting feature.
 * This helps Deepgram correctly transcribe names like "Hussein"
 * instead of guessing "whom".
 *
 * Always includes "Naavi" and "Robert" as fixed terms.
 */

import { supabase } from './supabase';

export async function loadKeyterms(): Promise<string[]> {
  const fixed = ['Naavi', 'MyNaavi', 'Robert', 'end', 'goodbye', 'cancel', 'change'];

  if (!supabase) return fixed;

  try {
    const { data } = await supabase
      .from('people')
      .select('name')
      .limit(50);

    if (!data || data.length === 0) return fixed;

    const names: string[] = [...fixed];
    for (const row of data) {
      const name = (row.name ?? '').trim();
      if (!name) continue;
      // Add full name
      names.push(name);
      // Also add individual parts for compound names ("Hussein Al-Natour" → "Hussein", "Al-Natour")
      const parts = name.split(/\s+/);
      if (parts.length > 1) {
        for (const part of parts) {
          if (part.length > 1) names.push(part);
        }
      }
    }

    // Deduplicate (case-insensitive)
    const seen = new Set<string>();
    return names.filter(n => {
      const lower = n.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
  } catch (err) {
    console.error('[loadKeyterms] Failed to load names:', err);
    return fixed;
  }
}
