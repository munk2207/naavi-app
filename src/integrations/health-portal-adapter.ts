/**
 * Naavi — Health Portal Adapter (MyChart / FHIR R4)
 *
 * Reads from Robert's health portal using the FHIR R4 standard.
 * MyChart, used by most Ottawa-area health networks, supports FHIR R4
 * with patient-authorised OAuth 2.0 access (SMART on FHIR).
 *
 * What this adapter reads:
 *   Appointment  → upcoming doctor appointments
 *   MedicationRequest → prescribed medications
 *   Condition    → diagnosed conditions
 *   Observation  → lab results and vitals (trend direction only — no raw values stored)
 *
 * What this adapter does NOT do:
 *   - Interpret results or give medical opinions
 *   - Store raw lab values in the Cognitive Profile
 *   - Share any data with anyone other than Robert
 *
 * Sync frequency: every 4 hours
 * Stale threshold: 6 hours
 * Auth: SMART on FHIR OAuth 2.0
 *
 * Canadian compliance note:
 *   FHIR data is stored locally (SQLite) and synced to Supabase ca-central-1.
 *   It is never sent outside Canada. Never used for model training.
 */

import { BaseAdapter, type LocalDB, type OAuthToken, type SyncResult, type TokenStore } from './base-adapter';
import type { CognitiveProfile } from '../../schema/cognitive-profile';
import type {
  NormalisedAppointment,
  NormalisedMedication,
  NormalisedObservationTrend,
  TrendDirection,
} from '../../schema/integrations';

// ─────────────────────────────────────────────────────────────────────────────
// FHIR R4 TYPES (abbreviated — only fields Naavi uses)
// ─────────────────────────────────────────────────────────────────────────────

interface FhirAppointment {
  resourceType: 'Appointment';
  id: string;
  status: 'booked' | 'pending' | 'cancelled' | 'fulfilled' | 'noshow';
  start: string;                        // ISO datetime
  end?: string;
  minutesDuration?: number;
  participant: Array<{
    actor?: { display?: string; reference?: string };
    status: string;
  }>;
  serviceType?: Array<{ text?: string }>;
}

interface FhirMedicationRequest {
  resourceType: 'MedicationRequest';
  id: string;
  status: 'active' | 'on-hold' | 'cancelled' | 'completed' | 'stopped';
  medicationCodeableConcept?: { text?: string };
  medicationReference?: { display?: string };
  dosageInstruction?: Array<{
    text?: string;
    doseAndRate?: Array<{ doseQuantity?: { value?: number; unit?: string } }>;
  }>;
  requester?: { display?: string };
}

interface FhirObservation {
  resourceType: 'Observation';
  id: string;
  code: { text?: string; coding?: Array<{ display?: string; code?: string }> };
  effectiveDateTime?: string;
  valueQuantity?: { value?: number; unit?: string };
  component?: Array<{
    code: { text?: string };
    valueQuantity?: { value?: number };
  }>;
}

interface FhirBundle<T> {
  resourceType: 'Bundle';
  total?: number;
  entry?: Array<{ resource: T }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

// The FHIR base URL for MyChart varies by health network.
// Ottawa hospitals typically use one of these — configurable per user.
const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'https://fhir.mychart.ca/api/FHIR/R4';
const FHIR_TOKEN_URL = process.env.FHIR_TOKEN_URL ?? 'https://fhir.mychart.ca/oauth2/token';
const FHIR_CLIENT_ID = process.env.FHIR_CLIENT_ID ?? '';

export class HealthPortalAdapter extends BaseAdapter {
  private profile: CognitiveProfile;

  constructor(db: LocalDB, tokenStore: TokenStore, profile: CognitiveProfile) {
    super('myChart', db, tokenStore, 360);   // 6-hour stale threshold
    this.profile = profile;
  }

  async connect(): Promise<boolean> {
    // SMART on FHIR OAuth — handled by auth UI layer.
    // After Robert approves on the MyChart consent screen,
    // the app stores the token and calls this to confirm.
    const token = await this.tokenStore.getToken('myChart');
    return token !== null;
  }

