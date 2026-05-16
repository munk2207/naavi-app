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

    // ready() blocks until the SDK is fully initialized. After this, we can
    // call addGeofences / startGeofences safely. v5 uses a nested Config
    // structure (geolocation / app / logger sub-objects).
    const state: State = await BackgroundGeolocation.ready({
      // Reset config across app launches — we always declare it fresh here.
      reset: true,

      // V57.16.1 — vendor's #1 recommended diagnostic for "geofence not
      // firing" reports (per maintainer @christocracy across Issues #2160,
      // #2407, #1830). Plays per-event sound effects on the device so we can
      // audibly confirm whether the native SDK detected a transition,
      // independent of whether our JS handler ran. Trial-period only —
      // disable for V57.17 production once geofence reliability is confirmed.
      debug: true,

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

  // V57.16.2 — wake-the-brain: ask Android to keep our JS event loop alive
  // for the duration of this handler. Without this wrap, Android suspends
  // mid-await and our T2 POST lands minutes-to-hours later (V57.16.1 drive
  // proved 15m 45s gap on Phone 1, 33m 8s gap on Phone 2 same drive).
  // startBackgroundTask gives us ~30 sec of guaranteed JS lifetime; the
  // finally block at the end of the function calls stopBackgroundTask so
  // the OS can release the resource. Per vendor wiki "Android Headless Mode"
  // — this is the documented pattern for long-running headless work.
  let bgTaskId: number | null = null;
  try {
    bgTaskId = await BackgroundGeolocation.startBackgroundTask();
  } catch (err) {
    remoteLog(getLifecycleSession(), 'tsoft-start-bgtask-failed', {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
  }

  try {

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

  } finally {
    // V57.16.2 — release the OS-granted JS lifetime window. Wrapped in its
    // own try so a stop failure (e.g., taskId already auto-expired by OS)
    // never propagates out of the handler. Best effort — OS may have
    // already terminated the task if our work exceeded ~30 sec.
    if (bgTaskId !== null) {
      try {
        await BackgroundGeolocation.stopBackgroundTask(bgTaskId);
      } catch { /* OS may have already released */ }
    }
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
