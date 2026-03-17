/**
 * VoiceButton
 *
 * The primary interaction in Naavi — Robert's microphone button.
 * Large, accessible, clear visual states: idle / listening / thinking / speaking.
 *
 * Phase 7: Sends typed text from the input field above it.
 * Phase 7.5: Will record actual voice using expo-av.
 */

import React, { useEffect, useRef } from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  Animated,
  View,
  AccessibilityInfo,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';
import type { OrchestratorStatus } from '@/hooks/useOrchestrator';

interface Props {
  status: OrchestratorStatus;
  onPress: () => void;
  disabled?: boolean;
}

export function VoiceButton({ status, onPress, disabled }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const isActive = status === 'thinking' || status === 'speaking';

  // Pulse animation when thinking or speaking
  useEffect(() => {
    if (isActive) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0,  duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isActive, pulseAnim]);

  const backgroundColor = {
    idle:       Colors.voiceIdle,
    thinking:   Colors.voiceProcessing,
    speaking:   Colors.primary,
    error:      Colors.error,
  }[status];

  const icon = {
    idle:       '🎙',
    thinking:   '💭',
    speaking:   '🔊',
    error:      '!',
  }[status];

  const accessibilityLabel = {
    idle:       'Speak to Naavi',
    thinking:   'Naavi is thinking',
    speaking:   'Naavi is speaking',
    error:      'Error — tap to retry',
  }[status];

  async function handlePress() {
    if (disabled || isActive) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }

  return (
    <View style={styles.container}>
      {/* Outer ring — visible when active */}
      {isActive && (
        <Animated.View
          style={[
            styles.ring,
            { backgroundColor, transform: [{ scale: pulseAnim }], opacity: 0.2 },
          ]}
        />
      )}
      <TouchableOpacity
        style={[styles.button, { backgroundColor }, disabled && styles.disabled]}
        onPress={handlePress}
        activeOpacity={0.8}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: disabled || isActive }}
      >
        <Animated.Text
          style={[styles.icon, { transform: [{ scale: pulseAnim }] }]}
        >
          {icon}
        </Animated.Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    width: Typography.touchTargetVoice + 24,
    height: Typography.touchTargetVoice + 24,
  },
  ring: {
    position: 'absolute',
    width: Typography.touchTargetVoice + 24,
    height: Typography.touchTargetVoice + 24,
    borderRadius: (Typography.touchTargetVoice + 24) / 2,
  },
  button: {
    width: Typography.touchTargetVoice,
    height: Typography.touchTargetVoice,
    borderRadius: Typography.touchTargetVoice / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  disabled: {
    opacity: 0.4,
  },
  icon: {
    fontSize: 32,
  },
});
