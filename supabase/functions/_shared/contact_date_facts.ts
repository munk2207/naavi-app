/**
 * B10w — extracted from `global-search/adapters/contacts.ts` (originally
 * shipped in B10r) so `lookup-contact/index.ts` can share the identical
 * birthday/anniversary formatting logic instead of duplicating it.
 *
 * Ownership rule (per B10w's Phase 2 external review): this module is the
 * authoritative implementation of contact birthday/anniversary formatting.
 * Future date-formatting changes belong here, not in `contacts.ts` or
 * `lookup-contact/index.ts` directly — both are importers, not owners.
 */

// Google People API date types. `year` is genuinely optional on a Birthday
// (Google's own spec: "0 to specify a date without a year") — never invent
// one when absent (CLAUDE.md Rule 18).
export type PersonDate     = { year?: number; month?: number; day?: number };
export type PersonBirthday = { date?: PersonDate; text?: string };
// Anniversaries live under the generic `events` field (type "anniversary")
// — there is no dedicated `anniversary` field on the Person resource.
export type PersonEvent    = { date?: PersonDate; type?: string; formattedType?: string };

// Structural minimum any People API response shape needs to use this module —
// callers' own richer Person types (names, emails, phones, ...) are still
// assignable here without extending anything.
export type PersonWithDates = { birthdays?: PersonBirthday[]; events?: PersonEvent[] };

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Formats a People API date into "Mon Day" or "Mon Day, Year". Never
// fabricates a year Google didn't provide (CLAUDE.md Rule 18) — Calendar's
// "next occurrence" year is not a source of truth for this; see get-naavi-
// prompt/index.ts's CONTACTS IS AUTHORITATIVE rule for the consuming side.
export function formatDateFact(date?: PersonDate): string | null {
  if (!date?.month || !date?.day) return null;
  const month = MONTH_NAMES[date.month - 1];
  if (!month) return null;
  return date.year && date.year > 0 ? `${month} ${date.day}, ${date.year}` : `${month} ${date.day}`;
}

// Extracts birthday + anniversary display text from a Person-shaped object,
// or null when Contacts has none on file (silence, not a guess — Rule 18).
export function contactDateFacts(p: PersonWithDates): { birthday: string | null; anniversary: string | null } {
  const birthday = formatDateFact(p.birthdays?.[0]?.date);
  const anniversary = formatDateFact(p.events?.find(e => e.type === 'anniversary')?.date);
  return { birthday, anniversary };
}
