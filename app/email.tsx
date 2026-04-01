/**
 * Email redirect screen
 *
 * Handles links from SMS alerts: naavi-web-eman.vercel.app/email?id=<gmailMessageId>
 * Reads the id param and redirects straight to that Gmail thread.
 * Falls back to a manual tap link if auto-redirect doesn't fire.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function EmailRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ready, setReady] = useState(false);

  const gmailUrl = id ? `https://mail.google.com/mail/u/0/#all/${id}` : null;

  useEffect(() => {
    if (!gmailUrl) return;
    const timer = setTimeout(() => {
      Linking.openURL(gmailUrl);
      setReady(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [gmailUrl]);

  if (!id) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>No email ID provided.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>📧</Text>
      <Text style={styles.message}>Opening your email…</Text>
      {gmailUrl && (
        <Pressable onPress={() => Linking.openURL(gmailUrl)}>
          <Text style={styles.link}>Tap here if it doesn't open automatically</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  icon: {
    fontSize: 48,
  },
  message: {
    fontSize: 17,
    fontWeight: '500',
    color: '#374151',
  },
  error: {
    fontSize: 15,
    color: '#9ca3af',
  },
  link: {
    fontSize: 14,
    color: '#2563eb',
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
});
