/**
 * Bare relationship words ("wife", "boss") that users refer to a saved
 * contact by, instead of the contact's actual name. Shared between:
 *   - naavi-chat/intentHandlers.ts (PERSON_LOOKUP — "who is my wife")
 *   - lookup-contact (DRAFT_MESSAGE / SET_ACTION_RULE recipient resolution
 *     — "text my wife", 2026-08-13)
 * Single list so both stay in sync instead of drifting independently.
 */

export const RELATIONSHIP_WORDS = new Set([
  'wife', 'husband', 'spouse', 'partner', 'fiance', 'fiancee',
  'mom', 'mother', 'dad', 'father', 'parent',
  'son', 'daughter', 'brother', 'sister', 'sibling',
  'boss', 'manager', 'assistant', 'neighbor', 'neighbour',
]);
