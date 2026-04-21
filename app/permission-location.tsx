/**
 * Permission pre-ask screen — shown the first time the user creates a
 * location-based rule, or from Settings → Location → "Enable".
 *
 * Required by Google Play policy: before showing Android's system "Allow
 * all the time" prompt, the user must see a clear explanation of what the
 * app will do with background location.
 */

import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { requestLocationPermissions } from '@/lib/location';

export default function PermissionLocationScreen() {
  const [busy, setBusy] = useState(false);

  async function handleAllow() {
    setBusy(true);
    try {
      const { foreground, background } = await requestLocationPermissions();

      if (foreground !== 'granted') {
        Alert.alert(
          'Location permission needed',
          'MyNaavi needs location access to fire alerts when you arrive at or leave places. You can change this later in Settings → Apps → MyNaavi → Permissions.',
        );
        setBusy(false);
        return;
      }

      if (background !== 'granted') {
        Alert.alert(
          'Almost there',
          'MyNaavi needs "Allow all the time" to fire alerts even when the app is closed. Tap Settings below, find MyNaavi, and select "Allow all the time" under Location.',
          [
            { text: 'Maybe later', style: 'cancel', onPress: () => router.back() },
            {
              text: 'Open Settings',
              onPress: () => {
                // Jump straight to the app's system settings page so the user
                // can change the location permission to "Allow all the time".
                // useGeofencing re-syncs on next app foreground, so whatever
                // the user picks takes effect automatically.
                Linking.openSettings().catch(() => router.back());
              },
            },
          ],
        );
      } else {
        Alert.alert('Done', 'Location alerts are now active.');
        router.back();
      }
    } catch (err) {
      Alert.alert('Error', 'Could not request location permission. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleNotNow() {
    router.back();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Location alerts</Text>

        <Text style={styles.body}>
          To alert you when you arrive at or leave places you care about — like
          home, the grocery store, or the cottage — MyNaavi needs to know your
          location in the background.
        </Text>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>What we do with it</Text>
          <Text style={styles.blockBody}>
            Your location is checked only when you cross the boundaries of
            places you&apos;ve set up alerts for. We never store a history of
            where you&apos;ve been.
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>What we don&apos;t do</Text>
          <Text style={styles.blockBody}>
            We don&apos;t track your movements, share your location with
            anyone, or keep a log of your daily routine.
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>You&apos;re always in control</Text>
          <Text style={styles.blockBody}>
            You can turn location alerts off at any time in Settings. When
            turned off, no location data is collected at all.
          </Text>
        </View>

        <Text style={styles.footnote}>
          On the next screen, Android will ask if you want to allow location access. Please choose
          &quot;Allow all the time&quot; for alerts to work when the app is closed.
        </Text>

        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleAllow} disabled={busy}>
          <Text style={styles.btnPrimaryText}>{busy ? 'Working…' : 'Allow location'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={handleNotNow} disabled={busy}>
          <Text style={styles.btnGhostText}>Not now</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.bgApp },
  content: { padding: 20, paddingBottom: 40 },
  title:   { fontSize: 24, fontWeight: '700', color: Colors.textPrimary, marginBottom: 16 },
  body:    { fontSize: 15, lineHeight: 22, color: Colors.textPrimary, marginBottom: 20 },
  block:   { marginBottom: 18 },
  blockTitle: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary, marginBottom: 6 },
  blockBody:  { fontSize: 14, lineHeight: 20, color: Colors.textSecondary },
  footnote: { fontSize: 13, lineHeight: 18, color: Colors.textSecondary, fontStyle: 'italic', marginTop: 8, marginBottom: 24 },
  btn:      { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  btnPrimary:    { backgroundColor: '#5DCAA5' },
  btnPrimaryText:{ color: '#000', fontSize: 16, fontWeight: '600' },
  btnGhost:      { backgroundColor: 'transparent' },
  btnGhostText:  { color: Colors.textSecondary, fontSize: 15 },
});
