/**
 * Naavi — Integration Orchestrator
 *
 * This is the single entry point for all integration data.
 * The rest of the app imports ONLY from here — never from individual adapters.
 *
 * Two responsibilities:
 *   1. READ:  assemble a full IntegrationSnapshot from all cached adapters
 *   2. SYNC:  run all adapter syncs on their respective schedules
 *
 * The Morning Brief Assembler calls snapshot().
 * The background sync scheduler calls syncAll() or syncOne().
 */

import { CalendarAdapter } from './calendar-adapter';
import { WeatherAdapter } from './weather-adapter';
import { HealthPortalAdapter } from './health-portal-adapter';
import type { LocalDB, SyncResult, TokenStore } from './base-adapter';
import type { CognitiveProfile } from '../../schema/cognitive-profile';
import type {
  IntegrationId,
  IntegrationMeta,
  IntegrationSnapshot,
  NormalisedCalendarEvent,
  NormalisedAppointment,
  NormalisedMedication,
  NormalisedObservationTrend,
  NormalisedWeatherSummary,
  SmartHomeCommandResult,
} from '../../schema/integrations';

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

export class IntegrationOrchestrator {
  private calendar: CalendarAdapter;
  private weather: WeatherAdapter;
  private healthPortal: HealthPortalAdapter;
  // Smart home adapters are instantiated lazily (only when Robert uses them)

  constructor(db: LocalDB, tokenStore: TokenStore, profile: CognitiveProfile) {
    this.calendar     = new CalendarAdapter(db, tokenStore, profile);
    this.weather      = new WeatherAdapter(db, tokenStore, profile);
    this.healthPortal = new HealthPortalAdapter(db, tokenStore, profile);
  }

  // ── Snapshot: read all cached data into a unified object ─────────────────

  /**
   * Assembles an IntegrationSnapshot from all adapters.
   * All reads come from SQLite — this never touches the network.
   * Called by the Morning Brief Assembler immediately before building the brief.
   */
  async snapshot(): Promise<IntegrationSnapshot> {
    const now = new Date().toISOString();

    // Fetch all statuses and data concurrently
    const [
      calendarStatus,
      weatherStatus,
      healthStatus,
      calendarEvents,
      weatherSummary,
      healthData,
    ] = await Promise.all([
      this.calendar.status(),
      this.weather.status(),
      this.healthPortal.status(),
      this.calendar.read(),
      this.weather.read(),
      this.healthPortal.read(),
    ]);

    const statuses: Record<IntegrationId, IntegrationMeta> = {
      google_calendar: calendarStatus,
      apple_calendar:  { id: 'apple_calendar', status: 'disconnected', last_synced_at: null, stale_threshold_minutes: 30 },
      myChart:         healthStatus,
      weather:         weatherStatus,
      ecobee:          { id: 'ecobee', status: 'disconnected', last_synced_at: null, stale_threshold_minutes: 30 },
      hue:             { id: 'hue', status: 'disconnected', last_synced_at: null, stale_threshold_minutes: 0 },
      schlage:         { id: 'schlage', status: 'disconnected', last_synced_at: null, stale_threshold_minutes: 0 },
      apple_health:    { id: 'apple_health', status: 'disconnected', last_synced_at: null, stale_threshold_minutes: 480 },
    };

    const staleIntegrations = detectStaleIntegrations(statuses);

    // Cross-reference: appointments in FHIR but not in calendar
    const hasFhirCalendarDiscrepancy = detectFhirCalendarDiscrepancy(
      healthData.appointments,
      calendarEvents ?? [],
    );

    // Medication discrepancies
    const hasMedDiscrepancy = healthData.medications.some(m => m.profile_discrepancy);

    return {
      captured_at: now,
      statuses,
      calendar_events:        calendarEvents,
      upcoming_appointments:  healthData.appointments,
      medications:            healthData.medications,
      observation_trends:     healthData.observation_trends,
      weather:                weatherSummary,
      thermostat:             null,       // Smart home: on-demand only
      health_summary:         null,       // Apple Health: populated if connected
      has_calendar_fhir_discrepancy: hasFhirCalendarDiscrepancy,
      has_medication_profile_discrepancy: hasMedDiscrepancy,
      stale_integrations: staleIntegrations,
    };
  }

