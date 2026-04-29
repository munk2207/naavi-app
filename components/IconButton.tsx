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
  // Manual long-press timer. V57.3 — Pressable's built-in onLongPress is
  // unreliable on Android (testing showed it never fires regardless of how
  // long the user holds). Instead we start a timer in onPressIn and trigger
  // the peek ourselves at 500ms. onPressOut cancels the timer.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const showPeek = () => {
    longPressFired.current = true;
    if (onPeek) onPeek(tooltipText); else setTooltipVisible(true);
    if (onLongPress) onLongPress();
  };

  const hidePeek = () => {
    if (onPeek) onPeek(null); else setTooltipVisible(false);
  };

  const handlePressIn = () => {
    longPressFired.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      showPeek();
      longPressTimer.current = null;
    }, 500);
  };

  const handlePressOut = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressFired.current) {
      // V57.4 fix — DO NOT reset longPressFired here. React Native fires
      // onPressOut BEFORE onPress, so resetting here causes the onPress
      // short-circuit check to see false and the button action runs anyway
      // (the exact bug Wael reported on V57.3 build 120: long-press peeks
      // AND triggers the action). Reset happens on the NEXT onPressIn so
      // onPress sees the flag as true and correctly suppresses the click.
      hidePeek();
    }
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
        // V57.3: Pressable's onLongPress doesn't fire reliably on Android, so
        // we run our own timer via onPressIn/onPressOut.
        onPress={() => {
          // If long-press already fired, suppress the click entirely (the
          // user's intent was the peek, not the button action).
          if (longPressFired.current) return;
          if (!disabled) onPress();
        }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        // Desktop / web only — mouse enter/leave toggles the caption.
        onHoverIn={() => {
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
