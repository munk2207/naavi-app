/**
 * Recipient lookup chain for Draft Email card and similar flows.
 *
 * Session 26 design lock: when Naavi needs an email address for a recipient,
 * resolve in this order:
 *   1. Google People API (live)  — Robert's actual contacts, including the
 *                                  "otherContacts" pool (people he's emailed).
 *   2. Calendar attendees, 6 mo  — fallback for people he's met but never
 *                                  emailed. Stubbed for V57; ships in the
 *                                  next AAB.
 *   3. Ask Robert directly       — channel-aware (voice or text) per the
 *                                  channel-consistency rule. Caller handles.
 *
 * Returns ALL matches in step 1 (not just the best). Caller decides:
 *   - 0 matches → ask
 *   - 1 match   → readback for confirmation, then draft
 *   - N matches → show picker, then draft
 */

import { supabase } from './supabase';
import type { Contact } from './contacts';

export type RecipientSource = 'contacts' | 'calendar' | 'none';

export interface RecipientResolution {
  source: RecipientSource;
  matches: Contact[];   // empty when source='none'
}

// ── Step 1: People API ──────────────────────────────────────────────────────

/** Fetch all matching contacts from Google People API. Filters to those with
 *  an email address (since the immediate use case is email drafting). */
export async function lookupRecipientCandidates(name: string): Promise<Contact[]> {
  if (!supabase || !name.trim()) return [];

  try {
    const { data, error } = await supabase.functions.invoke('lookup-contact', {
      body: { name },
    });
    if (error || data?.error) return [];

    // The Edge Function returns `contacts: Contact[]` (Session 26). Older
    // deployments return only `contact: Contact | null` — fall back to the
    // single-match shape so this works during the gradual rollout.
    const arr: Contact[] = Array.isArray(data?.contacts)
      ? data.contacts
      : (data?.contact ? [data.contact] : []);

    return arr.filter(c => c.email && c.email.trim().length > 0);
  } catch {
    return [];
  }
}

// ── Step 2: Calendar attendees (last 6 months) — STUBBED ────────────────────

/** Search recent calendar events for attendees matching the recipient name.
 *  TODO V58: implement via a new Edge Function `lookup-calendar-contact` that
 *  pulls events from the last 180 days and matches attendee emails by
 *  local-part / display name. Stubbed to return [] for V57 — People API
 *  (with otherContacts fallback) covers most real-world cases. */
export async function lookupRecipientFromCalendar(_name: string): Promise<Contact[]> {
  return [];
}

// ── Orchestrator: contacts → calendar → none ───────────────────────────────

/** Resolve a recipient name through the lookup chain. Returns all matches
 *  found at the first non-empty step, plus a `source` tag so the caller can
 *  describe the result back to Robert ("I found two Johns in your contacts…"). */
export async function resolveRecipient(name: string): Promise<RecipientResolution> {
  const fromContacts = await lookupRecipientCandidates(name);
  if (fromContacts.length > 0) {
    return { source: 'contacts', matches: fromContacts };
  }

  const fromCalendar = await lookupRecipientFromCalendar(name);
  if (fromCalendar.length > 0) {
    return { source: 'calendar', matches: fromCalendar };
  }

  return { source: 'none', matches: [] };
}
