/**
 * useGeofencing — owns the location-trigger lifecycle on the mobile side.
 *
 * Two layers (see project_naavi_location_trigger_plan.md for full rationale):
 *
 *   1. Registration layer (this hook + module-level syncers) — reads active
 *      location rules from Supabase, resolves place names via the resolve-place
 *      Edge Function, and calls Location.startGeofencingAsync to register the
 *      geofences with the OS.
 *
 *   2. Fire handler (module-level TaskManager.defineTask) — runs when the OS
 *      detects a transition, even if the app is killed. POSTs the event to
 *      report-location-event Edge Function, which fires the action fan-out.
 *
 * Re-sync triggers (Q6 decision):
 *   - On auth change (login/logout)
 *   - On app foreground (AppState event)
 *   - After every background-task fire (catches one_shot rule disables)
 *
 * Multi-user safety (Q3):
 *   - Layer 1: re-registration wipes all geofences on user change.
 *   - Layer 2: background task verifies region.identifier's owner matches
 *              the currently logged-in user before firing.
 *
 * Phase 2 scope: code structure supports background, but we rely on OS
 * firing the task regardless. No additional background-service native changes
 * beyond Expo's built-in task manager.
 */

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '@/lib/supabase';
import { queryWithTimeout, getSessionWithTimeout } from '@/lib/invokeWithTimeout';
import { remoteLog, newDiagSession } from '@/lib/remoteLog';
import { getLifecycleSession } from '@/lib/appLifecycle';

const GEOFENCE_TASK = 'naavi-geofence-v1';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

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
  identifier: string; // rule_id — used as the identity key in OS registration
  latitude: number;
  longitude: number;
  radius: number;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
}

// ── Module-level background task ────────────────────────────────────────────
// Must be defined at module load, outside any component/hook, so the OS can
// wake it even when the app is killed.

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: any) => {
  if (error) {
    console.error('[geofence-task] error:', error);
    return;
  }
  if (!data) return;

  const { eventType, region } = data;
  const ruleId = region?.identifier;
  if (!ruleId) return;

  const eventName =
    eventType === Location.GeofencingEventType.Enter ? 'enter' :
    eventType === Location.GeofencingEventType.Exit  ? 'exit'  :
    'dwell';

  // V57.10.1 — Doze-delay investigation. Each geofence fire gets a fresh
  // event_id so client + server logs can be joined back into one timeline:
  //   T1 — task fire (this point)
  //   T2 — about to POST report-location-event
  //   T3 — server received the event
  //   T4 — server finished fan-out
  // Comparing T1 → T4 against Wael's wall-clock arrival time tells us
  // which segment is consuming the 28 min: Doze-delayed callback (T1
  // late vs arrival), Doze-throttled network (T2 - T1 large), server
  // (T3 - T2 large), or fan-out (T4 - T3 large).
  const eventId = newDiagSession();
  remoteLog(eventId, 'geofence-T1-task-fired', {
    rule_id: ruleId,
    event: eventName,
  });

  if (!supabase) return;

  try {
    // Look up the rule to get user_id + created_at
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

    // POST the crossing to report-location-event
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
        lat: region.latitude,
        lng: region.longitude,
        event: eventName,
        timestamp: new Date().toISOString(),
        event_id: eventId, // V57.10.1 — server logs T3/T4 under same id
      }),
    });

    console.log(`[geofence-task] posted ${eventName} for rule ${ruleId} → ${res.status}`);

    // Self-healing: re-sync after fire (Q6). Drops one_shot rules that just
    // disabled themselves.
    await syncGeofencesForUser(ruleRow.user_id);
  } catch (err) {
    console.error('[geofence-task] handler failed:', err);
  }
});

// ── Module-level sync function ──────────────────────────────────────────────

export async function syncGeofencesForUser(userId: string): Promise<number> {
  if (!userId || !supabase) return 0;

  try {
    // V57.9.9 diagnostic — log entry + permission status seen. If the user
    // just toggled "Allow all the time" via system Settings and Android
    // restarted the activity, this fires on the foreground re-sync and
    // tells us what permission state the new instance sees.
    remoteLog(getLifecycleSession(), 'syncGeofences-start', {
      user_id_short: userId.slice(0, 8),
    });
    // Permission check — if not granted, stop all geofences and return
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
    // If GPS is unavailable, resolve-place falls back to home_address.
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

      // Fast path — if the rule already has baked-in resolved coords (from
      // the SET_ACTION_RULE intercept / pending-confirmation flow), use them
      // directly. No resolve-place round-trip needed.
      const resolvedLat = typeof cfg.resolved_lat === 'number' ? cfg.resolved_lat : null;
      const resolvedLng = typeof cfg.resolved_lng === 'number' ? cfg.resolved_lng : null;
      if (resolvedLat !== null && resolvedLng !== null) {
        regions.push({
          identifier: rule.id,
          latitude:  resolvedLat,
          longitude: resolvedLng,
          radius:    typeof cfg.radius_meters === 'number' ? cfg.radius_meters : 100,
          notifyOnEnter: direction !== 'leave',
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
        // direction mapping — arrive/inside → ENTER; leave → EXIT.
        // Dwell-specific OS transition is Phase 3; Phase 2 uses ENTER/EXIT
        // only for MVP coverage.
        notifyOnEnter: direction !== 'leave',
        notifyOnExit:  direction === 'leave',
      });
    }

    // Stop existing, then re-register the current set
    await stopAllGeofences();
    if (regions.length > 0) {
      await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
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

async function stopAllGeofences(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    if (isRegistered) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch (err) {
    // Not an error if the task was never started
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
