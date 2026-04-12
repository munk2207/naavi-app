/**
 * VoiceButton
 *
 * The primary interaction in Naavi — Robert's microphone button.
 * Large, accessible, clear visual states mapped to semantic ramp.
 * Dark theme — no shadows, uses color elevation instead.
 */

import React, { useEffect, useRef } from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  Animated,
  View,
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
  const isActive = status === 'thinking';

  // Pulse animation when thinking
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
    idle:            Colors.voiceIdle,
    thinking:        Colors.voiceProcessing,
    speaking:        Colors.voiceSpeaking,
    pending_confirm: Colors.voiceIdle,
    error:           Colors.voiceError,
  }[status];

  const icon = {
    idle:            '🎙',
    thinking:        '💭',
    speaking:        '🔊',
    pending_confirm: '🎙',
    error:           '⚠',
  }[status];

  const accessibilityLabel = {
    idle:            'Speak to MyNaavi',
    thinking:        'MyNaavi is thinking',
    speaking:        'MyNaavi is speaking',
    pending_confirm: 'Waiting for confirmation',
    error:           'Error — tap to retry',
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
    // No shadows in dark theme — use color elevation
  },
  disabled: {
    opacity: 0.4,
  },
  icon: {
    fontSize: 32,
  },
});
