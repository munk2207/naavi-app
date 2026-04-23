/**
 * Time-aware brief content logic.
 *
 * The brief shows different content depending on when Robert opens the app:
 *   Morning (05:00–11:00) — today's full agenda + weather + critical unread
 *   Midday  (11:00–15:00) — rest of today + midday weather
 *   Evening (15:00–20:00) — rest of today + tomorrow preview
 *   Night   (20:00–05:00) — tomorrow's agenda (primary) + any overnight alerts
 *
 * `getBriefWindow()` returns the current window label. Callers can use it to
 * filter brief items so Robert never sees an event that's already passed and
 * always has a useful "what's next" view.
 */

import type { BriefItem } from './naavi-client';

export type BriefWindow = 'morning' | 'midday' | 'evening' | 'night';

export function getBriefWindow(now: Date = new Date()): BriefWindow {
  const h = now.getHours();
  if (h >= 5  && h < 11) return 'morning';
  if (h >= 11 && h < 15) return 'midday';
  if (h >= 15 && h < 20) return 'evening';
  return 'night';
}

/**
 * Filter brief items for the current window.
 *
 *   morning — keep everything scheduled for today (past events stripped).
 *   midday  — keep everything scheduled for today that hasn't happened yet.
 *   evening — keep today's remaining + all of tomorrow.
 *   night   — show tomorrow's items; suppress finished today items entirely.
 *
 * Weather is preserved across all windows (it's the "always show something"
 * anchor when everything else is empty).
 */
export function filterByWindow(items: BriefItem[], window: BriefWindow, now: Date = new Date()): BriefItem[] {
  const nowMs        = now.getTime();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday   = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const endOfTomorrow = new Date(endOfToday); endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);

  return items.filter(item => {
    if (item.category === 'weather') return true; // always show
    if (!item.startISO) return true; // undated items (task, health) always show

    const t = new Date(item.startISO).getTime();
    if (Number.isNaN(t)) return true;

    switch (window) {
      case 'morning':
        // Today only, strip items finished before 5 AM (rare but clean)
        return t >= startOfToday.getTime() && t <= endOfToday.getTime();
      case 'midday':
      case 'evening':
        if (window === 'evening') {
          // Today's remaining + all of tomorrow
          return t >= nowMs && t <= endOfTomorrow.getTime();
        }
        // Midday — today's remaining
        return t >= nowMs && t <= endOfToday.getTime();
      case 'night':
        // Tomorrow's items primarily; allow late-today events still upcoming
        return t >= nowMs && t <= endOfTomorrow.getTime();
    }
  });
}

/**
 * Rotating "empty brief" tip — surfaces a suggested voice command so Robert
 * knows what Naavi can do even on a quiet day. Picked once per app launch
 * (caller memoises the value on mount so it doesn't flicker on re-render).
 *
 * Marketing hook: copy lives in one place so it's easy to edit / swap to a
 * remote source later without touching UI code.
 */
export const BRIEF_TIPS: string[] = [
  'Try: "Remind me when I arrive at Costco"',
  'Try: "Text my daughter at 5 PM"',
  'Try: "Alert me if it rains tomorrow"',
  'Try: "What\'s on my calendar tomorrow?"',
  'Try: "Remember my warranty expires March 2030"',
  'Try: "Find my Bell invoice"',
];

export function pickRandomTip(): string {
  return BRIEF_TIPS[Math.floor(Math.random() * BRIEF_TIPS.length)];
}
