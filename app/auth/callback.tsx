/**
 * auth/callback screen
 *
 * This screen exists so expo-router does not show "Unmatched Route"
 * when Google redirects back to naavi://auth/callback after sign-in.
 *
 * The actual token handling (setSession) happens in app/_layout.tsx
 * via the Linking deep-link listener — nothing needs to happen here.
 */

import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/Colors';

export default function AuthCallback() {
  const router = useRouter();

  // After a short delay, navigate back to home.
  // _layout.tsx has already processed the token by this point.
  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/');
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={styles.text}>Signing you in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  text: {
    marginTop: 16,
    fontSize: 18,
    color: Colors.textPrimary,
  },
});
