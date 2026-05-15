/**
 * useGeofencing — owns the location-trigger lifecycle on the mobile side.
 *
 * V57.16.0 — switched from Expo's `Location.startGeofencingAsync` (which wraps
 * Android's native `GeofencingClient`) to Transistorsoft
 * `react-native-background-geolocation`. Reason: the Android API silently
 * stopped delivering ENTER events on Wael's Samsung One UI phone after the
 * V57.14.3 foreground-service experiment. Transistorsoft runs its own
 * foreground service tuned for Samsung's aggressive process management
 * (Strava / Life360 use the same library for the same reason).
 *
 * Two layers (see project_naavi_location_trigger_plan.md for full rationale):
 *
 *   1. Registration layer (this hook + module-level syncers) — reads active
 *      location rules from Supabase, resolves place names via the resolve-place
 *      Edge Function, and calls BackgroundGeolocation.addGeofences to register
 *      the geofences with the SDK.
 *
 *   2. Fire handler (BackgroundGeolocation.onGeofence subscription) — runs
 *      when the SDK detects a transition, even if the app is killed (via the
 *      SDK's headless mode + foreground service). POSTs the event to
 *      report-location-event Edge Function, which fires the action fan-out.
 *
 * Re-sync triggers (Q6 decision):
 *   - On auth change (login/logout)
 *   - On app foreground (AppState event)
 *
 * Multi-user safety (Q3):
 *   - Layer 1: re-registration wipes all geofences on user change.
 *   - Layer 2: fire handler verifies region.identifier's owner matches
 *              the currently logged-in user before firing.
 */

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import BackgroundGeolocation, {
  type Geofence,
  type GeofenceEvent,
  type State,
} from 'react-native-background-geolocation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { queryWithTimeout, getSessionWithTimeout } from '@/lib/invokeWithTimeout';
import { remoteLog, newDiagSession } from '@/lib/remoteLog';
import { getLifecycleSession } from '@/lib/appLifecycle';

// V57.14.3 — persistent registry of per-rule last-registration time.
// Replaces the V57.10.3 in-memory Map. The Map was reset to empty on every
// app restart (including AAB-install relaunch), which broke phantom
// suppression for the first event after restart.
const REGISTRY_KEY = 'naavi.geofence.lastReg.v1';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// V57.10.5 — asymmetric suppression windows. Android sometimes emits
// initial-state EXIT events 4+ minutes after registration. Since none of
// Wael's rules use direction='leave', EXIT events are pure noise — the
// server's direction check skips them. We can therefore safely widen the
// EXIT suppression window to 5 minutes with zero downside. ENTER/DWELL
// stays at 5 seconds because a user who actually arrives somewhere within
// seconds of opening the app would otherwise have their real arrival
// suppressed.
const PHANTOM_SUPPRESS_ENTER_MS = 5_000;
const PHANTOM_SUPPRESS_EXIT_MS  = 300_000;

// ── Persistent per-rule registration registry ───────────────────────────────

async function getLastRegisteredAt(ruleId: string): Promise<number | undefined> {
  try {
    const raw = await AsyncStorage.getItem(REGISTRY_KEY);
    if (!raw) return undefined;
    const map = JSON.parse(raw) as Record<string, number>;
    const v = map[ruleId];
    return typeof v === 'number' ? v : undefined;
  } catch {
    return undefined;
  }
}

async function setLastRegisteredAt(updates: Record<string, number>): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(REGISTRY_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    for (const k of Object.keys(updates)) {
      map[k] = updates[k];
    }
    await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(map));
  } catch (err) {
    console.error('[geofence-registry] write failed:', err);
  }
}

