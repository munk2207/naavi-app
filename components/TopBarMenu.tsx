/**
 * 3-dot dropdown menu for the home-screen top bar.
 *
 * Replaces the previous row of labeled buttons (Info / Notes / Settings).
 * Tapping the dots opens a small popover anchored to the top-right with
 * large, touch-friendly rows. Tapping outside dismisses.
 *
 * Items (in order): Info (integrations modal), Notes, Alerts, Settings.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';

type MenuItem = {
  label: string;
  onPress: () => void;
};

type Props = {
  items: MenuItem[];
};

export function TopBarMenu({ items }: Props) {
  const [open, setOpen] = useState(false);

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
                  setOpen(false);
                  // Defer to next tick so the modal dismiss animation isn't
                  // cut short by the navigation push.
                  setTimeout(() => item.onPress(), 0);
                }}
              >
                <Text style={styles.itemText}>{item.label}</Text>
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
