/**
 * LocationRuleCard
 *
 * Inline confirmation card shown after Naavi creates a location alert. Renders
 * the alert label + a toggle that flips one_shot between true (one-time) and
 * false (recurring).
 *
 * V57.4 Part B context:
 *   - Naavi defaults location alerts to one-time (one_shot=true) per the v41
 *     server prompt. To make a rule recurring without a separate verbal turn
 *     ("every time" / "always"), Robert taps the toggle on this card.
 *   - The toggle calls supabase.from('action_rules').update({ one_shot }).
 *     RLS on action_rules already restricts to the rule's owner.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '@/lib/supabase';
import { queryWithTimeout } from '@/lib/invokeWithTimeout';
import { Colors } from '@/constants/Colors';

interface Props {
  ruleId: string;
  placeName: string;
  initialOneShot: boolean;
}

export function LocationRuleCard({ ruleId, placeName, initialOneShot }: Props) {
  const [oneShot, setOneShot] = useState(initialOneShot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (!supabase || busy) return;
    const next = !oneShot;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await queryWithTimeout(
        supabase
          .from('action_rules')
          .update({ one_shot: next })
          .eq('id', ruleId),
        15_000,
        'update-rule-one-shot',
      );
      if (err) throw err;
      setOneShot(next);
    } catch (e: any) {
      console.error('[LocationRuleCard] toggle failed:', e);
      setError("Couldn't update — try again.");
    } finally {
      setBusy(false);
    }
  }, [ruleId, oneShot, busy]);

  // Mode label + toggle copy.
  const modeLabel = oneShot ? 'One time' : 'Every time';
  const toggleLabel = oneShot ? 'Make it recurring' : 'Make it one-time';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.icon}>📍</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Location alert</Text>
          <Text style={styles.place}>{placeName}</Text>
        </View>
        <View style={[styles.badge, oneShot ? styles.badgeOneTime : styles.badgeRecurring]}>
          <Text style={styles.badgeText}>{modeLabel}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.toggleBtn, busy && styles.toggleBtnDisabled]}
        onPress={toggle}
        disabled={busy}
        accessibilityLabel={toggleLabel}
        accessibilityRole="button"
      >
        {busy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.toggleText}>{toggleLabel}</Text>
        )}
      </TouchableOpacity>

      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginVertical: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  icon: {
    fontSize: 18,
    marginRight: 8,
  },
  title: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  place: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    marginTop: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    marginLeft: 8,
  },
  badgeOneTime: {
    backgroundColor: 'rgba(255, 196, 87, 0.22)',
  },
  badgeRecurring: {
    backgroundColor: 'rgba(120, 200, 140, 0.22)',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  toggleBtn: {
    backgroundColor: Colors.accent,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleBtnDisabled: {
    opacity: 0.6,
  },
  toggleText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    color: '#ff8a80',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
});
