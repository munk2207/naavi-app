/**
 * Prominent disclosure modal for background location — Google Play policy
 * requires this shown in the normal flow of the feature (not behind a
 * Settings menu) right before the OS "Allow all the time" dialog. Mounted
 * once at the app root; content mirrors app/permission-location.tsx (the
 * original disclosure screen, which was only reachable via Settings and so
 * never actually intercepted a real permission request — see
 * lib/locationDisclosure.ts for why this modal exists instead/as well).
 */

import { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/Colors';
import { registerLocationDisclosureListener, unregisterLocationDisclosureListener, resolveLocationDisclosure } from '@/lib/locationDisclosure';

export function LocationDisclosureModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    registerLocationDisclosureListener(setVisible);
    return () => unregisterLocationDisclosureListener();
  }, []);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={() => resolveLocationDisclosure(false)}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Location alerts</Text>
          <Text style={styles.body}>
            MyNaavi only knows you&apos;ve arrived somewhere if location is allowed in the
            background — even when the app is closed. &quot;While using the app&quot; sounds
            safer, but it means MyNaavi can&apos;t help you when your phone is in your
            pocket while you drive home.
          </Text>
          <Text style={styles.body}>
            MyNaavi never stores a history of where you&apos;ve been — only checks whether
            you&apos;re at a place you named.
          </Text>
          <Text style={styles.footnote}>
            On the next screen, Android will ask for permission — please choose
            &quot;Allow all the time&quot; so alerts still work when the app is closed. You can
            turn this off anytime in Settings.
          </Text>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => resolveLocationDisclosure(true)}
            accessibilityRole="button"
            accessibilityLabel="Agree to location access"
          >
            <Text style={styles.btnPrimaryText}>Agree</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => resolveLocationDisclosure(false)}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <Text style={styles.btnGhostText}>Not Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.bgElevated,
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: 20,
  },
  btn: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnPrimary: { backgroundColor: Colors.accent },
  btnPrimaryText: { color: '#000', fontSize: 16, fontWeight: '600' },
  btnGhost: { backgroundColor: 'transparent' },
  btnGhostText: { color: Colors.textSecondary, fontSize: 15 },
});