  // ── Sync: run background syncs ────────────────────────────────────────────

  /**
   * Sync a single integration by ID.
   * Called by the background scheduler on each integration's schedule.
   */
  async syncOne(id: IntegrationId): Promise<SyncResult> {
    switch (id) {
      case 'google_calendar': return this.calendar.sync();
      case 'weather':         return this.weather.sync();
      case 'myChart':         return this.healthPortal.sync();
      default:
        return {
          integration_id: id,
          success: false,
          records_updated: 0,
          synced_at: new Date().toISOString(),
          error: { type: 'unknown', message: `No adapter for ${id}`, retryable: false },
        };
    }
  }

  /**
   * Sync all connected integrations.
   * Called at app startup and periodically by the background scheduler.
   */
  async syncAll(): Promise<SyncResult[]> {
    return Promise.all([
      this.calendar.sync(),
      this.weather.sync(),
      this.healthPortal.sync(),
    ]);
  }

  /**
   * Run the morning pre-sync — called at 07:00 before Robert wakes.
   * Prioritises calendar and FHIR so the brief is ready immediately.
   */
  async morningSyncPriority(): Promise<void> {
    // Sequential: most important first
    await this.calendar.sync();
    await this.healthPortal.sync();
    await this.weather.sync();
  }

  // ── Status: expose integration health ────────────────────────────────────

  async getStatus(): Promise<Record<IntegrationId, IntegrationMeta>> {
    const [calendarStatus, weatherStatus, healthStatus] = await Promise.all([
      this.calendar.status(),
      this.weather.status(),
      this.healthPortal.status(),
    ]);

    return {
      google_calendar: calendarStatus,
      apple_calendar:  { id: 'apple_calendar', status: 'disconnected', last_synced_at: null, stale_threshold_minutes: 30 },
      myChart:         healthStatus,
      weather:         weatherStatus,
      ecobee:          { id: 'ecobee', status: 'disconnected', last_synced_at: null, stale_threshold_minutes: 30 },
      hue:             { id: 'hue', status: 'disconnected', last_synced_at: null, stale_threshold_minutes: 0 },
      schlage:         { id: 'schlage', status: 'disconnected', last_synced_at: null, stale_threshold_minutes: 0 },
      apple_health:    { id: 'apple_health', status: 'disconnected', last_synced_at: null, stale_threshold_minutes: 480 },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC SCHEDULE (used by Expo Background Fetch)
// Defines how often each integration should be synced.
// ─────────────────────────────────────────────────────────────────────────────

export const SYNC_SCHEDULE: Record<IntegrationId, number | null> = {
  google_calendar: 15,     // Every 15 minutes
  apple_calendar:  15,
  myChart:         240,    // Every 4 hours
  weather:         60,     // Every hour
  ecobee:          30,     // Every 30 minutes
  hue:             null,   // On demand only
  schlage:         null,   // On demand only
  apple_health:    null,   // Once daily at 07:00 — handled by morning sync
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function detectStaleIntegrations(statuses: Record<IntegrationId, IntegrationMeta>): IntegrationId[] {
  const stale: IntegrationId[] = [];
  const now = Date.now();

  for (const [id, meta] of Object.entries(statuses)) {
    if (meta.status === 'disconnected' || !meta.last_synced_at) continue;
    if (meta.stale_threshold_minutes === 0) continue;    // On-demand integrations never go stale

    const lastSync = new Date(meta.last_synced_at).getTime();
    const ageMinutes = (now - lastSync) / (1000 * 60);

    if (ageMinutes > meta.stale_threshold_minutes) {
      stale.push(id as IntegrationId);
    }
  }

  return stale;
}

function detectFhirCalendarDiscrepancy(
  fhirAppointments: NormalisedAppointment[],
  calendarEvents: NormalisedCalendarEvent[],
): boolean {
  for (const appt of fhirAppointments) {
    if (!appt.also_in_calendar) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY — creates and wires up the orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export function createIntegrationOrchestrator(
  db: LocalDB,
  tokenStore: TokenStore,
  profile: CognitiveProfile,
): IntegrationOrchestrator {
  return new IntegrationOrchestrator(db, tokenStore, profile);
}
