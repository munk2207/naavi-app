/**
 * Naavi — Cognitive Profile Schema
 * TypeScript type definitions for the persistent context layer.
 *
 * This file defines the *shape* of Robert's profile in code.
 * Every field here corresponds to a section in cognitive-profile-design.md.
 *
 * Convention:
 *   - Optional fields use `?` — Naavi can function without them
 *   - Required fields have no `?` — the profile is incomplete without them
 *   - `observed_at` timestamps track when Naavi learned something vs. when it was declared
 */

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — IDENTITY
// ─────────────────────────────────────────────────────────────────────────────

export type Language = 'en' | 'fr';
export type Formality = 'formal' | 'casual';
export type Verbosity = 'concise' | 'moderate' | 'detailed';
export type ToneStyle = 'peer' | 'assistant' | 'companion';

export interface Identity {
  full_name: string;
  preferred_name: string;
  date_of_birth: string;           // ISO 8601: "1957-08-14"
  location: {
    city: string;
    province: string;              // e.g. "ON"
    timezone: string;              // IANA tz: "America/Toronto"
  };
  language: {
    primary: Language;
    secondary?: Language;
    preference_notes?: string;     // e.g. "Uses French for medical contexts"
  };
  communication_style: {
    formality: Formality;
    verbosity: Verbosity;
    tone: ToneStyle;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — TEMPORAL RHYTHMS
// ─────────────────────────────────────────────────────────────────────────────

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface RoutineEvent {
  time: string;                    // "HH:MM" format
  label: string;
  category: 'health' | 'social' | 'activity' | 'meal' | 'work' | 'other';
}

export interface MedicationScheduleEntry {
  name: string;                    // Links to health.medications
  times: string[];                 // ["08:00", "20:00"]
  with_food: boolean;
  adherence_score: number;         // 0.0–1.0, observed over 90 days
  observed_at: string;
}

export interface TemporalRhythms {
  daily: {
    wake_time: string;
    morning_routine: string[];
    cognitive_peak_window: [string, string];    // ["09:00", "12:00"]
    rest_window?: [string, string];
    sleep_time: string;
  };
  weekly: Partial<Record<DayOfWeek, RoutineEvent[]>>;
  seasonal?: string[];
  medication_schedule: MedicationScheduleEntry[];
  confidence: number;              // 0.0–1.0 — how reliable is this data?
  last_updated: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3 — HEALTH CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export type HealthConditionStatus = 'active' | 'managed' | 'resolved' | 'monitoring';

export interface HealthCondition {
  name: string;
  status: HealthConditionStatus;
  diagnosed_year?: number;
  notes?: string;
}

export interface Medication {
  name: string;
  dosage: string;
  purpose: string;
  schedule_description: string;
  prescriber?: string;             // Links to care_team
  refill_due?: string;             // ISO date — triggers reminder
  last_filled?: string;
}

export interface CareTeamMember {
  id: string;
  name: string;
  role: string;                    // "Family Physician", "Cardiologist"
  clinic?: string;
  phone?: string;
  booking_method?: 'phone' | 'portal' | 'direct';
  next_appointment?: string;       // ISO datetime
}

export interface VitalsTrend {
  metric: string;                  // "blood_pressure", "blood_sugar"
  trend_description: string;       // Plain language: "stable, elevated when stressed"
  observed_at: string;
}

export interface HealthContext {
  conditions: HealthCondition[];
  medications: Medication[];
  care_team: CareTeamMember[];
  vitals_trends: VitalsTrend[];
  health_goals: string[];
  portal_integration: {
    provider: string;
    connected: boolean;
    last_synced?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 4 — RELATIONSHIPS
// ─────────────────────────────────────────────────────────────────────────────

export type RelationPriority = 'high' | 'medium' | 'low';
export type ContactMethod = 'phone call' | 'text' | 'email' | 'in-person' | 'video call';

export interface Person {
  id: string;
  name: string;
  relation: string;                // "daughter", "friend", "family physician"
  priority: RelationPriority;
  contact: {
    phone?: string;
    email?: string;
    preferred_method: ContactMethod;
  };
  patterns: {
    typical_frequency?: string;    // "weekly", "every 2-3 weeks"
    typical_timing?: string;       // "Saturday mornings"
    last_contact?: string;         // ISO date
    days_since_contact?: number;   // Computed field
  };
  notes: string[];
  significant_dates?: Array<{
    label: string;
    date: string;                  // "MM-DD" for recurring, "YYYY-MM-DD" for one-time
  }>;
}

export interface RelationshipAlert {
  person_id: string;
  message: string;
  triggered_at: string;
  dismissed: boolean;
}

export interface Relationships {
  people: Person[];
  alerts: RelationshipAlert[];
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 5 — ENVIRONMENT & INTEGRATIONS
// ─────────────────────────────────────────────────────────────────────────────

export type DeviceType = 'thermostat' | 'lock' | 'lighting' | 'camera' | 'speaker' | 'other';
export type IntegrationStatus = 'connected' | 'disconnected' | 'pending' | 'declined';

export interface SmartDevice {
  id: string;
  type: DeviceType;
  brand: string;
  label: string;
  preferences?: Record<string, string | number>;  // e.g. { daytime_temp: 21 }
  last_seen?: string;
}

export interface FrequentLocation {
  name: string;
  type: 'medical' | 'grocery' | 'leisure' | 'social' | 'other';
  address?: string;
  notes?: string;
  seasonal?: string;
}

export interface Integration {
  provider: string;
  status: IntegrationStatus;
  connected_at?: string;
  last_synced?: string;
  declined_reason?: string;        // Why Robert chose not to connect
  scopes?: string[];               // What data is accessible
}

export interface Environment {
  home: {
    smart_devices: SmartDevice[];
  };
  frequent_locations: FrequentLocation[];
  integrations: {
    calendar?: Integration;
    notes?: Integration;
    voice_memos?: Integration;
    health_portal?: Integration;
    email?: Integration;
    banking?: Integration;         // Will typically be 'declined'
    [key: string]: Integration | undefined;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 6 — PREFERENCES & BOUNDARIES
// ─────────────────────────────────────────────────────────────────────────────

export interface Preferences {
  interaction: {
    proactive_check_ins: boolean;
    max_daily_prompts: number;
    quiet_hours: [string, string];            // ["22:00", "07:30"]
    preferred_channel: 'voice' | 'text' | 'notification';
    fallback_channel: 'voice' | 'text' | 'notification';
  };
  response_style: {
    morning: string;
    evening: string;
    urgency_mode: string;
  };
  reminders: {
    medication: boolean;
    appointments: boolean;
    refills: boolean;
    birthdays: boolean;
    follow_ups: boolean;
  };
  privacy: {
    share_health_data_with_family: boolean;
    voice_recordings_stored: boolean;
    location_tracking: boolean;
  };
  language_triggers: {
    switch_to_french: string[];
    switch_to_english: string[];
  };
  hard_boundaries: string[];                  // Enforced rules, not preferences
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 7 — BEHAVIOURAL SIGNALS & LEARNED CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export type SignalType = 'observation' | 'deviation' | 'pattern' | 'anomaly';
export type ThreadStatus = 'open' | 'reminder_scheduled' | 'resolved' | 'dismissed';

export interface RoutineDeviation {
  date: string;
  signal: string;
  type: SignalType;
  followup_needed: boolean;
}

export interface VoiceToneNote {
  date: string;
  note: string;
  sentiment?: 'positive' | 'neutral' | 'fatigued' | 'stressed' | 'elevated';
}

export interface PendingThread {
  id: string;
  created_at: string;
  source: string;                             // What Robert said or what triggered it
  status: ThreadStatus;
  remind_on?: string;                         // ISO datetime
  resolved_at?: string;
  resolution_note?: string;
}

export interface BehaviouralSignals {
  routine_deviations: RoutineDeviation[];
  engagement_patterns: {
    most_active_hours: string[];
    avg_session_length_seconds: number;
    topics_robert_initiates: string[];
  };
  voice_tone_notes: VoiceToneNote[];
  memory_aid_patterns: {
    frequently_asked: string[];
  };
  pending_threads: PendingThread[];
  interests: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE CONFIDENCE SCORES
// ─────────────────────────────────────────────────────────────────────────────

export interface ProfileConfidence {
  identity: number;        // 0.0–1.0
  rhythms: number;
  health: number;
  relationships: number;
  environment: number;
  preferences: number;
  signals: number;
  overall: number;         // Weighted average
  days_observed: number;   // Profile age in observation days
  last_updated: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT — COGNITIVE PROFILE
// ─────────────────────────────────────────────────────────────────────────────

export interface CognitiveProfile {
  // Metadata
  profile_id: string;                         // UUID
  schema_version: string;                     // "0.1" — for future migrations
  created_at: string;
  last_updated: string;

  // The seven layers
  identity: Identity;
  rhythms: TemporalRhythms;
  health: HealthContext;
  relationships: Relationships;
  environment: Environment;
  preferences: Preferences;
  signals: BehaviouralSignals;

  // Meta
  confidence: ProfileConfidence;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT PACKET — What is sent to Claude per interaction
// Not the full profile — a curated slice relevant to the current moment.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextPacket {
  user_message: string;
  language: Language;
  timestamp: string;
  time_of_day: 'morning' | 'afternoon' | 'evening' | 'night';

  // Slices of the profile, selected by relevance
  identity_summary: Pick<Identity, 'preferred_name' | 'communication_style' | 'language'>;
  todays_events: RoutineEvent[];
  pending_reminders: PendingThread[];
  active_medications: Medication[];
  recent_signals: RoutineDeviation[];
  relevant_relationships: Person[];       // Only those relevant to the message

  // Constraints for this response
  response_constraints: {
    max_length: 'brief' | 'moderate' | 'full';
    must_avoid: string[];                  // From hard_boundaries
    language: Language;
  };
}