async function clearLastRegistered(): Promise<void> {
  try {
    await AsyncStorage.removeItem(REGISTRY_KEY);
  } catch (err) {
    console.error('[geofence-registry] clear failed:', err);
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ActionRule {
  id: string;
  user_id: string;
  trigger_type: string;
  trigger_config: Record<string, any>;
  enabled: boolean;
  created_at: string;
}

interface ResolvedRegion {
  identifier: string; // rule_id — used as the identity key in SDK registration
  latitude: number;
  longitude: number;
  radius: number;
  notifyOnEntry: boolean;
  notifyOnExit: boolean;
}

// ── Module-level Transistorsoft setup ───────────────────────────────────────
// The SDK requires a one-time ready() call before any geofence operations.
// We lazy-init via a module-scoped promise so concurrent callers all wait on
// the same initialization, and the onGeofence listener gets registered
// exactly once.

let readyPromise: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    // The onGeofence listener — receives ENTER / EXIT / DWELL events from the
    // SDK and POSTs to report-location-event. Same logic the prior
    // TaskManager.defineTask handler ran (phantom suppression, multi-user
    // safety, initial-state suppression, eventId tracing).
    BackgroundGeolocation.onGeofence(handleGeofenceEvent);

    // Provider error / location error logging — useful diagnostics if the
    // SDK can't get a fix (airplane mode, GPS off, etc).
    BackgroundGeolocation.onProviderChange((event) => {
      remoteLog(getLifecycleSession(), 'tsoft-provider-change', {
        enabled: event.enabled,
        status: event.status,
        gps: event.gps,
        network: event.network,
      });
    });

    // ready() blocks until the SDK is fully initialized. After this, we can
    // call addGeofences / startGeofences safely. v5 uses a nested Config
    // structure (geolocation / app / logger sub-objects).
    const state: State = await BackgroundGeolocation.ready({
      // Reset config across app launches — we always declare it fresh here.
      reset: true,

      geolocation: {
        // Geofence-only mode uses High accuracy for the periodic location
        // pings the SDK does to maintain its proximity-radius pool.
        desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,

        // Larger proximity radius than any single geofence we register
        // (typical 100-500m). Only geofences within this circle around the
        // user are activated at any time. Saves battery + sidesteps
        // Android's 100-geofence-per-app native limit.
        geofenceProximityRadius: 5000, // 5 km — covers Wael's typical day

        // Don't auto-fire ENTER on registration if user happens to be
        // inside the region; we have our own initial-state suppression.
        geofenceInitialTriggerEntry: false,
      },

      app: {
        // Survival across app kill / device boot — the whole point of
        // using this SDK over the native API.
        stopOnTerminate: false,
        startOnBoot: true,
        enableHeadless: true,

        // Foreground service notification (Android only — iOS ignores).
        notification: {
          title: 'MyNaavi is keeping your alerts ready',
          text: 'Tap to open Naavi',
          smallIcon: 'mipmap/ic_launcher',
          color: '#5DCAA5',
        },
      },

      logger: {
        // Info during trial; knock down to Warning once stable.
        logLevel: BackgroundGeolocation.LogLevel.Info,
      },
    });

    remoteLog(getLifecycleSession(), 'tsoft-ready', {
      enabled: state.enabled,
      tracking_mode: state.trackingMode,
      schedulerEnabled: state.schedulerEnabled,
    });
  })().catch((err) => {
    // Reset so the next call retries
    readyPromise = null;
    console.error('[tsoft-ready] failed:', err);
    remoteLog(getLifecycleSession(), 'tsoft-ready-failed', {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    throw err;
  });
  return readyPromise;
}

// ── Geofence event handler (replaces the old GEOFENCE_TASK handler) ─────────

async function handleGeofenceEvent(event: GeofenceEvent): Promise<void> {
  const ruleId = event.identifier;
  if (!ruleId) return;

  const eventName =
    event.action === 'ENTER' ? 'enter' :
    event.action === 'EXIT'  ? 'exit'  :
    'dwell';

  // V57.10.1 — Each fire gets a fresh event_id so client + server logs can
  // be joined back into one timeline:
  //   T1 — task fire (this point)
  //   T2 — about to POST report-location-event
  //   T3 — server received the event
  //   T4 — server finished fan-out
  const eventId = newDiagSession();
  remoteLog(eventId, 'geofence-T1-task-fired', {
    rule_id: ruleId,
    event: eventName,
    src: 'tsoft',
  });

  // V57.10.3 — phantom-event suppression. Android emits initial-state
  // events on registration for every region in the user's current
  // membership state. We drop these at the handler boundary.
  // V57.10.5 — asymmetric windows: 5s for ENTER/DWELL, 5min for EXIT.
  // V57.14.3 — registry is AsyncStorage-backed so the suppression survives
  // app restarts.
  if (eventName === 'enter' || eventName === 'dwell' || eventName === 'exit') {
    const lastReg = await getLastRegisteredAt(ruleId);
    const suppressMs = eventName === 'exit' ? PHANTOM_SUPPRESS_EXIT_MS : PHANTOM_SUPPRESS_ENTER_MS;
    if (lastReg !== undefined && Date.now() - lastReg < suppressMs) {
      remoteLog(eventId, 'geofence-T1-suppressed-phantom', {
        rule_id: ruleId,
        event: eventName,
        ms_since_registration: Date.now() - lastReg,
        window_ms: suppressMs,
      });
      return;
    }
  }

  if (!supabase) return;

  try {
    const { data: ruleRow } = await queryWithTimeout(
      supabase
        .from('action_rules')
        .select('id, user_id, created_at, enabled')
        .eq('id', ruleId)
        .maybeSingle(),
      15_000,
      'select-action-rule-for-geofence',
    );

    if (!ruleRow || !ruleRow.enabled) {
      console.log(`[geofence-task] rule ${ruleId} not found or disabled`);
      return;
    }

    // Layer 3: suppress initial-inside fires within 10s of creation (Q7)
    if (eventName === 'enter' || eventName === 'dwell') {
      const msSinceCreation = Date.now() - new Date(ruleRow.created_at).getTime();
      if (msSinceCreation < 10_000) {
        console.log(`[geofence-task] suppressing initial-state fire for rule ${ruleId}`);
        return;
      }
    }

    // Layer 2: verify current user matches rule owner (Q3)
    const session = await getSessionWithTimeout();
    const currentUserId = session?.user?.id;
    if (currentUserId && currentUserId !== ruleRow.user_id) {
      console.log(`[geofence-task] cross-user fire blocked: rule ${ruleRow.user_id} vs current ${currentUserId}`);
      return;
    }

    remoteLog(eventId, 'geofence-T2-about-to-post', {
      rule_id: ruleId,
      event: eventName,
    });
    const res = await fetch(`${SUPABASE_URL}/functions/v1/report-location-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({
        user_id: ruleRow.user_id,
        rule_id: ruleId,
        lat: event.location?.coords?.latitude ?? null,
        lng: event.location?.coords?.longitude ?? null,
        event: eventName,
        timestamp: new Date().toISOString(),
        event_id: eventId,
      }),
    });

    console.log(`[geofence-task] posted ${eventName} for rule ${ruleId} → ${res.status}`);
  } catch (err) {
    console.error('[geofence-task] handler failed:', err);
  }
}

// ── Module-level sync function ──────────────────────────────────────────────

export async function syncGeofencesForUser(userId: string): Promise<number> {
  if (!userId || !supabase) return 0;

  try {
    remoteLog(getLifecycleSession(), 'syncGeofences-start', {
      user_id_short: userId.slice(0, 8),
    });

    // Permission check — if not granted, stop all geofences and return.
    const { status: fgStatus } = await Location.getForegroundPermissionsAsync();
    let bgStatus: string | undefined;
    try {
      const bg = await Location.getBackgroundPermissionsAsync();
      bgStatus = bg.status;
    } catch { /* not supported on this platform */ }
    remoteLog(getLifecycleSession(), 'syncGeofences-permissions', {
      foreground: fgStatus,
      background: bgStatus ?? 'unavailable',
    });
    if (fgStatus !== 'granted') {
      await stopAllGeofences();
      remoteLog(getLifecycleSession(), 'syncGeofences-end', {
        registered: 0,
        reason: 'foreground-not-granted',
      });
      return 0;
    }

    // Get user's current position once — used as reference anchor for all
    // resolve-place calls below so ambiguous names ("Costco") resolve to
    // the nearby instance instead of whatever Google picks globally.
    let referenceCoords: { lat: number; lng: number } | null = null;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      referenceCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (err) {
      console.log('[geofence-sync] no GPS available — resolve-place will fall back to home_address');
    }

    // Load this user's active location rules
    const { data: rules, error } = await queryWithTimeout(
      supabase
        .from('action_rules')
        .select('id, user_id, trigger_type, trigger_config, enabled, created_at')
        .eq('user_id', userId)
        .eq('trigger_type', 'location')
        .eq('enabled', true),
      15_000,
      'select-location-rules',
    );

    if (error) {
      console.error('[geofence-sync] failed to load rules:', error.message);
      return 0;
    }

    const regions: ResolvedRegion[] = [];

    for (const rule of (rules ?? []) as ActionRule[]) {
      const cfg = rule.trigger_config ?? {};
      const placeName = String(cfg.place_name ?? '').trim();
      const direction = String(cfg.direction ?? 'arrive');
      if (!placeName) continue;

      // Fast path — rule already has baked-in resolved coords (from
      // SET_ACTION_RULE intercept / pending-confirmation flow). Use them.
      const resolvedLat = typeof cfg.resolved_lat === 'number' ? cfg.resolved_lat : null;
      const resolvedLng = typeof cfg.resolved_lng === 'number' ? cfg.resolved_lng : null;
      if (resolvedLat !== null && resolvedLng !== null) {
        regions.push({
          identifier: rule.id,
          latitude:  resolvedLat,
          longitude: resolvedLng,
          radius:    typeof cfg.radius_meters === 'number' ? cfg.radius_meters : 100,
          notifyOnEntry: direction !== 'leave',
          notifyOnExit:  direction === 'leave',
        });
        continue;
      }

      // Fallback — older rules without baked coords. Resolve via Edge Function.
      const resolved = await resolvePlace(userId, placeName, referenceCoords);
      if (!resolved) {
        console.error(`[geofence-sync] could not resolve "${placeName}" for rule ${rule.id}`);
        continue;
      }

      regions.push({
        identifier: rule.id,
        latitude:  resolved.lat,
        longitude: resolved.lng,
        radius:    resolved.radius_meters || 100,
        notifyOnEntry: direction !== 'leave',
        notifyOnExit:  direction === 'leave',
      });
    }

    // Make sure the SDK is fully initialized before any geofence ops.
    await ensureReady();

    // Stop existing, then re-register the current set
    await stopAllGeofences({ keepSdkRunning: true });

    if (regions.length > 0) {
      const tsoftGeofences: Geofence[] = regions.map((r) => ({
        identifier: r.identifier,
        radius: r.radius,
        latitude: r.latitude,
        longitude: r.longitude,
        notifyOnEntry: r.notifyOnEntry,
        notifyOnExit: r.notifyOnExit,
        notifyOnDwell: false,
      }));
      await BackgroundGeolocation.addGeofences(tsoftGeofences);
      // startGeofences puts the SDK into geofence-only mode (vs full motion
      // tracking). Idempotent.
      await BackgroundGeolocation.startGeofences();

      // V57.10.3 — record per-rule registration time so the handler can
      // suppress phantom initial-state events.
      const now = Date.now();
      const updates: Record<string, number> = {};
      for (const r of regions) {
        updates[r.identifier] = now;
      }
      await setLastRegisteredAt(updates);
    } else {
      await clearLastRegistered();
      // No active rules → stop the SDK entirely (no point keeping the FG
      // notification + battery cost when no alerts are active).
      await BackgroundGeolocation.stop();
    }

    console.log(`[geofence-sync] user ${userId}: registered ${regions.length} geofences`);
    remoteLog(getLifecycleSession(), 'syncGeofences-end', {
      registered: regions.length,
      reason: 'ok',
    });
    return regions.length;
  } catch (err) {
    console.error('[geofence-sync] failed:', err);
    remoteLog(getLifecycleSession(), 'syncGeofences-end', {
      registered: 0,
      reason: 'threw',
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    return 0;
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function stopAllGeofences(opts: { keepSdkRunning?: boolean } = {}): Promise<void> {
  try {
    await ensureReady();
    await BackgroundGeolocation.removeGeofences();
    if (!opts.keepSdkRunning) {
      await BackgroundGeolocation.stop();
    }
  } catch (err) {
    console.log('[geofence-sync] stop skipped:', err instanceof Error ? err.message : err);
  }
}

interface ResolvedPlace {
  lat: number;
  lng: number;
  radius_meters: number;
}

async function resolvePlace(
  userId: string,
  placeName: string,
  referenceCoords: { lat: number; lng: number } | null,
): Promise<ResolvedPlace | null> {
  try {
    const body: Record<string, unknown> = { user_id: userId, place_name: placeName };
    if (referenceCoords) {
      body.reference_lat = referenceCoords.lat;
      body.reference_lng = referenceCoords.lng;
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-place`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.status !== 'ok') return null;
    if (typeof data?.lat !== 'number' || typeof data?.lng !== 'number') return null;
    return {
      lat: data.lat,
      lng: data.lng,
      radius_meters: typeof data.radius_meters === 'number' ? data.radius_meters : 100,
    };
  } catch (err) {
    console.error(`[resolve-place] failed for "${placeName}":`, err);
    return null;
  }
}

// ── The hook ─────────────────────────────────────────────────────────────────

export function useGeofencing(userId: string | null | undefined) {
  const lastSyncedUserRef = useRef<string | null>(null);

  // Re-sync on userId change (auth layer — Q3)
  useEffect(() => {
    if (!userId) {
      // User logged out — wipe all geofences
      if (lastSyncedUserRef.current) {
        stopAllGeofences().catch(() => {});
        lastSyncedUserRef.current = null;
      }
      return;
    }

    lastSyncedUserRef.current = userId;
    syncGeofencesForUser(userId).catch((err) =>
      console.error('[useGeofencing] initial sync failed:', err),
    );
  }, [userId]);

  // Re-sync on app foreground (Q6)
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        syncGeofencesForUser(userId).catch((err) =>
          console.error('[useGeofencing] foreground sync failed:', err),
        );
      }
    });
    return () => sub.remove();
  }, [userId]);

  // Imperative API — call this after a SET_ACTION_RULE insert to register
  // a newly-created rule without waiting for the next foreground event.
  const syncRules = async () => {
    if (!userId) return 0;
    return syncGeofencesForUser(userId);
  };

  return { syncRules };
}
