/**
 * sync-epic-data Edge Function
 *
 * Pulls health data from Epic FHIR R4 for all users who have connected MyChart.
 * Runs on a schedule (every 12 hours via Supabase pg_cron or manual trigger).
 *
 * Fetches:
 *   - MedicationRequest  → epic_medications table
 *   - Appointment        → epic_appointments table
 *   - Observation        → epic_observations table (vitals, lab results)
 *   - Condition          → epic_conditions table (diagnoses)
 *
 * Zero-friction: Robert never needs to reconnect. If the access token is
 * expired, this function refreshes it using the stored refresh token.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EPIC_TOKEN_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const EPIC_FHIR_BASE = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';
const EPIC_CLIENT_ID = 'f2b6e09c-0569-4ecf-8e81-027432281052';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // Get all users who have Epic tokens
    const { data: tokenRows, error: tokenError } = await adminClient
      .from('epic_tokens')
      .select('*');

    if (tokenError) throw tokenError;
    if (!tokenRows || tokenRows.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'No Epic users to sync' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: { user_id: string; status: string; error?: string }[] = [];

    for (const row of tokenRows) {
      try {
        const accessToken = await getValidAccessToken(row, adminClient);
        if (!accessToken) {
          results.push({ user_id: row.user_id, status: 'skipped', error: 'No valid token' });
          continue;
        }

        const patientId = row.patient_id;
        if (!patientId) {
          results.push({ user_id: row.user_id, status: 'skipped', error: 'No patient_id' });
          continue;
        }

        // Verify token works — read the Patient resource directly
        try {
          const patient = await fhirGet(`Patient/${patientId}`, accessToken);
          console.log('[sync-epic-data] Patient read OK:', patient?.id, patient?.name?.[0]?.text);
        } catch (err) {
          console.error('[sync-epic-data] Patient read failed:', err);
          results.push({ user_id: row.user_id, status: 'error', error: `Token validation failed: ${err}` });
          continue;
        }

        // Run each resource sync independently — one 403 doesn't block the others
        const [medResult, apptResult, obsResult, condResult] = await Promise.allSettled([
          syncMedications(adminClient, row.user_id, patientId, accessToken),
          syncAppointments(adminClient, row.user_id, patientId, accessToken),
          syncObservations(adminClient, row.user_id, patientId, accessToken),
          syncConditions(adminClient, row.user_id, patientId, accessToken),
        ]);
        if (medResult.status  === 'rejected') console.error('[sync] medications failed:', medResult.reason);
        if (apptResult.status === 'rejected') console.error('[sync] appointments failed:', apptResult.reason);
        if (obsResult.status  === 'rejected') console.error('[sync] observations failed:', obsResult.reason);
        if (condResult.status === 'rejected') console.error('[sync] conditions failed:', condResult.reason);

        results.push({ user_id: row.user_id, status: 'ok' });
      } catch (userErr) {
        console.error('[sync-epic-data] Error for user', row.user_id, ':', userErr);
        results.push({ user_id: row.user_id, status: 'error', error: String(userErr) });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[sync-epic-data] Fatal error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ─── Token refresh ────────────────────────────────────────────────────────────

async function getValidAccessToken(
  row: { user_id: string; access_token: string; refresh_token: string | null; expires_at: string },
  adminClient: ReturnType<typeof createClient>
): Promise<string | null> {
  // If not expired (with 5-min buffer), use as-is
  const expiresAt = new Date(row.expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return row.access_token;
  }

  // Need to refresh
  if (!row.refresh_token) {
    console.warn('[sync-epic-data] Token expired and no refresh_token for user', row.user_id);
    return null;
  }

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: row.refresh_token,
    client_id:     EPIC_CLIENT_ID,
  });

  const res = await fetch(EPIC_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    console.error('[sync-epic-data] Token refresh failed for', row.user_id, await res.text());
    return null;
  }

  const tokens = await res.json();
  const newExpiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

  await adminClient
    .from('epic_tokens')
    .update({
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token ?? row.refresh_token, // Epic may not always return new refresh token
      expires_at:    newExpiresAt,
      updated_at:    new Date().toISOString(),
    })
    .eq('user_id', row.user_id);

  console.log('[sync-epic-data] Refreshed token for user', row.user_id);
  return tokens.access_token;
}

// ─── FHIR fetch helper ────────────────────────────────────────────────────────

async function fhirGet(path: string, accessToken: string): Promise<any> {
  const url = `${EPIC_FHIR_BASE}/${path}`;
  console.log(`[fhirGet] GET ${url}`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept:        'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[fhirGet] ${res.status} on ${path} — body: ${body.slice(0, 500)}`);
    throw new Error(`FHIR ${path} → ${res.status}`);
  }
  return res.json();
}

// ─── Medications ──────────────────────────────────────────────────────────────

async function syncMedications(
  db: ReturnType<typeof createClient>,
  userId: string,
  patientId: string,
  token: string
): Promise<void> {
  const bundle = await fhirGet(`MedicationRequest?patient=${patientId}`, token);
  const entries = bundle.entry ?? [];

  for (const entry of entries) {
    const r = entry.resource;
    if (r?.resourceType !== 'MedicationRequest') continue;

    const name = r.medicationCodeableConcept?.text
      ?? r.medicationCodeableConcept?.coding?.[0]?.display
      ?? 'Unknown medication';

    const dosage    = r.dosageInstruction?.[0]?.text ?? '';
    const startDate = r.authoredOn?.split('T')[0] ?? null;
    const status    = r.status ?? 'active';

    await db.from('epic_medications').upsert({
      user_id:    userId,
      fhir_id:    r.id,
      name,
      dosage,
      start_date: startDate,
      status,
      raw:        r,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,fhir_id' });
  }

  console.log(`[sync-epic-data] Synced ${entries.length} medications for user`, userId);
}

// ─── Appointments ─────────────────────────────────────────────────────────────

async function syncAppointments(
  db: ReturnType<typeof createClient>,
  userId: string,
  patientId: string,
  token: string
): Promise<void> {
  const bundle = await fhirGet(`Appointment?patient=${patientId}`, token);
  const entries = bundle.entry ?? [];

  for (const entry of entries) {
    const r = entry.resource;
    if (r?.resourceType !== 'Appointment') continue;

    const title    = r.description ?? r.serviceType?.[0]?.text ?? 'Appointment';
    const startISO = r.start ?? null;
    const location = r.contained?.find((c: any) => c.resourceType === 'Location')?.name ?? '';
    const status   = r.status ?? 'booked';

    await db.from('epic_appointments').upsert({
      user_id:    userId,
      fhir_id:    r.id,
      title,
      start_iso:  startISO,
      location,
      status,
      raw:        r,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,fhir_id' });
  }

  console.log(`[sync-epic-data] Synced ${entries.length} appointments for user`, userId);
}

// ─── Observations (vitals + labs) ─────────────────────────────────────────────

async function syncObservations(
  db: ReturnType<typeof createClient>,
  userId: string,
  patientId: string,
  token: string
): Promise<void> {
  // Fetch recent vitals and labs
  // Epic requires category parameter for Observation queries
  // Fetch vitals and labs separately, merge results
  const [vitalsBundle, labsBundle] = await Promise.allSettled([
    fhirGet(`Observation?patient=${patientId}&category=vital-signs`, token),
    fhirGet(`Observation?patient=${patientId}&category=laboratory`, token),
  ]);
  const entries1 = vitalsBundle.status === 'fulfilled' ? (vitalsBundle.value.entry ?? []) : [];
  const entries2 = labsBundle.status  === 'fulfilled' ? (labsBundle.value.entry  ?? []) : [];
  const allEntries = [...entries1, ...entries2];
  // shadow `entries` used below
  const bundle = { entry: allEntries };
  const entries = bundle.entry ?? [];

  for (const entry of entries) {
    const r = entry.resource;
    if (r?.resourceType !== 'Observation') continue;

    const code    = r.code?.text ?? r.code?.coding?.[0]?.display ?? 'Unknown';
    const value   = r.valueQuantity
      ? `${r.valueQuantity.value} ${r.valueQuantity.unit ?? ''}`.trim()
      : r.valueString ?? r.valueCodeableConcept?.text ?? '';
    const date    = r.effectiveDateTime?.split('T')[0] ?? null;
    const category = r.category?.[0]?.coding?.[0]?.code ?? 'unknown';

    await db.from('epic_observations').upsert({
      user_id:    userId,
      fhir_id:    r.id,
      code,
      value,
      date,
      category,
      raw:        r,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,fhir_id' });
  }

  console.log(`[sync-epic-data] Synced ${entries.length} observations for user`, userId);
}

// ─── Conditions (diagnoses) ───────────────────────────────────────────────────

async function syncConditions(
  db: ReturnType<typeof createClient>,
  userId: string,
  patientId: string,
  token: string
): Promise<void> {
  const bundle = await fhirGet(`Condition?patient=${patientId}`, token);
  const entries = bundle.entry ?? [];

  for (const entry of entries) {
    const r = entry.resource;
    if (r?.resourceType !== 'Condition') continue;

    const name   = r.code?.text ?? r.code?.coding?.[0]?.display ?? 'Unknown condition';
    const onset  = r.onsetDateTime?.split('T')[0] ?? null;
    const status = r.clinicalStatus?.coding?.[0]?.code ?? 'active';

    await db.from('epic_conditions').upsert({
      user_id:    userId,
      fhir_id:    r.id,
      name,
      onset_date: onset,
      status,
      raw:        r,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,fhir_id' });
  }

  console.log(`[sync-epic-data] Synced ${entries.length} conditions for user`, userId);
}
