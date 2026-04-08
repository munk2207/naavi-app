/**
 * Naavi — Morning Brief Cache
 *
 * Assembles and stores the morning brief so it is instantly available
 * when Robert opens the app. Called by the sync scheduler after the
 * 07:00 morning pre-sync completes.
 *
 * Two operations:
 *   assemble()  — builds the brief from the integration snapshot and writes to SQLite
 *   read()      — returns the cached brief; returns null if not yet assembled today
 *
 * The brief expires at midnight — a new one is assembled each morning.
 * If Robert opens the app before 07:00 (unusual), the previous day's brief
 * is not shown — Naavi assembles a fresh one on demand instead.
 */

import type { LocalDB } from '../integrations/base-adapter';
import type { IntegrationOrchestrator } from '../integrations/index';
import type { CognitiveProfile } from '../../schema/cognitive-profile';
import type { MorningBrief } from '../../docs/flows/morning-checkin-prompt';

// Re-export the assembler from the prompt file — it lives there because
// it is tightly coupled to what Claude receives
import { assembleMorningBrief } from '../../docs/flows/morning-checkin-prompt';

// ─────────────────────────────────────────────────────────────────────────────
// CACHED BRIEF — what is stored in SQLite
// ─────────────────────────────────────────────────────────────────────────────

export interface CachedBrief {
  brief: MorningBrief;
  assembled_at: string;       // ISO datetime
  assembled_for_date: string; // ISO date "YYYY-MM-DD" — for expiry check
  assembly_duration_ms: number;
  integrations_used: string[];
  integrations_stale: string[];
}

const CACHE_KEY = 'morning_brief_today';

// ─────────────────────────────────────────────────────────────────────────────
// MORNING BRIEF CACHE
// ─────────────────────────────────────────────────────────────────────────────

export class MorningBriefCache {
  private db: LocalDB;
  private orchestrator: IntegrationOrchestrator;
  private profile: CognitiveProfile;

  constructor(db: LocalDB, orchestrator: IntegrationOrchestrator, profile: CognitiveProfile) {
    this.db = db;
    this.orchestrator = orchestrator;
    this.profile = profile;
  }

  /**
   * Assembles the morning brief from the current integration snapshot
   * and writes it to SQLite. Called by the morning pre-sync at 07:00.
   *
   * Never throws — if assembly fails partially, it writes whatever it can.
   * A partial brief is always better than no brief.
   */
  async assemble(): Promise<CachedBrief> {
    const start = Date.now();
    const today = new Date();

    // Pull the full integration snapshot (reads from SQLite cache — no network)
    const snapshot = await this.orchestrator.snapshot();

    // Build weather summary in the shape assembleMorningBrief expects
    const weatherSummary = snapshot.weather
      ? {
          condition: snapshot.weather.today.condition,
          temp_celsius: snapshot.weather.today.current_temp_celsius,
          precipitation_chance: snapshot.weather.today.precipitation_chance,
        }
      : null;

    // Merge FHIR appointments into calendar events for the assembler
    // FHIR appointments not already in calendar get added as synthetic events
    const calendarEvents = buildCalendarEventsForAssembler(snapshot);

    const brief = assembleMorningBrief(
      this.profile,
      calendarEvents,
      weatherSummary ?? { condition: 'cloudy', temp_celsius: 10, precipitation_chance: 0 },
      today,
    );

    const cached: CachedBrief = {
      brief,
      assembled_at: new Date().toISOString(),
      assembled_for_date: today.toISOString().split('T')[0],
      assembly_duration_ms: Date.now() - start,
      integrations_used: getConnectedIntegrations(snapshot),
      integrations_stale: snapshot.stale_integrations,
    };

    await this.db.set('morning_brief', CACHE_KEY, cached);
    return cached;
  }

  /**
   * Returns today's cached brief, or null if:
   *   - No brief has been assembled today
   *   - The cached brief is from a previous day
   *   - It is before 07:00 (brief not yet ready)
   *
   * If null is returned, the caller should either:
   *   a) Trigger an on-demand assembly (if Robert opened the app early)
   *   b) Show a "getting your brief ready" state (rare)
   */
  async read(): Promise<CachedBrief | null> {
    const cached = await this.db.get('morning_brief', CACHE_KEY) as CachedBrief | null;
    if (!cached) return null;

    const today = new Date().toISOString().split('T')[0];
    if (cached.assembled_for_date !== today) return null;    // Stale from yesterday

    return cached;
  }

