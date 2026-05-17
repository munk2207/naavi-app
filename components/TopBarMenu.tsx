/**
 * 3-dot dropdown menu for the home-screen top bar.
 *
 * Replaces the previous row of labeled buttons (Info / Notes / Settings).
 * Tapping the dots opens a small popover anchored to the top-right with
 * large, touch-friendly rows. Tapping outside dismisses.
 *
 * Items (in order): Info (integrations modal), Notes, Alerts, Settings.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Pressable,
  InteractionManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { remoteLog } from '@/lib/remoteLog';
import { getLifecycleSession } from '@/lib/appLifecycle';

type MenuItem = {
  label: string;
  onPress: () => void;
};

type Props = {
  items: MenuItem[];
};

export function TopBarMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  // Log insets + open/close transitions so we can correlate Wael's reported
  // "screen draws behind nav bar after force-stop" bug to modal interactions.
  useEffect(() => {
    remoteLog(getLifecycleSession(), open ? 'topbar-modal-open' : 'topbar-modal-close', {
      insets_top:    insets.top,
      insets_bottom: insets.bottom,
      insets_left:   insets.left,
      insets_right:  insets.right,
    });
  }, [open]);

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityLabel="Open menu"
        style={styles.trigger}
        hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
      >
        <Ionicons name="ellipsis-vertical" size={28} color={Colors.textPrimary} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.menu} onPress={e => e.stopPropagation()}>
            {items.map((item, i) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.item, i === items.length - 1 && styles.itemLast]}
                onPress={() => {
                  const session = getLifecycleSession();
                  remoteLog(session, 'topbar-item-tap', { label: item.label });
                  setOpen(false);
                  // V57.19 — replaced setTimeout(0) with InteractionManager.
                  // The old 0ms deferral fired BEFORE the Modal's fade-out
                  // animation finished, and expo-router silently dropped
                  // router.push() calls made while a Modal was still
                  // considered active. runAfterInteractions waits for the
                  // dismiss to settle, then runs the navigation cleanly.
                  InteractionManager.runAfterInteractions(() => {
                    remoteLog(session, 'topbar-item-deferred-fire', { label: item.label });
                    try {
                      item.onPress();
                      remoteLog(session, 'topbar-item-onpress-returned', { label: item.label });
                    } catch (err) {
                      remoteLog(session, 'topbar-item-onpress-threw', {
                        label: item.label,
                        err: err instanceof Error ? err.message : String(err),
                      });
                    }
                  });
                }}
              >
                <Text style={styles.itemText}>{item.label}</Text>
                {/* Chevron-forward is the de-facto Android/iOS indicator for
                    a row that opens another screen — confirms tap vs toggle. */}
                <Ionicons name="chevron-forward" size={18} color={Colors.accent} />
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingRight: 16,
  },
  menu: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  itemLast: {
    borderBottomWidth: 0,
  },
  itemText: {
    fontSize: 17,
    color: Colors.accent,
    fontWeight: '600',
  },
});
