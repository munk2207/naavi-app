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

// V57.17 — Transistorsoft Config.url ingest endpoint. The SDK posts geofence
// events here natively (no JS in the critical path), bypassing the Android
// JS-event-loop suspension that made V57.16.x deliveries depend on the user
// opening the app. Auth reuses the anon key (already baked in the APK; same
// threat model as the SDK URL itself).
const TSOFT_INGEST_URL = `${SUPABASE_URL}/functions/v1/tsoft-geofence-webhook`;

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

    // V57.16.1 — full event-subscription set per gap-doc Q5 + Q7. Vendor
    // describes each as relevant when geofences misbehave. All log via
    // remoteLog only — no behavior change, pure observability.

    // MOVING ↔ STATIONARY transitions. Per @christocracy Issue #1830 the
    // SDK's willingness to fire geofence events in geofence-only mode hinges
    // on this; with geofenceModeHighAccuracy:true now set, expect to see
    // motion changes feed back into more responsive geofence pickup.
    BackgroundGeolocation.onMotionChange((event) => {
      remoteLog(getLifecycleSession(), 'tsoft-motion-change', {
        is_moving: event.isMoving,
        lat: event.location?.coords?.latitude,
        lng: event.location?.coords?.longitude,
      });
    });

    // Activity-recognition transitions (still / on_foot / in_vehicle / etc).
    // Per Philosophy wiki this is the SDK's primary state-transition signal
    // on Android.
    BackgroundGeolocation.onActivityChange((event) => {
      remoteLog(getLifecycleSession(), 'tsoft-activity-change', {
        activity: event.activity,
        confidence: event.confidence,
      });
    });

    // Android Power Saving mode entry/exit — Doze territory. When true, OS
    // is throttling background services, which can delay geofence delivery.
    BackgroundGeolocation.onPowerSaveChange((isPowerSaveMode) => {
      remoteLog(getLifecycleSession(), 'tsoft-power-save-change', {
        is_power_save_mode: isPowerSaveMode,
      });
    });

    // SDK enabled-state changes — fires if something disables the SDK
    // (license expiry, manual stop, etc).
    BackgroundGeolocation.onEnabledChange((enabled) => {
      remoteLog(getLifecycleSession(), 'tsoft-enabled-change', {
        enabled,
      });
    });

    // Geofence pool swaps. With geofenceProximityRadius=5000, only geofences
    // within 5 km of the user are "actively monitored"; others sit dormant.
    // This event fires when that active set changes — tells us which of our
    // rules are currently being watched vs. inactive.
    BackgroundGeolocation.onGeofencesChange((event) => {
      remoteLog(getLifecycleSession(), 'tsoft-geofences-change', {
        on_count: Array.isArray(event.on) ? event.on.length : 0,
        off_count: Array.isArray(event.off) ? event.off.length : 0,
        on_ids: Array.isArray(event.on) ? event.on.map((g: any) => g.identifier) : [],
        off_ids: Array.isArray(event.off) ? event.off : [],
      });
    });

    // Network connectivity changes — useful for explaining T2/T3 gaps where
    // our fetch() to the server might have failed due to lost connectivity.
    BackgroundGeolocation.onConnectivityChange((event) => {
      remoteLog(getLifecycleSession(), 'tsoft-connectivity-change', {
        connected: event.connected,
      });
    });

    // V57.17 — native HTTP autosync events. Fires once per POST the SDK
    // makes to Config.url. Lets us see in real time whether the native
    // path is succeeding (success:true, status:200) or retrying (status
    // !=2xx, success:false). This is the primary instrument for proving
    // V57.17's "JS no longer in critical path" claim.
    BackgroundGeolocation.onHttp((event) => {
      remoteLog(getLifecycleSession(), 'tsoft-http', {
        success: event.success,
        status: event.status,
        response_chars: (event.responseText ?? '').length,
      });
    });

    // ready() blocks until the SDK is fully initialized. After this, we can
    // call addGeofences / startGeofences safely. v5 uses a nested Config
    // structure (geolocation / app / logger sub-objects).
    const state: State = await BackgroundGeolocation.ready({
      // Reset config across app launches — we always declare it fresh here.
      reset: true,

      // V57.18.1 — debug sounds disabled. Reliability confirmed empirically
      // on 2026-05-16 drive test (V57.17 native HTTP + V57.18 single-flight
      // delivered alerts within ~1 sec of T1 on both phones, both addresses,
      // multi-fire). The audible per-event chime was a trial-period
      // diagnostic only; not needed in production. Re-enable temporarily by
      // setting true if a future geofence-not-firing incident needs
      // audible confirmation that the native SDK detected the transition.
      debug: true,

      // V57.17 — Native HTTP autosync (Config.url). The SDK posts every
      // persisted geofence event directly to our webhook from native code,
      // NOT from JavaScript. This is the architectural fix for the
      // JS-suspension class of bug documented in
      // docs/TRANSISTORSOFT_HEADLESS_WAKE_INVESTIGATION_2026-05-16.md —
      // Android suspends the JS event loop after an event, so our JS
      // handler's `await fetch` was parked for 15 min to 3 hours until
      // the user opened the app. Native code is not subject to that
      // suspension.
      url: TSOFT_INGEST_URL,
      headers: {
        // Reuse the anon key (same one already baked into the APK for
        // other Supabase calls). The webhook validates this server-side.
        authorization: `Bearer ${SUPABASE_ANON}`,
      },
      autoSync: true,        // Post each event immediately (no batching)
      batchSync: false,      // Single-record posts, easier server logic
      // Only persist (and therefore upload) geofence events. Without this,
      // the SDK would post every motion-change/location update too —
      // network + cost explosion. Per Config.d.ts:1178-1197.
      persistMode: BackgroundGeolocation.PERSIST_MODE_GEOFENCE,
      // SDK's SQLite buffer keeps events up to 3 days if our server is down,
      // so a brief outage doesn't lose alerts.
      maxDaysToPersist: 3,
      httpTimeout: 30000,    // 30s — generous enough for cold-start fan-out

      geolocation: {
        // Geofence-only mode uses High accuracy for the periodic location
        // pings the SDK does to maintain its proximity-radius pool.
        desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,

        // Larger proximity radius than any single geofence we register
        // (typical 100-500m). Only geofences within this circle around the
        // user are activated at any time. Saves battery + sidesteps
        // Android's 100-geofence-per-app native limit.
        geofenceProximityRadius: 5000, // 5 km — covers Wael's typical day

        // V57.16.1 — vendor's documented fix for "lazy" geofence-only mode.
        // Per @christocracy Issue #1830: "Android geofence-only mode is
        // lazier with passively monitoring geofences… you could achieve the
        // same thing [as launching Google Maps to keep services warm]
        // without launching Google Maps by configuring
        // Config.geofenceModeHighAccuracy, which will turn on
        // location-services in geofence-only mode." Demo's applyTestConfig
        // sets this true. Directly addresses the Phone 1 5×-lower fire-rate
        // observed in the May 15-16 drives.
        geofenceModeHighAccuracy: true,

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
          smallIcon: 'drawable/notification_icon',
          color: '#5DCAA5',
          // V57.16.1 — per NotificationConfig docs: "Configure the Android
          // Foreground Service icon and notification to be displayed
          // **always**. Defaults to false; normally shows only while device
          // is moving." Per @christocracy Issue #2113: "in geofence-only
          // mode, config.isMoving is **always** false" — meaning with
          // sticky:false the FG notification can be absent or intermittent
          // in our mode. Matches the asymmetry observed May 15 trial
          // (Phone 1 had no FG notif, Phone 2 did).
          sticky: true,
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

    // V57.16.1 — vendor's only Samsung/OEM-specific affordance is the
    // DeviceSettings API. isIgnoringBatteryOptimizations() returns true if
    // the user (or our own V57.14.2 in-app prompt) successfully whitelisted
    // the app. Logging this on every ready() pass means every diagnostic
    // event has the contemporaneous device-state alongside.
    try {
      const ignoringBatteryOpt = await BackgroundGeolocation.deviceSettings.isIgnoringBatteryOptimizations();
      remoteLog(getLifecycleSession(), 'tsoft-device-settings', {
        ignoring_battery_optimizations: ignoringBatteryOpt,
      });
    } catch (err) {
      remoteLog(getLifecycleSession(), 'tsoft-device-settings-failed', {
        error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      });
    }
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

// ── SDK-internal log snapshot helper (V57.16.1 diagnostic addition) ─────────
// On every T1 (geofence event detected by the SDK's native side), pull the
// SDK's own log for the prior 5 minutes — that's where vendor records the
// native-side timeline (`💀 event: geofence`, `onHeadlessJsTaskStart taskId:
// N`, `onActivityRecognitionResult still (100%)`, etc.). Truncate to 5 KB
// before remoteLog'ing so we don't blow the diagnostic payload. Fire-and-
// forget so the main fan-out path is never blocked.

async function captureSdkLogSnapshot(eventId: string, ruleId: string): Promise<void> {
  try {
    const Logger = BackgroundGeolocation.logger;
    const sinceMs = Date.now() - 5 * 60 * 1000; // last 5 minutes
    const log = await Logger.getLog({
      start: sinceMs,
      end: Date.now(),
      order: Logger.ORDER_DESC,
      limit: 200,
    });
    const truncated = log.length > 5000 ? log.slice(0, 5000) + '\n…[truncated]' : log;
    remoteLog(eventId, 'tsoft-sdk-log-snapshot', {
      rule_id: ruleId,
      log_chars: log.length,
      log: truncated,
    });
  } catch (err) {
    remoteLog(eventId, 'tsoft-sdk-log-snapshot-failed', {
      rule_id: ruleId,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
  }
}

// ── Geofence event handler (replaces the old GEOFENCE_TASK handler) ─────────

export async function handleGeofenceEvent(event: GeofenceEvent): Promise<void> {
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

  // V57.16.1 — fire-and-forget capture of the SDK's own log from the prior
  // 5 minutes. Lets us see the native-side timeline (when the SDK actually
  // detected the geofence vs. when our JS handler ran) so the next T1→T2
  // gap can be attributed to OS / SDK / JS instead of being opaque.
  captureSdkLogSnapshot(eventId, ruleId).catch(() => { /* never blocks */ });

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

  // V57.16 — fail-open rule lookup. Prior behavior: if the Supabase rule
  // query returned null (e.g. headless task with no live session →
  // RLS-blocked / JWT-expired), the handler returned silently after T1 and
  // the event never reached the server. Drove for 898 Bayview 2026-05-15
  // and saw T1 fire with no T2 — the server never knew the user arrived.
  // New behavior: still attempt the lookup; if it succeeds, apply the
  // checks (disabled / initial-state / cross-user). If it fails or returns
  // null, log the reason remotely and POST to the server anyway — the
  // Edge Function is service-role and will validate authoritatively.
  let ruleRow: { user_id: string; created_at: string; enabled: boolean } | null = null;
  if (supabase) {
    try {
      const { data } = await queryWithTimeout(
        supabase
          .from('action_rules')
          .select('id, user_id, created_at, enabled')
          .eq('id', ruleId)
          .maybeSingle(),
        15_000,
        'select-action-rule-for-geofence',
      );
      ruleRow = data ?? null;
      if (!ruleRow) {
        remoteLog(eventId, 'geofence-T1-rule-lookup-null', { rule_id: ruleId });
      }
    } catch (err) {
      remoteLog(eventId, 'geofence-T1-rule-lookup-failed', {
        rule_id: ruleId,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      });
    }
  }

  if (ruleRow) {
    if (!ruleRow.enabled) {
      remoteLog(eventId, 'geofence-T1-skipped', { rule_id: ruleId, reason: 'disabled' });
      return;
    }
    // Initial-state suppression — within 10s of rule creation
    if (eventName === 'enter' || eventName === 'dwell') {
      const msSinceCreation = Date.now() - new Date(ruleRow.created_at).getTime();
      if (msSinceCreation < 10_000) {
        remoteLog(eventId, 'geofence-T1-skipped', { rule_id: ruleId, reason: 'initial-state' });
        return;
      }
    }
    // Cross-user safety — only enforce if we have a live session
    const session = await getSessionWithTimeout();
    const currentUserId = session?.user?.id;
    if (currentUserId && currentUserId !== ruleRow.user_id) {
      remoteLog(eventId, 'geofence-T1-skipped', { rule_id: ruleId, reason: 'cross-user' });
      return;
    }
  }

  try {
    remoteLog(eventId, 'geofence-T2-about-to-post', {
      rule_id: ruleId,
      event: eventName,
      has_user_id: !!ruleRow?.user_id,
    });
    const res = await fetch(`${SUPABASE_URL}/functions/v1/report-location-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({
        ...(ruleRow?.user_id ? { user_id: ruleRow.user_id } : {}),
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

// V57.18 — single-flight guard. Android emits MANY AppState='active' events
// per second during app launch (10+ in a single second per today's data),
// causing parallel syncGeofencesForUser calls. The SDK's addGeofences /
// startGeofences are async and collide ("Waiting for previous start action
// to complete" errors), leaving rules in indeterminate state and causing
// real-world fires to miss (e.g., the 8182 driveway miss on the 2026-05-16
// drive). Single-flight makes subsequent calls a no-op while one is running.
let _syncInProgress = false;

// 2026-05-22 — B4m. Mutex around the SDK's startGeofences() call. The
// existing `_syncInProgress` guards against concurrent `syncGeofencesForUser`
// calls but does NOT prevent the SDK's INTERNAL "Waiting for previous start
// action to complete" race that fired ~8 times in client_diagnostics since
// 2026-05-15. This mutex serializes every `startGeofences()` invocation
// across the whole app, regardless of which surface (AppState foreground,
// user-id flip, alert-create handler) triggered the sync.
let _startGeofencesPromise: Promise<void> | null = null;
async function startGeofencesWithMutex(): Promise<void> {
  if (_startGeofencesPromise) return _startGeofencesPromise;
  _startGeofencesPromise = (async () => {
    try {
      await BackgroundGeolocation.startGeofences();
    } finally {
      _startGeofencesPromise = null;
    }
  })();
  return _startGeofencesPromise;
}

// 2026-05-22 — B4n. Last sync outcome so the Alerts screen banner can show
// a warning when registered=0 (permission denied / SDK threw / etc.).
// Updated by every syncGeofencesForUser exit path. Consumers read via
// `getLastSyncStatus()` below.
export interface LastSyncStatus {
  registered: number;
  expectedCount: number | null; // null = unknown yet; mirrors action_rules count
  reason: 'ok' | 'foreground-not-granted' | 'background-not-granted' | 'permission-prompt-denied' | 'threw' | 'unset';
  permission: { foreground: string; background: string | null } | null;
  at: number; // epoch ms
}
let _lastSyncStatus: LastSyncStatus = {
  registered: 0,
  expectedCount: null,
  reason: 'unset',
  permission: null,
  at: 0,
};
export function getLastSyncStatus(): LastSyncStatus {
  return { ..._lastSyncStatus };
}
const _statusListeners = new Set<(s: LastSyncStatus) => void>();
export function subscribeLastSyncStatus(cb: (s: LastSyncStatus) => void): () => void {
  _statusListeners.add(cb);
  return () => { _statusListeners.delete(cb); };
}
function updateLastSyncStatus(next: Partial<LastSyncStatus>): void {
  _lastSyncStatus = { ..._lastSyncStatus, ...next, at: Date.now() };
  for (const cb of _statusListeners) {
    try { cb({ ..._lastSyncStatus }); } catch { /* ignore listener errors */ }
  }
}

export async function syncGeofencesForUser(userId: string): Promise<number> {
  if (!userId || !supabase) return 0;

  // V57.18 — drop if a sync is already in flight. The in-flight call will
  // produce the up-to-date state when it finishes; queuing another behind
  // it just creates a race.
  if (_syncInProgress) {
    remoteLog(getLifecycleSession(), 'syncGeofences-skip', {
      reason: 'already-in-flight',
      user_id_short: userId.slice(0, 8),
    });
    return 0;
  }
  _syncInProgress = true;

  try {
    remoteLog(getLifecycleSession(), 'syncGeofences-start', {
      user_id_short: userId.slice(0, 8),
    });

    // Permission check — if not granted, RE-PROMPT before silently bailing.
    // 2026-05-22 — B4l. The prior version silently logged
    // `foreground-not-granted` and exited with 0 fences registered, leaving
    // the user with no visibility and no path to recovery. Now: if fg
    // permission isn't granted (e.g., Samsung Sleeping Apps revoked it
    // overnight, or it's still undetermined from first launch), we actively
    // call requestForegroundPermissionsAsync to surface the OS prompt. If
    // user accepts → continue sync. If user denies → record the outcome in
    // _lastSyncStatus so the Alerts screen can render the B4n banner.
    let { status: fgStatus } = await Location.getForegroundPermissionsAsync();
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
      remoteLog(getLifecycleSession(), 'syncGeofences-permission-prompt-fg', {
        prior: fgStatus,
      });
      try {
        const requested = await Location.requestForegroundPermissionsAsync();
        fgStatus = requested.status;
        remoteLog(getLifecycleSession(), 'syncGeofences-permission-prompt-fg-result', {
          status: fgStatus,
        });
      } catch (err) {
        remoteLog(getLifecycleSession(), 'syncGeofences-permission-prompt-fg-threw', {
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        });
      }
    }

    if (fgStatus !== 'granted') {
      await stopAllGeofences();
      updateLastSyncStatus({
        registered: 0,
        reason: 'permission-prompt-denied',
        permission: { foreground: fgStatus, background: bgStatus ?? null },
      });
      remoteLog(getLifecycleSession(), 'syncGeofences-end', {
        registered: 0,
        reason: 'foreground-not-granted',
        post_prompt_status: fgStatus,
      });
      return 0;
    }

    // Foreground granted — also re-prompt for background if still missing.
    // Background is required for the SDK to deliver ENTER events while the
    // app isn't open. Silent failure here is the geofence-doesn't-fire bug.
    if (bgStatus && bgStatus !== 'granted') {
      remoteLog(getLifecycleSession(), 'syncGeofences-permission-prompt-bg', {
        prior: bgStatus,
      });
      try {
        const requested = await Location.requestBackgroundPermissionsAsync();
        bgStatus = requested.status;
        remoteLog(getLifecycleSession(), 'syncGeofences-permission-prompt-bg-result', {
          status: bgStatus,
        });
      } catch (err) {
        remoteLog(getLifecycleSession(), 'syncGeofences-permission-prompt-bg-threw', {
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        });
      }
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
        // V57.17 — bake user_id into geofence extras so the native HTTP
        // path (Config.url) self-identifies the user without a server-side
        // action_rules lookup. Per vendor: extras "are appended to the
        // geofence event and posted to your configured Config.url".
        extras: { user_id: userId } as any,
      }));
      await BackgroundGeolocation.addGeofences(tsoftGeofences);
      // startGeofences puts the SDK into geofence-only mode (vs full motion
      // tracking). Idempotent. 2026-05-22 — B4m: route through mutex so
      // concurrent syncs don't fire the SDK's "Waiting for previous start
      // action to complete" race that nuked ~50% of syncs since 2026-05-15.
      await startGeofencesWithMutex();

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
    updateLastSyncStatus({
      registered: regions.length,
      expectedCount: (rules ?? []).length,
      reason: 'ok',
      permission: { foreground: fgStatus, background: bgStatus ?? null },
    });
    remoteLog(getLifecycleSession(), 'syncGeofences-end', {
      registered: regions.length,
      reason: 'ok',
    });
    return regions.length;
  } catch (err) {
    console.error('[geofence-sync] failed:', err);
    updateLastSyncStatus({
      registered: 0,
      reason: 'threw',
      permission: { foreground: fgStatus, background: bgStatus ?? null },
    });
    remoteLog(getLifecycleSession(), 'syncGeofences-end', {
      registered: 0,
      reason: 'threw',
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    return 0;
  } finally {
    // V57.18 — always release the single-flight lock, even on error / early
    // return. Without this, one failed sync would permanently block all
    // subsequent syncs.
    _syncInProgress = false;
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
        // Post-drive native log capture — dumps the SDK's internal log for
        // the last 10 minutes into client_diagnostics so we can see what the
        // native layer was doing during the drive even when the JS thread was
        // suspended. Fire-and-forget; never blocks sync or UI.
        (async () => {
          try {
            await ensureReady();
            const Logger = BackgroundGeolocation.logger;
            const sinceMs = Date.now() - 10 * 60 * 1000;
            const log = await Logger.getLog({
              start: sinceMs,
              end: Date.now(),
              order: Logger.ORDER_ASC,
              limit: 500,
            });
            if (log && log.length > 10) {
              remoteLog(getLifecycleSession(), 'tsoft-native-log-dump', {
                log_chars: log.length,
                log: log.length > 8000 ? log.slice(0, 8000) + '\n…[truncated]' : log,
              });
            }
          } catch (err) {
            remoteLog(getLifecycleSession(), 'tsoft-native-log-dump-failed', {
              error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
            });
          }
        })();
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