  async sync(): Promise<SyncResult> {
    const hasValidToken = await this.ensureValidToken();
    if (!hasValidToken) {
      await this.updateStatus('degraded', 'MyChart token expired — using cached data');
      return this.failedSync(this.buildSyncError('auth', 'Token invalid', false));
    }

    let totalRecords = 0;
    const errors: string[] = [];

    // Sync each FHIR resource independently — one failing should not block others
    try {
      const appointments = await this.syncAppointments();
      totalRecords += appointments;
    } catch (e) {
      errors.push(`Appointments: ${String(e)}`);
    }

    try {
      const meds = await this.syncMedications();
      totalRecords += meds;
    } catch (e) {
      errors.push(`Medications: ${String(e)}`);
    }

    try {
      const obs = await this.syncObservations();
      totalRecords += obs;
    } catch (e) {
      errors.push(`Observations: ${String(e)}`);
    }

    if (errors.length > 0 && totalRecords === 0) {
      await this.updateStatus('stale', errors.join('; '));
      return this.failedSync(this.buildSyncError('api_error', errors.join('; '), true));
    }

    await this.updateStatus('connected');
    return this.successfulSync(totalRecords);
  }

  async read(): Promise<{
    appointments: NormalisedAppointment[];
    medications: NormalisedMedication[];
    observation_trends: NormalisedObservationTrend[];
  }> {
    const appointments = await this.db.getMany('fhir_appointments', {}) as NormalisedAppointment[];
    const medications = await this.db.getMany('fhir_medications', {}) as NormalisedMedication[];
    const trends = await this.db.getMany('fhir_observation_trends', {}) as NormalisedObservationTrend[];

    // Filter to upcoming appointments only
    const now = new Date();
    const upcomingAppointments = appointments
      .filter(a => new Date(a.start_at) >= now && a.status !== 'cancelled')
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

    return {
      appointments: upcomingAppointments,
      medications: medications.filter(m => m.status === 'active'),
      observation_trends: trends,
    };
  }

  // ── Private: sync Appointments ────────────────────────────────────────────

  private async syncAppointments(): Promise<number> {
    const bundle = await this.fhirGet<FhirBundle<FhirAppointment>>('Appointment?patient=me&status=booked,pending&date=ge' + new Date().toISOString().split('T')[0]);
    const entries = bundle.entry ?? [];
    const today = new Date();

    for (const entry of entries) {
      const raw = entry.resource;
      const startAt = raw.start;
      const startDate = new Date(startAt);
      const daysUntil = Math.floor((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Find provider name from participants
      const providerParticipant = raw.participant.find(
        p => p.actor?.reference?.includes('Practitioner') || p.actor?.reference?.includes('Location')
      );
      const providerName = providerParticipant?.actor?.display ?? 'Unknown provider';

      // Cross-reference with calendar
      const calendarEvents = await this.db.getMany('calendar_events', {}) as Array<{ start_at: string; title: string }>;
      const alsoInCalendar = calendarEvents.some(e => {
        const diff = Math.abs(new Date(e.start_at).getTime() - startDate.getTime());
        return diff < 60 * 60 * 1000;  // Within 1 hour = same event
      });

      const normalised: NormalisedAppointment = {
        id: `fhir_apt_${raw.id}`,
        provider_name: providerName,
        specialty: raw.serviceType?.[0]?.text,
        start_at: startAt,
        duration_minutes: raw.minutesDuration,
        status: raw.status as NormalisedAppointment['status'],
        is_today: daysUntil === 0,
        days_until: daysUntil,
        also_in_calendar: alsoInCalendar,
        cached_at: new Date().toISOString(),
      };

      await this.db.set('fhir_appointments', normalised.id, normalised);
    }

    return entries.length;
  }

  // ── Private: sync MedicationRequests ─────────────────────────────────────

  private async syncMedications(): Promise<number> {
    const bundle = await this.fhirGet<FhirBundle<FhirMedicationRequest>>('MedicationRequest?patient=me&status=active');
    const entries = bundle.entry ?? [];

    for (const entry of entries) {
      const raw = entry.resource;
      const name = raw.medicationCodeableConcept?.text
        ?? raw.medicationReference?.display
        ?? 'Unknown medication';

      const dosageInstruction = raw.dosageInstruction?.[0];
      const doseQty = dosageInstruction?.doseAndRate?.[0]?.doseQuantity;
      const dosage = doseQty ? `${doseQty.value}${doseQty.unit}` : '';

      // Check against profile medications
      const profileMed = this.profile.health.medications.find(
        m => m.name.toLowerCase().includes(name.toLowerCase().split(' ')[0])
      );
      const matchesProfile = !!profileMed;
      let profileDiscrepancy: string | undefined;

      if (!matchesProfile) {
        profileDiscrepancy = `"${name}" is in MyChart but not in your Naavi profile`;
      } else if (profileMed && dosage && !profileMed.dosage.includes(dosage)) {
        profileDiscrepancy = `Dosage mismatch: MyChart shows ${dosage}, profile shows ${profileMed.dosage}`;
      }

      const normalised: NormalisedMedication = {
        id: `fhir_med_${raw.id}`,
        name,
        dosage,
        frequency_description: dosageInstruction?.text ?? '',
        prescriber_name: raw.requester?.display,
        status: raw.status as NormalisedMedication['status'],
        matches_profile: matchesProfile,
        profile_discrepancy: profileDiscrepancy,
        cached_at: new Date().toISOString(),
      };

      await this.db.set('fhir_medications', normalised.id, normalised);
    }

    return entries.length;
  }

  // ── Private: sync Observations (vitals / labs) ────────────────────────────

  private async syncObservations(): Promise<number> {
    // Fetch last 10 readings for key metrics
    const metricsToTrack = [
      { code: '55284-4', display_name: 'Blood pressure', metric: 'blood_pressure' },
      { code: '4548-4',  display_name: 'A1C',            metric: 'A1C' },
      { code: '2339-0',  display_name: 'Blood sugar',    metric: 'glucose' },
    ];

    let totalRecords = 0;

    for (const metric of metricsToTrack) {
      const bundle = await this.fhirGet<FhirBundle<FhirObservation>>(
        `Observation?patient=me&code=${metric.code}&_sort=-date&_count=5`
      );
      const entries = bundle.entry ?? [];

      if (entries.length < 2) continue;  // Need at least 2 readings for a trend

      // Compute trend direction from last 3–5 readings
      // For blood pressure: use systolic component
      const values = entries
        .map(e => {
          const obs = e.resource;
          if (metric.metric === 'blood_pressure') {
            const systolic = obs.component?.find(c => c.code.text?.includes('systolic'));
            return systolic?.valueQuantity?.value ?? null;
          }
          return obs.valueQuantity?.value ?? null;
        })
        .filter((v): v is number => v !== null);

      const trend = computeTrend(values);
      const lastReadingDate = entries[0]?.resource.effectiveDateTime ?? '';

      const normalised: NormalisedObservationTrend = {
        metric: metric.metric,
        display_name: metric.display_name,
        trend,
        trend_description: describeTrend(trend, values.length),
        last_reading_date: lastReadingDate,
        cached_at: new Date().toISOString(),
      };

      await this.db.set('fhir_observation_trends', metric.metric, normalised);
      totalRecords++;
    }

    return totalRecords;
  }

  // ── Private: FHIR HTTP helper ─────────────────────────────────────────────

  private async fhirGet<T>(path: string): Promise<T> {
    const token = await this.tokenStore.getToken('myChart');
    if (!token) throw new Error('No FHIR token');

    const response = await fetch(`${FHIR_BASE_URL}/${path}`, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/fhir+json',
      },
    });

    if (response.status === 401) throw new Error('AUTH_EXPIRED');
    if (!response.ok) throw new Error(`FHIR error: ${response.status} on ${path}`);

    return response.json() as Promise<T>;
  }

