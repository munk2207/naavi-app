/**
 * Circular icon button with long-press tooltip.
 *
 * Replaces the labeled bottom-bar buttons (Voice / Free / Meet) — the icon
 * stands alone, and long-pressing reveals a small label bubble above the
 * button for users who haven't learned the icons yet.
 *
 * accessibilityLabel remains set to `label` so screen readers still announce
 * the action name.
 */

import React, { useRef, useState } from 'react';
import {
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import { Colors } from '@/constants/Colors';

type Props = {
  icon: React.ReactNode | string;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
  disabled?: boolean;
};

export function IconButton({ icon, label, onPress, onLongPress, style, disabled }: Props) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLongPress = (_e: GestureResponderEvent) => {
    setTooltipVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTooltipVisible(false), 1800);
    if (onLongPress) onLongPress();
  };

  return (
    <View style={styles.wrap}>
      {tooltipVisible && (
        <View style={styles.tooltip} pointerEvents="none">
          <Text style={styles.tooltipText}>{label}</Text>
        </View>
      )}
      <TouchableOpacity
        style={[styles.btn, style, disabled && styles.btnDisabled]}
        onPress={onPress}
        onLongPress={handleLongPress}
        delayLongPress={400}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        {typeof icon === 'string' ? <Text style={styles.iconText}>{icon}</Text> : icon}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  iconText: {
    fontSize: 20,
    color: '#fff',
  },
  tooltip: {
    position: 'absolute',
    bottom: 60,
    backgroundColor: 'rgba(0,0,0,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 120,
    zIndex: 10,
  },
  tooltipText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 0,
  },
});
