/**
 * Naavi — Integration Layer: Normalised Type Definitions
 *
 * These types define what every adapter returns after normalising
 * raw external API data. The rest of the app only ever sees these
 * types — never raw Google Calendar JSON, never raw FHIR resources.
 *
 * The goal: if we ever swap Google Calendar for a different provider,
 * only the adapter changes. Nothing else in the codebase is affected.
 */

// ─────────────────────────────────────────────────────────────────────────────
// SHARED
// ─────────────────────────────────────────────────────────────────────────────

export type IntegrationId =
  | 'google_calendar'
  | 'apple_calendar'
  | 'myChart'
  | 'weather'
  | 'ecobee'
  | 'hue'
  | 'schlage'
  | 'apple_health';

export type IntegrationStatus =
  | 'connected'       // syncing normally
  | 'degraded'        // auth issue — serving stale cache
  | 'stale'           // sync overdue but not auth-related
  | 'disconnected'    // user revoked or never connected
  | 'pending_setup';  // connected but first sync not yet complete

export interface IntegrationMeta {
  id: IntegrationId;
  status: IntegrationStatus;
  last_synced_at: string | null;        // ISO datetime
  stale_threshold_minutes: number;      // When to consider data stale
  error_message?: string;               // Human-readable, for display only
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR
// ─────────────────────────────────────────────────────────────────────────────

export type EventCategory =
  | 'medical'         // Matches care team name or clinic in profile
  | 'social'          // Contains names from relationships
  | 'activity'        // Gym, golf, walk — matches interests/rhythms
  | 'personal'
  | 'other';

export interface NormalisedCalendarEvent {
  id: string;
  source: 'google_calendar' | 'apple_calendar';
  title: string;
  start_at: string;                     // ISO datetime
  end_at: string;
  all_day: boolean;
  location?: string;
  category: EventCategory;
  care_team_match?: string;             // Name of matched care team member, if any
  notes?: string;
  is_today: boolean;
  days_until: number;                   // 0 = today, 1 = tomorrow, etc.
  cached_at: string;                    // ISO datetime — when this was last synced
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH PORTAL (FHIR)
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalisedAppointment {
  id: string;
  provider_name: string;
  specialty?: string;
  clinic_name?: string;
  clinic_address?: string;
  start_at: string;                     // ISO datetime
  duration_minutes?: number;
  status: 'booked' | 'pending' | 'cancelled' | 'fulfilled';
  is_today: boolean;
  days_until: number;
  also_in_calendar: boolean;            // Cross-reference flag
  cached_at: string;
}

export interface NormalisedMedication {
  id: string;
  name: string;
  dosage: string;
  frequency_description: string;        // "twice daily with meals"
  prescriber_name?: string;
  status: 'active' | 'on-hold' | 'stopped';
  matches_profile: boolean;             // Is this in the Cognitive Profile?
  profile_discrepancy?: string;         // Description of any mismatch
  cached_at: string;
}

export type TrendDirection = 'stable' | 'rising' | 'falling' | 'insufficient_data';

export interface NormalisedObservationTrend {
  metric: string;                       // "blood_pressure_systolic", "A1C", "glucose"
  display_name: string;                 // "Blood pressure", "A1C", "Blood sugar"
  trend: TrendDirection;
  trend_description: string;            // "stable over 3 readings"
  last_reading_date: string;
  // Raw values are NOT stored — only the trend
  cached_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEATHER
// ─────────────────────────────────────────────────────────────────────────────

export type WeatherCondition =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'rain'
  | 'heavy_rain'
  | 'snow'
  | 'freezing_rain'
  | 'fog'
  | 'thunderstorm';

export interface NormalisedDayWeather {
  date: string;                         // ISO date "YYYY-MM-DD"
  condition: WeatherCondition;
  temp_high_celsius: number;
  temp_low_celsius: number;
  current_temp_celsius: number;         // Only populated for today
  precipitation_chance: number;         // 0–100
  wind_speed_kph?: number;
  uv_index?: number;
  is_today: boolean;
  relevance_reason?: string;            // Why this matters to Robert, if anything
  cached_at: string;
}

export interface NormalisedWeatherSummary {
  location: string;                     // "Ottawa, ON"
  today: NormalisedDayWeather;
  forecast: NormalisedDayWeather[];     // Next 3 days
  cached_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART HOME
// ─────────────────────────────────────────────────────────────────────────────

// Thermostat
export type ThermostatMode = 'heat' | 'cool' | 'auto' | 'off';

export interface NormalisedThermostatState {
  device_id: string;
  label: string;                        // "Main thermostat"
  current_temp_celsius: number;
  set_point_celsius: number;
  mode: ThermostatMode;
  is_heating: boolean;
  is_cooling: boolean;
  cached_at: string;
}

// Lighting
export interface NormalisedLightZone {
  zone_id: string;
  label: string;                        // "Kitchen", "Bedroom"
  is_on: boolean;
  brightness_percent?: number;          // 0–100
  colour_temp_kelvin?: number;          // 2700 (warm) – 6500 (cool)
  cached_at: string;
}

// Lock
export type LockState = 'locked' | 'unlocked' | 'jammed' | 'unknown';

export interface NormalisedLockState {
  device_id: string;
  label: string;                        // "Front door"
  state: LockState;
  last_changed_at?: string;
  cached_at: string;
}

// Smart home command result
export interface SmartHomeCommandResult {
  success: boolean;
  device_id: string;
  action_taken: string;                 // Human-readable: "Set thermostat to 22°C"
  confirmation_required: boolean;       // True for unlock commands
  confirmation_prompt?: string;         // Spoken confirmation question
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLE HEALTH / HEALTHKIT
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalisedHealthSummary {
  date: string;                         // ISO date — the day this covers
  steps: {
    today: number;
    seven_day_average: number;
    goal: number;                       // From Cognitive Profile
    vs_goal: 'above' | 'at' | 'below';
    trend: TrendDirection;
  };
  sleep: {
    last_night_hours: number;
    seven_day_average_hours: number;
    trend: TrendDirection;
    flag?: string;                      // e.g. "3 nights under 6 hrs"
  };
  resting_heart_rate?: {
    weekly_average_bpm: number;
    trend: TrendDirection;
  };
  // Nothing else — Naavi does not collect more than it needs
  has_anomaly: boolean;                 // True if any metric warrants surfacing
  anomaly_description?: string;         // Plain language, if has_anomaly = true
  cached_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED ORCHESTRATOR OUTPUT
// What the Morning Brief Assembler receives when it calls orchestrator.read()
// ─────────────────────────────────────────────────────────────────────────────

export interface IntegrationSnapshot {
  captured_at: string;
  statuses: Record<IntegrationId, IntegrationMeta>;

  // Data — may be null if integration is disconnected
  calendar_events: NormalisedCalendarEvent[] | null;
  upcoming_appointments: NormalisedAppointment[] | null;
  medications: NormalisedMedication[] | null;
  observation_trends: NormalisedObservationTrend[] | null;
  weather: NormalisedWeatherSummary | null;
  thermostat: NormalisedThermostatState | null;
  health_summary: NormalisedHealthSummary | null;

  // Flags for the brief assembler
  has_calendar_fhir_discrepancy: boolean;
  has_medication_profile_discrepancy: boolean;
  stale_integrations: IntegrationId[];
}
