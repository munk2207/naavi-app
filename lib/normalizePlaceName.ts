/**
 * Place-name normalization helper — pure, side-effect-free.
 *
 * Lowercases, strips apostrophes / punctuation, collapses whitespace.
 * Used by the orchestrator's location-rule dedup logic so name spellings
 * like "Movati Athletic, Orleans", "Movati Athletic Orleans", and
 * "movati athletic orleans" all match the same existing row.
 *
 * 2026-05-26 (Wael, B6a) — extracted from hooks/useOrchestrator.ts so the
 * auto-tester can import and unit-test it directly (Rule 15a).
 *
 * Examples:
 *   normalizePlaceName("Tim Horton's")        === "tim hortons"
 *   normalizePlaceName("Movati Athletic, ON") === "movati athletic on"
 *   normalizePlaceName("  CoStCo  ")          === "costco"
 */
export function normalizePlaceName(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/['‘’]/g, '')     // strip apostrophes (Tim Horton's vs Tim Hortons)
    .replace(/[.,!?;:]/g, ' ')           // punctuation → space
    .replace(/\s+/g, ' ')                // collapse whitespace
    .trim();
}
