/**
 * BatteryOptimizationCard
 *
 * Modal shown on app launch when the user has at least one enabled location
 * rule and hasn't yet tapped "Yes" on the Battery Optimization prompt. Sets
 * the stage for Android's native consent sheet (Q3=1) — Android's own copy
 * is terse and OEM-variable, so a Naavi card framed in plain language makes
 * the why obvious before the OS dialog appears.
 *
 * Two buttons:
 *   - "Yes, open it" → fires ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
 *     marks battery_opt_prompted=true (terminal — never re-prompted again).
 *   - "Not now"      → only stamps battery_opt_last_prompted_date=today,
 *     re-prompts tomorrow if location rules still exist (Q2=2).
 *
 * Wael 2026-05-11. AAB queue item 23.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/Colors';

interface Props {
  visible: boolean;
  onAccept: () => Promise<void>;  // fires intent, flips terminal flag
  onDecline: () => Promise<void>; // stamps today's date, keeps flag false
}

export function BatteryOptimizationCard({ visible, onAccept, onDecline }: Props) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);

  const handle = async (action: 'accept' | 'decline') => {
    if (busy) return;
    setBusy(action);
    try {
      if (action === 'accept') await onAccept();
      else await onDecline();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => handle('decline')}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.icon}>📍</Text>
          <Text style={styles.title}>Help your alerts arrive on time</Text>
          <Text style={styles.body}>
            Naavi needs to stay awake in the background so your location alerts
            arrive the moment you get there — not minutes later. Android calls
            this "Battery Optimization." Tap below and Android will ask you
            once.
          </Text>

          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            onPress={() => handle('accept')}
            disabled={!!busy}
            accessibilityLabel="Open Android setting"
            accessibilityRole="button"
          >
            {busy === 'accept' ? (
              <ActivityIndicator size="small" color={Colors.accentDark} />
            ) : (
              <Text style={styles.primaryBtnText}>Yes, open it</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, busy && styles.btnDisabled]}
            onPress={() => handle('decline')}
            disabled={!!busy}
            accessibilityLabel="Not now"
            accessibilityRole="button"
          >
            {busy === 'decline' ? (
              <ActivityIndicator size="small" color={Colors.textSecondary} />
            ) : (
              <Text style={styles.secondaryBtnText}>Not now</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.bgElevated,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  icon: {
    fontSize: 36,
    marginBottom: 12,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    color: Colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: Colors.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryBtnText: {
    color: Colors.accentDark,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
