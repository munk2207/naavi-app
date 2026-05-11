/**
 * useBatteryOptPrompt
 *
 * Drives the in-app Battery Optimization prompt (AAB queue item 23, shipped
 * 2026-05-11). On app launch, checks three conditions:
 *
 *   1. user_settings.battery_opt_prompted = false  (terminal accept flag)
 *   2. user_settings.battery_opt_last_prompted_date != today  (daily throttle)
 *   3. user has at least one enabled location rule  (no rule → don't pester)
 *
 * If all three pass → returns { visible: true } and the BatteryOptimization
 * Card modal is rendered. Two outcomes:
 *
 *   onAccept  → fires ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS via
 *               expo-intent-launcher (Android's native consent sheet
 *               appears), sets battery_opt_prompted = true (terminal —
 *               never re-prompted again).
 *   onDecline → only stamps battery_opt_last_prompted_date = today; flag
 *               stays false, re-prompts on next-day launch if condition 3
 *               still holds.
 *
 * Q1=2 (catch existing users retroactively on app launch), Q2=2 (re-prompt
 * daily until accepted), Q3=1 (Naavi card before Android dialog).
 *
 * Design memo: project_naavi_battery_opt_inapp_prompt.md.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { supabase } from '@/lib/supabase';
import { queryWithTimeout } from '@/lib/invokeWithTimeout';

const ANDROID_PACKAGE = 'ca.naavi.app';

function todayDateString(): string {
  // Local-date YYYY-MM-DD. Throttle is calendar-day based, not 24h based,
  // so we match the user's clock not UTC.
  return new Date().toLocaleDateString('sv-SE'); // sv-SE = YYYY-MM-DD
}

interface State {
  visible: boolean;
}

export function useBatteryOptPrompt(userId: string | null) {
  const [visible, setVisible] = useState(false);

  // Run the check once when userId becomes available. The home screen
  // mounts at app launch — that's the "morning brief" trigger point (Q2=2).
  useEffect(() => {
    if (!userId || !supabase || Platform.OS !== 'android') return;

    let cancelled = false;

    (async () => {
      try {
        // Conditions 1 + 2 — read flags from user_settings.
        const { data: settings, error: sErr } = await queryWithTimeout(
          supabase
            .from('user_settings')
            .select('battery_opt_prompted, battery_opt_last_prompted_date')
            .eq('user_id', userId)
            .maybeSingle(),
          10_000,
          'battery-opt-read-settings',
        );
        if (sErr || !settings) return; // no settings row → don't pester
        if ((settings as any).battery_opt_prompted === true) return;
        if ((settings as any).battery_opt_last_prompted_date === todayDateString()) return;

        // Condition 3 — at least one enabled location rule.
        const { count, error: cErr } = await queryWithTimeout(
          supabase
            .from('action_rules')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('trigger_type', 'location')
            .eq('enabled', true),
          10_000,
          'battery-opt-count-location-rules',
        );
        if (cErr || (count ?? 0) === 0) return;

        if (!cancelled) setVisible(true);
      } catch (err) {
        // Silent fail — the prompt is non-critical UX; don't break app
        // launch over it.
        console.warn('[useBatteryOptPrompt] check failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  const onAccept = useCallback(async () => {
    if (!userId || !supabase) return;
    try {
      // Flip terminal flag FIRST so even if the intent fails (or user
      // backs out of the Android sheet), we don't re-pester.
      await supabase
        .from('user_settings')
        .update({
          battery_opt_prompted: true,
          battery_opt_last_prompted_date: todayDateString(),
        })
        .eq('user_id', userId);

      // Fire Android's native consent dialog.
      await IntentLauncher.startActivityAsync(
        'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        { data: `package:${ANDROID_PACKAGE}` },
      );
    } catch (err) {
      console.warn('[useBatteryOptPrompt] accept flow error:', err);
    } finally {
      setVisible(false);
    }
  }, [userId]);

  const onDecline = useCallback(async () => {
    if (!userId || !supabase) return;
    try {
      await supabase
        .from('user_settings')
        .update({ battery_opt_last_prompted_date: todayDateString() })
        .eq('user_id', userId);
    } catch (err) {
      console.warn('[useBatteryOptPrompt] decline flow error:', err);
    } finally {
      setVisible(false);
    }
  }, [userId]);

  return { visible, onAccept, onDecline } as State & {
    onAccept: () => Promise<void>;
    onDecline: () => Promise<void>;
  };
}