  // ── OAuth token refresh — SMART on FHIR ──────────────────────────────────

  protected override async refreshToken(token: OAuthToken): Promise<boolean> {
    try {
      const response = await fetch(FHIR_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: token.refresh_token,
          client_id:     FHIR_CLIENT_ID,
        }),
      });

      if (!response.ok) return false;

      const data = await response.json() as { access_token: string; expires_in: number };
      const refreshed: OAuthToken = {
        ...token,
        access_token: data.access_token,
        expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      };

      await this.tokenStore.saveToken('myChart', refreshed);
      return true;
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TREND COMPUTATION
// Takes an array of numeric readings (most recent first) and returns a direction.
// Uses simple linear regression to avoid noise from single outlier readings.
// ─────────────────────────────────────────────────────────────────────────────

function computeTrend(values: number[]): TrendDirection {
  if (values.length < 2) return 'insufficient_data';

  // Reverse so index 0 = oldest
  const reversed = [...values].reverse();
  const n = reversed.length;
  const mean_x = (n - 1) / 2;
  const mean_y = reversed.reduce((sum, v) => sum + v, 0) / n;

  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mean_x) * (reversed[i] - mean_y);
    den += (i - mean_x) ** 2;
  }

  if (den === 0) return 'stable';
  const slope = num / den;

  // Threshold: only flag as rising/falling if change is meaningful
  // (> 2% of mean per reading)
  const threshold = mean_y * 0.02;
  if (slope > threshold)  return 'rising';
  if (slope < -threshold) return 'falling';
  return 'stable';
}

function describeTrend(trend: TrendDirection, readingCount: number): string {
  const over = `over ${readingCount} reading${readingCount !== 1 ? 's' : ''}`;
  switch (trend) {
    case 'stable':             return `Stable ${over}`;
    case 'rising':             return `Trending upward ${over}`;
    case 'falling':            return `Trending downward ${over}`;
    case 'insufficient_data':  return 'Not enough readings for a trend';
  }
}