  /**
   * Assembles a brief on demand — used when Robert opens the app before
   * the 07:00 scheduled pre-sync has run. Less common but must be handled.
   *
   * Triggers a live sync first (waits for completion), then assembles.
   * This is the one case where there may be a brief delay (2–4 seconds).
   */
  async assembleOnDemand(): Promise<CachedBrief> {
    await this.orchestrator.morningSyncPriority();
    return this.assemble();
  }

  /**
   * Returns true if a valid brief for today is already cached.
   * Used by the app to decide whether to show a loading state.
   */
  async isReady(): Promise<boolean> {
    const cached = await this.read();
    return cached !== null;
  }

  /**
   * Marks a brief item as acknowledged — so if Robert closes the app
   * mid-check-in and reopens it, he does not hear the same items again.
   */
  async acknowledgeItem(itemId: string): Promise<void> {
    const cached = await this.read();
    if (!cached) return;

    // Mark the item across all brief sections
    const sections = [
      cached.brief.appointments,
      cached.brief.medication_alerts,
      cached.brief.pending_threads,
      cached.brief.relationship_alerts,
    ];

    for (const section of sections) {
      const item = section.find(i => i.id === itemId);
      if (item) {
        (item as { id: string; acknowledged?: boolean }).acknowledged = true;
      }
    }

    await this.db.set('morning_brief', CACHE_KEY, cached);
  }

  /**
   * Returns only unacknowledged items — used when Robert resumes
   * a check-in after leaving the app mid-conversation.
   */
  async getUnacknowledgedItems(): Promise<{ id: string; label: string; section: string }[]> {
    const cached = await this.read();
    if (!cached) return [];

    const unacknowledged: { id: string; label: string; section: string }[] = [];

    const sectionMap = [
      { key: 'appointments',       items: cached.brief.appointments },
      { key: 'medication_alerts',  items: cached.brief.medication_alerts },
      { key: 'pending_threads',    items: cached.brief.pending_threads },
      { key: 'relationship_alerts',items: cached.brief.relationship_alerts },
    ];

    for (const { key, items } of sectionMap) {
      for (const item of items) {
        if (!(item as { acknowledged?: boolean }).acknowledged) {
          unacknowledged.push({ id: item.id, label: item.label, section: key });
        }
      }
    }

    return unacknowledged;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge calendar events and FHIR appointments into a single list for the assembler.
 * FHIR appointments not already in the calendar are added as synthetic entries.
 * This ensures the brief always includes medical appointments even if Robert
 * forgot to add them to his personal calendar.
 */
function buildCalendarEventsForAssembler(
  snapshot: Awaited<ReturnType<IntegrationOrchestrator['snapshot']>>
) {
  type AssemblerEvent = {
    id: string;
    title: string;
    start: string;
    end: string;
    category: 'medical' | 'social' | 'activity' | 'personal' | 'other';
    location?: string;
  };

  const events: AssemblerEvent[] = [];

  // Add calendar events
  for (const event of snapshot.calendar_events ?? []) {
    events.push({
      id: event.id,
      title: event.title,
      start: event.start_at,
      end: event.end_at,
      category: event.category,
      location: event.location,
    });
  }

  // Add FHIR appointments not already in calendar
  for (const appt of snapshot.upcoming_appointments ?? []) {
    if (!appt.also_in_calendar && appt.is_today) {
      events.push({
        id: appt.id,
        title: appt.provider_name,
        start: appt.start_at,
        end: appt.start_at,    // End not always in FHIR — use start as fallback
        category: 'medical',
        location: appt.clinic_name,
      });
    }
  }

  return events;
}

function getConnectedIntegrations(
  snapshot: Awaited<ReturnType<IntegrationOrchestrator['snapshot']>>
): string[] {
  return Object.entries(snapshot.statuses)
    .filter(([, meta]) => meta.status === 'connected')
    .map(([id]) => id);
}
