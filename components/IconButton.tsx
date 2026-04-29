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
  Pressable,
  View,
  Text,
  StyleSheet,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import { Colors } from '@/constants/Colors';

type Props = {
  icon: React.ReactNode | string;
  /** Short accessibility name (also used as peek text if no `description` set). */
  label: string;
  /** Longer explainer shown as a screen-wide peek bar on hover / long-press.
   *  Falls back to `label` when omitted. */
  description?: string;
  onPress: () => void;
  onLongPress?: () => void;
  /** Optional screen-level peek handler. When supplied, IconButton calls
   *  onPeek(description) on hover-in / long-press and onPeek(null) on
   *  hover-out, so the parent can render the caption as a wide bar at the
   *  bottom of the screen instead of a narrow bubble constrained by the
   *  button's parent width. Falls back to an in-component bubble when
   *  onPeek is not provided (backwards compatible). */
  onPeek?: (text: string | null) => void;
  style?: ViewStyle;
  disabled?: boolean;
};

export function IconButton({ icon, label, description, onPress, onLongPress, onPeek, style, disabled }: Props) {
  const tooltipText = description || label;
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the long-press has activated the peek so we know when to
  // dismiss on release. Prevents a normal short tap from showing the peek.
  const longPressActive = useRef(false);

  // Long-press shows the peek caption; releasing the press dismisses it.
  // No auto-timeout — the peek stays visible as long as the user is holding.
  const handleLongPress = (_e: GestureResponderEvent) => {
    longPressActive.current = true;
    if (onPeek) {
      onPeek(tooltipText);
    } else {
      setTooltipVisible(true);
    }
    if (onLongPress) onLongPress();
  };

  // Dismiss the peek caption as soon as the finger lifts after a long-press.
  const handlePressOut = () => {
    if (!longPressActive.current) return;
    longPressActive.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (onPeek) onPeek(null); else setTooltipVisible(false);
  };

  return (
    <View style={styles.wrap}>
      {tooltipVisible && (
        <View style={styles.tooltip} pointerEvents="none">
          <Text style={styles.tooltipText}>{tooltipText}</Text>
        </View>
      )}
      <Pressable
        style={({ pressed }) => [
          styles.btn,
          style,
          disabled && styles.btnDisabled,
          pressed && { opacity: 0.7 },
        ]}
        // V57.2: don't pass `disabled` to Pressable. We still suppress the
        // primary tap action (onPress short-circuits when disabled) but the
        // long-press peek + hover peek still fire so the user can read what
        // the button does even when it's locked. V57.1 testing surfaced this:
        // disabled buttons swallowed everything including the description.
        onPress={() => { if (!disabled) onPress(); }}
        onLongPress={handleLongPress}
        onPressOut={handlePressOut}
        delayLongPress={400}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        // Desktop / web only — mouse enter/leave toggles the caption.
        // Pressable ignores these on mobile (no hover concept), so long-press
        // remains the on-device fallback. Prefer onPeek (screen-level) when
        // supplied, so the caption can render as a wide bar instead of a
        // button-width bubble.
        onHoverIn={() => {
          if (timer.current) { clearTimeout(timer.current); timer.current = null; }
          if (onPeek) onPeek(tooltipText); else setTooltipVisible(true);
        }}
        onHoverOut={() => {
          if (onPeek) onPeek(null); else setTooltipVisible(false);
        }}
      >
        {typeof icon === 'string' ? <Text style={styles.iconText}>{icon}</Text> : icon}
      </Pressable>
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
    // alignSelf:'center' horizontally centers the bubble over the icon.
    // maxWidth keeps the bubble from running wider than ~3 icons so long
    // descriptions wrap onto 2-3 lines instead of overflowing the screen.
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    maxWidth: 220,
    zIndex: 10,
  },
  tooltipText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
  },
});
