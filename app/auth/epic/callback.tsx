/**
 * Epic SMART on FHIR OAuth callback page
 *
 * Epic redirects here after Robert authorizes Naavi.
 * URL: https://naavi-app.vercel.app/auth/epic/callback?code=...&state=...
 *
 * This page:
 *   1. Reads the code + state from the URL
 *   2. Calls handleEpicCallback() to exchange code for tokens
 *   3. Stores tokens server-side via store-epic-token Edge Function
 *   4. Redirects Robert back to the Settings screen
 */

import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { handleEpicCallback } from '@/lib/epic';
import { Colors } from '@/constants/Colors';
import { Typography } from '@/constants/Typography';

export default function EpicCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Connecting to MyChart...');
  const [error, setError] = useState(false);

  useEffect(() => {
    async function process() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code   = params.get('code');
        const state  = params.get('state');
        const err    = params.get('error');

        if (err) {
          setError(true);
          setMessage(`MyChart connection denied: ${err}`);
          setTimeout(() => router.replace('/(tabs)/settings'), 3000);
          return;
        }

        if (!code || !state) {
          setError(true);
          setMessage('Invalid callback — missing code or state.');
          setTimeout(() => router.replace('/(tabs)/settings'), 3000);
          return;
        }

        const success = await handleEpicCallback(code, state);

        if (success) {
          setMessage('MyChart connected! Redirecting...');
          setTimeout(() => router.replace('/(tabs)/settings'), 1500);
        } else {
          setError(true);
          setMessage('Connection failed — please try again from Settings.');
          setTimeout(() => router.replace('/(tabs)/settings'), 3000);
        }
      } catch (e) {
        console.error('[EpicCallback] Error:', e);
        setError(true);
        setMessage('Unexpected error — please try again.');
        setTimeout(() => router.replace('/(tabs)/settings'), 3000);
      }
    }

    process();
  }, []);

  return (
    <View style={styles.container}>
      {!error && <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />}
      <Text style={[styles.message, error && styles.errorText]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    padding: 24,
  },
  spinner: {
    marginBottom: 20,
  },
  message: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 26,
  },
  errorText: {
    color: Colors.error,
  },
});
